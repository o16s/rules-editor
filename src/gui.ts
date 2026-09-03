// Drop-in rules.xml editor component (browser). Self-contained: it injects its
// own scoped, prefixed styles (`re-*` under `.re-root`) and depends only on the
// tested core (model/serialize/parse/validate) — no external stylesheet.
//
//   import { initRulesEditor } from '@octanis/rules-editor';
//   const editor = initRulesEditor(document.getElementById('app'), {
//     initialModel,                       // optional; defaults to a small example
//     onChange: ({ model, xml, errors }) => save(xml),
//   });
//   editor.getXml(); editor.getModel(); editor.setModel(m); editor.destroy();
//
// Colours/fonts read the host's design tokens (--accent, --ink, --font-body, …)
// with sensible fallbacks, so it looks native inside octaview and still works
// standalone.

import {
  LIMITS,
  OPERATORS,
  SEVERITIES,
  VALUELESS_OPS,
  isGroup,
  type Condition,
  type Cond,
  type Group,
  type Op,
  type Rule,
  type RulesModel,
} from './model.js';
import { serialize } from './serialize.js';
import { parse, validate, validateIssues, RulesParseError, type ValidationIssue } from './parse.js';

export interface RulesEditorOptions {
  /** Model to start from. Cloned on entry; the caller's object is not mutated. */
  initialModel?: RulesModel;
  /**
   * rules.xml to start from — parsed internally. A malformed file does NOT
   * throw: the editor opens empty and the parse error is surfaced through
   * `onChange`'s `errors` (and the status line). Takes precedence over
   * `initialModel`.
   */
  initialXml?: string;
  /** Called after every edit (and once on mount) with the current state. */
  onChange?: (state: { model: RulesModel; xml: string; errors: string[] }) => void;
}

export interface RulesEditorHandle {
  /** Deep copy of the current model. */
  getModel(): RulesModel;
  /** Current model serialized to rules.xml. */
  getXml(): string;
  /** Validation messages for the current model (empty = valid). */
  getErrors(): string[];
  /** Replace the model and re-render. */
  setModel(model: RulesModel): void;
  /** Tear down the editor (empties the container). */
  destroy(): void;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Address of one input, shared by the renderer (as `data-loc`) and by the
 * marking pass (from a ValidationIssue), so an issue finds its field.
 */
type Loc = Pick<ValidationIssue, 'rule' | 'field' | 'path' | 'action'>;
const locKey = (l: Loc): string =>
  `${l.rule ?? ''}|${l.field ?? ''}|${(l.path ?? []).join('.')}|${l.action ?? ''}`;

// ---- small DOM helper ----------------------------------------------------

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
type Opt = { value: string; label: string };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') node.className = String(v);
    else if (v === false) continue;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

// Human-readable labels — the option value stays the canonical XML token.
const OP_LABELS: Record<Op, string> = {
  eq: '=  equals',
  neq: '≠  not equal',
  lt: '<  less than',
  leq: '≤  at most',
  gt: '>  greater than',
  geq: '≥  at least',
  changed: 'changed',
};
const OP_OPTIONS: Opt[] = OPERATORS.map((o) => ({ value: o, label: OP_LABELS[o] }));
const MATCH_OPTIONS: Opt[] = [
  { value: 'cond', label: 'a single condition' },
  { value: 'and', label: 'all of (AND)' },
  { value: 'or', label: 'any of (OR)' },
];
const SEVERITY_OPTIONS: Opt[] = SEVERITIES.map((s) => ({ value: s, label: s }));
const TRIGGER_OPTIONS: Opt[] = [
  { value: 'rising', label: 'on rising edge' },
  { value: 'none', label: 'every cycle' },
];

// Field help — grounded in the documented rules.xml schema (docs/edge-hub/rules).
const HELP = {
  name: 'Unique rule id — used in the incident dedup_key and logs.',
  cooldown: 'Min time between firings — a Go duration: 30s, 1m30s, 500ms. Units ns, us, ms, s, m, h. Blank = none.',
  trigger: 'Rising edge fires once on false→true; every cycle fires each poll while true.',
  match: 'Combine conditions: a single one, all of them (AND), or any of them (OR).',
  device: 'IO-Link device name (config.yaml port). Leave blank for tsend2mqtt / PLC.',
  tag: 'Field to test: a .udt tag (PLC) or decoded device field (IO-Link). Exact match.',
  operator: '= ≠ any type; < ≤ > ≥ numbers only; “changed” = value changed since last cycle.',
  value: 'Value to compare against; type follows the field. Not used with “changed”.',
  topic: 'Absolute MQTT topic to publish to when the rule fires (no prefix added).',
  payload: 'Message body, usually JSON. Defaults to {} if left blank.',
  source: 'Device the incident is attributed to; builds the dedup_key {prefix}/{source}-{rule}.',
  severity: 'Urgency — maps to PagerDuty: critical, error, warning, info.',
  summary: 'One-line human-readable alert text (max 120 characters).',
};

const emptyCond = (): Cond => ({ kind: 'cond', tag: '', op: 'eq', value: '' });

function exampleModel(): RulesModel {
  return {
    rules: [
      {
        name: 'alarm-camera',
        cooldown: '45s',
        edge: 'rising',
        condition: { kind: 'cond', tag: 'AlarmActive', op: 'eq', value: 'true' },
        actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
        incident: { source: 'plc1', severity: 'critical', summary: 'Machine alarm active' },
      },
      {
        name: 'pump-overtemp',
        cooldown: '60s',
        edge: 'rising',
        condition: {
          kind: 'and',
          children: [
            { kind: 'cond', device: 'vibration1', tag: 'alert_vrms_max', op: 'eq', value: 'true' },
            { kind: 'cond', device: 'vibration1', tag: 'temperature', op: 'gt', value: '50.0' },
          ],
        },
        actions: [],
        incident: { source: 'vibration1', severity: 'warning', summary: 'Pump 1 vibration + overtemp' },
      },
    ],
  };
}

// ---- scoped styles -------------------------------------------------------

const STYLE_ID = 'octaview-rules-editor-styles';

/**
 * Declarations that apply when the editor is narrow. Emitted twice, once for a
 * narrow window and once for a narrow container: the editor is embedded, so it
 * can sit in a small column on a wide screen, which a viewport query misses.
 * Controls go to 16px because iOS Safari zooms the page when a focused field is
 * smaller, and the small controls get a 44px target (WCAG 2.5.8 asks 24px).
 */
const NARROW = `
  .re-root .re-field input, .re-root .re-field select { font-size:16px; }
  .re-root .re-field input.re-mono { font-size:16px; }
  .re-root .re-f-name input { font-size:17px; }
  .re-root .re-import textarea { font-size:16px; }
  .re-root .re-remove { min-width:44px; min-height:44px; display:inline-flex; align-items:center; justify-content:center; margin-bottom:0; }
  .re-root .re-link { min-height:44px; display:inline-flex; align-items:center; padding:0; }
  .re-root .re-btn-primary { min-height:44px; }
  .re-root .re-toggle input { width:22px; height:22px; }
  .re-root .re-row, .re-root .re-pubrow, .re-root .re-incrow { grid-template-columns:1fr 1fr; }
  .re-root .re-row .re-remove { grid-column:auto; justify-self:end; }
`;
const NARROW_BLOCKS = `
@media (max-width:560px) {${NARROW}}
@container re (max-width:560px) {${NARROW}}
`;
const STYLES = `
.re-root {
  --re-accent: var(--accent, #FF5C00);
  --re-accent-hover: var(--accent-hover, #E65200);
  --re-ink: var(--ink, #0E0E16);
  --re-surface: var(--surface, #ffffff);
  --re-bg: var(--bg, #F7F7F5);
  --re-g700: var(--gray-700, #3C3C4A);
  --re-g500: var(--gray-500, #6E6E7C);
  --re-g300: var(--gray-300, #B9B9C2);
  --re-g200: var(--gray-200, #E3E3E8);
  --re-ok: var(--ok, #30A46C);
  --re-warn: var(--warning, #F5B82E);
  --re-danger: var(--incident, #E5484D);
  --re-r: 8px; --re-rlg: 16px;
  --re-font: var(--font-body, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  --re-mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  --re-head: var(--font-heading, var(--re-font));
  font-family: var(--re-font); color: var(--re-ink); font-size: 14px; line-height: 1.5;
  /* The editor is embedded, so it can be narrow inside a wide window. */
  container-type: inline-size; container-name: re;
}
.re-root *, .re-root *::before, .re-root *::after { box-sizing: border-box; }
.re-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:22px; margin-bottom:18px; }
.re-btn-primary { background:var(--re-accent); color:#fff; border:none; border-radius:999px; padding:9px 18px; font-family:var(--re-font); font-size:14px; cursor:pointer; }
.re-btn-primary:hover { background:var(--re-accent-hover); }
.re-link { background:none; border:none; padding:2px 0; margin:0; cursor:pointer; font-family:var(--re-font); font-size:14px; color:var(--re-accent); line-height:1.4; }
.re-link:hover { text-decoration:underline; }
.re-link:disabled { color:var(--re-g300); cursor:not-allowed; text-decoration:none; }
.re-link.re-danger { color:var(--re-g500); }
.re-link.re-danger:hover { color:var(--re-danger); }
.re-remove { background:none; border:none; cursor:pointer; color:var(--re-g300); font-size:19px; line-height:1; padding:0 2px; align-self:end; margin-bottom:8px; }
.re-remove:hover { color:var(--re-danger); }
.re-status { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:13px; color:var(--re-g700); margin-bottom:22px; max-width:900px; }
.re-status .re-dot { width:8px; height:8px; border-radius:999px; background:var(--re-g300); flex:none; }
.re-status.is-ok .re-dot { background:var(--re-ok); }
.re-status.is-error .re-dot { background:var(--re-warn); }
.re-status ul { flex-basis:100%; list-style:none; margin:4px 0 0; padding-left:12px; border-left:2px solid var(--re-warn); }
.re-status li { font-size:12.5px; color:var(--re-g700); padding:2px 0; }
.re-rules { background:var(--re-surface); border:1px solid var(--re-g200); border-radius:var(--re-rlg); max-width:900px; }
.re-rule { padding:32px 34px; }
.re-rule + .re-rule { border-top:1px solid var(--re-g200); }
.re-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
.re-field > span { font-size:11px; color:var(--re-g500); }
.re-field input, .re-field select { font-family:var(--re-font); font-size:14px; color:var(--re-ink); background:var(--re-surface); border:1px solid var(--re-g200); border-radius:var(--re-r); padding:8px 10px; width:100%; }
.re-field input.re-mono { font-family:var(--re-mono); font-size:13px; }
.re-field input::placeholder { color:var(--re-g300); }
.re-field input:focus, .re-field select:focus { outline:none; border-color:var(--re-accent); }
.re-field.is-invalid input, .re-field.is-invalid select { border-color:var(--re-danger); }
.re-field.is-invalid > span { color:var(--re-danger); }
.re-group.is-invalid { border-left-color:var(--re-danger); }
.re-rule.is-invalid { box-shadow:inset 2px 0 0 var(--re-danger); }
.re-f-name { flex:1 1 200px; }
.re-f-name input { font-family:var(--re-head); font-weight:600; font-size:15px; }
.re-f-cool { flex:0 0 100px; }
.re-f-trig { flex:0 0 140px; }
.re-f-dev { flex:0 0 108px; }
.re-f-tag { flex:1 1 150px; }
.re-f-op { flex:0 0 150px; }
.re-f-val { flex:1 1 110px; }
.re-f-match { flex:0 0 auto; }
.re-f-match > span { display:none; }
.re-f-match select { min-width:158px; width:auto; }
.re-info { margin-left:5px; color:var(--re-g300); font-size:11px; cursor:help; }
.re-info:hover { color:var(--re-accent); }
.re-rule-head { display:flex; flex-wrap:wrap; align-items:flex-end; gap:16px; }
.re-rule-head .re-link.re-danger { margin-left:auto; align-self:flex-end; margin-bottom:8px; }
.re-part { margin-top:22px; }
.re-part-head { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:8px; }
.re-part-label { font-family:var(--re-head); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.6px; color:var(--re-g500); }
.re-mode { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:0 0 8px; }
.re-mode-lead { font-size:13px; color:var(--re-g500); }
.re-row { display:grid; grid-template-columns:112px minmax(0,1fr) 148px minmax(0,1fr) 18px; gap:14px; align-items:end; padding:5px 0; }
.re-row .re-remove { grid-column:5; }
.re-group { border-left:2px solid var(--re-g200); padding-left:16px; margin:6px 0 6px 2px; }
.re-grouphead { display:flex; align-items:center; gap:10px; margin-bottom:2px; }
.re-children { margin-top:2px; }
.re-add { display:flex; gap:20px; padding:8px 0 2px; }
.re-pubrow { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) 18px; gap:14px; align-items:end; padding:5px 0; }
.re-incrow { display:grid; grid-template-columns:112px 148px minmax(0,1fr); gap:14px; align-items:end; padding:4px 0; }
.re-publist { display:flex; flex-direction:column; gap:6px; }
.re-toggle { display:inline-flex; align-items:center; gap:8px; font-size:13px; color:var(--re-g700); cursor:pointer; }
.re-toggle input { width:15px; height:15px; accent-color:var(--re-accent); }
.re-empty { color:var(--re-g500); padding:48px 28px; text-align:center; }
.re-import { background:var(--re-surface); border:1px solid var(--re-g200); border-radius:var(--re-rlg); padding:20px; margin-bottom:24px; max-width:900px; }
.re-import-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.re-import textarea { width:100%; border:1px solid var(--re-g200); border-radius:var(--re-r); padding:12px; font-family:var(--re-mono); font-size:13px; background:var(--re-bg); color:var(--re-ink); resize:vertical; }
.re-import-actions { display:flex; align-items:center; gap:16px; margin-top:12px; }
.re-import-msg { font-size:13px; margin-top:10px; }
.re-import-msg.is-ok { color:var(--re-ok); }
.re-import-msg.is-error { color:var(--re-danger); }
${NARROW_BLOCKS}`;

function injectStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// ---- component -----------------------------------------------------------

export function initRulesEditor(root: HTMLElement, opts: RulesEditorOptions = {}): RulesEditorHandle {
  injectStyles();
  root.classList.add('re-root');

  // A malformed initialXml is reported through `errors`, never thrown.
  let parseError: string | null = null;
  let model: RulesModel;
  if (opts.initialXml !== undefined) {
    try {
      model = parse(opts.initialXml);
    } catch (e) {
      model = { rules: [] };
      parseError = e instanceof RulesParseError ? e.message : 'Could not parse XML.';
    }
  } else {
    model = opts.initialModel ? clone(opts.initialModel) : exampleModel();
  }

  /** Validation messages, with any initial parse error surfaced first. */
  const computeErrors = (): string[] => {
    const errs = validate(model);
    return parseError ? [parseError, ...errs] : errs;
  };

  const exportBtn = el('button', { class: 're-link', type: 'button', onclick: () => download() }, ['Export XML']);
  const copyBtn = el('button', { class: 're-link', type: 'button', onclick: () => copyXml(copyBtn) }, ['Copy XML']);
  const form = el('div', { class: 're-rules' });
  const status = el('div', { class: 're-status' });
  const importPanel = el('div', { class: 're-import', hidden: true });

  // ---- validation + change notification (cheap; runs on every change) ----
  function refresh(): void {
    const errs = computeErrors();
    const n = model.rules.length;
    status.replaceChildren();
    if (errs.length === 0) {
      status.className = 're-status is-ok';
      status.append(el('span', { class: 're-dot' }), `Valid · ${n} rule${n === 1 ? '' : 's'}`);
    } else {
      status.className = 're-status is-error';
      status.append(
        el('span', { class: 're-dot' }),
        `${errs.length} issue${errs.length === 1 ? '' : 's'} to resolve`,
        el('ul', {}, errs.map((e) => el('li', {}, [e])))
      );
    }
    markFields(validateIssues(model));
    const gate = (btn: HTMLButtonElement) => {
      btn.disabled = errs.length > 0;
      if (errs.length) btn.title = `Fix ${errs.length} issue${errs.length === 1 ? '' : 's'} first.`;
      else btn.removeAttribute('title');
    };
    gate(exportBtn);
    gate(copyBtn);
    // onChange still carries the xml while invalid, so a host can autosave a draft.
    opts.onChange?.({ model: clone(model), xml: serialize(model), errors: errs });
  }

  /**
   * Put each issue on the input it belongs to. Runs on every refresh, not only
   * on a re-render, so a mark clears as soon as the field is fixed.
   */
  function markFields(issues: ValidationIssue[]): void {
    const byLoc = new Map<string, string[]>();
    for (const issue of issues) {
      if (issue.rule === undefined) continue; // whole-file issue: status line only
      const key = locKey(issue);
      const found = byLoc.get(key);
      if (found) found.push(issue.message);
      else byLoc.set(key, [issue.message]);
    }
    for (const node of Array.from(form.querySelectorAll<HTMLElement>('[data-loc]'))) {
      const messages = byLoc.get(node.dataset.loc ?? '');
      node.classList.toggle('is-invalid', messages !== undefined);
      if (messages) node.title = messages.join(' ');
      else node.removeAttribute('title');
    }
  }

  // ---- controls ----
  function labelSpan(label: string, help?: string): HTMLElement {
    const span = el('span', {}, [label]);
    if (help) span.append(el('span', { class: 're-info', title: help, 'aria-label': help, role: 'note' }, ['ⓘ']));
    return span;
  }

  function textField(
    label: string,
    value: string | undefined,
    onInput: (v: string) => void,
    o: { placeholder?: string; mono?: boolean; cls?: string; help?: string; loc?: Loc; prose?: boolean } = {}
  ): HTMLElement {
    const input = el('input', {
      type: 'text',
      class: o.mono ? 're-mono' : '',
      value: value ?? '',
      placeholder: o.placeholder ?? '',
      oninput: (e) => { onInput((e.target as HTMLInputElement).value); refresh(); },
    });
    // Identifiers must survive a phone keyboard: iOS otherwise capitalises the
    // first letter and autocorrects, so `alert_temp` is stored as `Alert_temp`
    // and no longer matches the field it names. Prose fields keep the defaults.
    if (!o.prose) {
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('spellcheck', 'false');
    }
    if (o.help) input.title = o.help;
    const field = el('label', { class: `re-field ${o.cls ?? ''}` }, [labelSpan(label, o.help), input]);
    if (o.loc) field.dataset.loc = locKey(o.loc);
    return field;
  }

  function selectField(
    label: string,
    value: string,
    options: Opt[],
    onChange: (v: string) => void,
    rerender = false,
    cls = '',
    help = ''
  ): HTMLElement {
    const sel = el('select', {
      onchange: (e) => {
        onChange((e.target as HTMLSelectElement).value);
        if (rerender) renderForm();
        else refresh();
      },
    });
    for (const opt of options) {
      const o = el('option', { value: opt.value }, [opt.label]);
      if (opt.value === value) o.setAttribute('selected', 'selected');
      sel.append(o);
    }
    if (help) sel.title = help;
    return el('label', { class: `re-field ${cls}` }, [labelSpan(label, help), sel]);
  }

  const linkBtn = (label: string, fn: () => void, cls = '') =>
    el('button', { class: `re-link ${cls}`, type: 'button', onclick: fn }, [label]);
  /** Turn a button off with the reason, so the UI never offers an invalid step. */
  const disableWith = (btn: HTMLButtonElement, why: string): HTMLButtonElement => {
    btn.disabled = true;
    btn.title = why;
    return btn;
  };
  const removeBtn = (title: string, fn: () => void) =>
    el('button', { class: 're-remove', type: 'button', title, 'aria-label': title, onclick: fn }, ['×']);

  // ---- condition tree ----
  function renderLeaf(leaf: Cond, replace: (n: Condition | null) => void, rule: number, path: number[]): HTMLElement {
    const row = el('div', { class: 're-row' }, [
      textField('device', leaf.device, (v) => { if (v) leaf.device = v; else delete leaf.device; }, { placeholder: '—', cls: 're-f-dev', help: HELP.device }),
      textField('tag', leaf.tag, (v) => (leaf.tag = v), { placeholder: 'AlarmActive', cls: 're-f-tag', help: HELP.tag, loc: { rule, field: 'tag', path } }),
      selectField('operator', leaf.op, OP_OPTIONS, (v) => {
        leaf.op = v as Op;
        if (VALUELESS_OPS.includes(leaf.op)) delete leaf.value;
        else if (leaf.value === undefined) leaf.value = '';
      }, true, 're-f-op', HELP.operator),
    ]);
    if (!VALUELESS_OPS.includes(leaf.op)) {
      row.append(textField('value', leaf.value, (v) => (leaf.value = v), { placeholder: 'true', cls: 're-f-val', help: HELP.value, loc: { rule, field: 'value', path } }));
    }
    row.append(removeBtn('Remove condition', () => replace(null)));
    return row;
  }

  function matchSelect(current: Condition | null, apply: (next: Condition | null) => void): HTMLElement {
    const mode = current && isGroup(current) ? current.kind : 'cond';
    return selectField('match', mode, MATCH_OPTIONS, (v) => {
      if (v === 'cond') {
        apply(current && isGroup(current) ? current.children[0] ?? null : current);
      } else if (current && isGroup(current)) {
        (current as Group).kind = v as 'and' | 'or';
      } else {
        apply({ kind: v as 'and' | 'or', children: [current && !isGroup(current) ? current : emptyCond()] });
      }
    }, true, 're-f-match', HELP.match);
  }

  function renderGroupBody(group: Group, depth: number, rule: number, path: number[]): HTMLElement {
    const kids = el('div', { class: 're-children' });
    group.children.forEach((child, i) => {
      const replace = (next: Condition | null) => {
        if (next === null) group.children.splice(i, 1);
        else group.children[i] = next;
        renderForm();
      };
      const childPath = [...path, i];
      kids.append(
        isGroup(child)
          ? renderGroup(child, replace, depth + 1, rule, childPath)
          : renderLeaf(child, replace, rule, childPath)
      );
    });

    // Offer only steps that stay inside the limits validate() enforces.
    // `depth` is this group's own level, so a new child sits at depth + 1 and
    // a new child group needs room for its own condition at depth + 2.
    const full = group.children.length >= LIMITS.maxChildren;
    const fullWhy = `A group holds at most ${LIMITS.maxChildren} conditions.`;
    const deepWhy = `Conditions nest at most ${LIMITS.maxDepth} levels deep.`;

    const addCond = linkBtn('Add condition', () => { group.children.push(emptyCond()); renderForm(); });
    if (full) disableWith(addCond, fullWhy);
    else if (depth >= LIMITS.maxDepth) disableWith(addCond, deepWhy);

    const addGroup = linkBtn('Add group', () => { group.children.push({ kind: 'and', children: [emptyCond()] }); renderForm(); });
    if (full) disableWith(addGroup, fullWhy);
    else if (depth >= LIMITS.maxDepth - 1) disableWith(addGroup, deepWhy);

    const add = el('div', { class: 're-add' }, [addCond, addGroup]);
    return el('div', {}, [kids, add]);
  }

  function renderGroup(
    group: Group,
    replace: (n: Condition | null) => void,
    depth: number,
    rule: number,
    path: number[]
  ): HTMLElement {
    const head = el('div', { class: 're-grouphead' }, [
      matchSelect(group, replace),
      removeBtn('Remove group', () => replace(null)),
    ]);
    const box = el('div', { class: 're-group' }, [head, renderGroupBody(group, depth, rule, path)]);
    box.dataset.loc = locKey({ rule, field: 'condition', path });
    return box;
  }

  function renderConditionArea(rule: Rule, index: number): HTMLElement {
    const wrap = el('div', {}, [
      el('div', { class: 're-mode' }, [
        el('span', { class: 're-mode-lead' }, ['match']),
        matchSelect(rule.condition, (next) => { rule.condition = next; renderForm(); }),
      ]),
    ]);
    const c = rule.condition;
    if (!c) {
      // Nothing to mark inside, so the area itself carries the issue.
      wrap.dataset.loc = locKey({ rule: index, field: 'condition' });
      wrap.append(linkBtn('Add condition', () => { rule.condition = emptyCond(); renderForm(); }));
    } else if (isGroup(c)) {
      wrap.append(renderGroupBody(c, 1, index, []));
    } else {
      wrap.append(renderLeaf(c, (next) => { rule.condition = next; renderForm(); }, index, []));
    }
    return wrap;
  }

  const part = (label: string, trailing?: Node): HTMLElement =>
    el('div', { class: 're-part-head' }, [el('span', { class: 're-part-label' }, [label]), ...(trailing ? [trailing] : [])]);

  // ---- one rule ----
  function renderRule(rule: Rule, index: number): HTMLElement {
    const head = el('div', { class: 're-rule-head' }, [
      textField('rule name', rule.name, (v) => (rule.name = v), { placeholder: 'rule-name', cls: 're-f-name', help: HELP.name, loc: { rule: index, field: 'name' } }),
      textField('cooldown', rule.cooldown, (v) => { if (v) rule.cooldown = v; else delete rule.cooldown; }, { placeholder: 'none', cls: 're-f-cool', help: HELP.cooldown, loc: { rule: index, field: 'cooldown' } }),
      selectField('trigger', rule.edge ?? 'none', TRIGGER_OPTIONS, (v) => { if (v === 'none') delete rule.edge; else rule.edge = v as Rule['edge']; }, false, 're-f-trig', HELP.trigger),
      linkBtn('Delete rule', () => { model.rules.splice(index, 1); renderForm(); }, 're-danger'),
    ]);

    const actRows = el('div', { class: 're-publist' });
    rule.actions.forEach((a, i) => {
      actRows.append(
        el('div', { class: 're-pubrow' }, [
          textField('topic', a.topic, (v) => (a.topic = v), { placeholder: 'camera/record', help: HELP.topic, loc: { rule: index, field: 'topic', action: i } }),
          textField('payload', a.payload, (v) => { if (v) a.payload = v; else delete a.payload; }, { placeholder: '{}', mono: true, help: HELP.payload }),
          removeBtn('Remove action', () => { rule.actions.splice(i, 1); renderForm(); }),
        ])
      );
    });

    const incCheckbox = el('input', { type: 'checkbox', onchange: (e) => {
      rule.incident = (e.target as HTMLInputElement).checked ? { source: '', severity: 'warning', summary: '' } : null;
      renderForm();
    } });
    if (rule.incident) incCheckbox.setAttribute('checked', 'checked');
    const incToggle = el('label', { class: 're-toggle' }, [incCheckbox, el('span', {}, ['enabled'])]);
    const incBody = el('div', { class: 're-incrow' });
    if (rule.incident) {
      const inc = rule.incident;
      incBody.append(
        textField('source', inc.source, (v) => (inc.source = v), { placeholder: 'plc1', help: HELP.source, loc: { rule: index, field: 'source' } }),
        selectField('severity', inc.severity, SEVERITY_OPTIONS, (v) => (inc.severity = v as typeof inc.severity), false, '', HELP.severity),
        textField('summary', inc.summary, (v) => (inc.summary = v), { placeholder: 'Machine alarm active', help: HELP.summary, loc: { rule: index, field: 'summary' }, prose: true })
      );
    }

    const box = el('div', { class: 're-rule' }, [
      head,
      el('div', { class: 're-part' }, [part('When'), renderConditionArea(rule, index)]),
      el('div', { class: 're-part' }, [part('Then publish', linkBtn('Add publish', () => { rule.actions.push({ topic: '' }); renderForm(); })), actRows]),
      el('div', { class: 're-part' }, [part('Raise incident', incToggle), incBody]),
    ]);
    // An issue with no single field (no actions and no incident) lands here.
    box.dataset.loc = locKey({ rule: index });
    return box;
  }

  function renderForm(): void {
    form.replaceChildren();
    if (model.rules.length === 0) {
      form.append(el('p', { class: 're-empty' }, ['No rules yet — add one, or load the example.']));
    }
    model.rules.forEach((r, i) => form.append(renderRule(r, i)));
    refresh();
  }

  // ---- import ----
  function buildImportPanel(): void {
    const ta = el('textarea', { class: 're-mono', rows: 10, placeholder: 'Paste rules.xml here…', spellcheck: false }) as HTMLTextAreaElement;
    const msg = el('div', { class: 're-import-msg' });
    const file = el('input', { type: 'file', accept: '.xml,text/xml,application/xml' }) as HTMLInputElement;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) ta.value = await f.text();
    });
    const doImport = () => {
      try {
        model = parse(ta.value);
        parseError = null;
        msg.className = 're-import-msg is-ok';
        msg.textContent = `Imported ${model.rules.length} rule(s).`;
        importPanel.hidden = true;
        renderForm();
      } catch (err) {
        msg.className = 're-import-msg is-error';
        msg.textContent = err instanceof RulesParseError ? err.message : 'Could not parse XML.';
      }
    };
    importPanel.replaceChildren(
      el('div', { class: 're-import-head' }, [el('strong', {}, ['Import rules.xml']), removeBtn('Close', () => (importPanel.hidden = true))]),
      ta,
      el('div', { class: 're-import-actions' }, [file, el('button', { class: 're-btn-primary', type: 'button', onclick: doImport }, ['Import'])]),
      msg
    );
  }

  // ---- export ----
  function download(): void {
    const blob = new Blob([serialize(model)], { type: 'application/xml' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'rules.xml' });
    document.body.append(a);
    a.click();
    a.remove();
  }
  async function copyXml(btn: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(serialize(model));
      const old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = old), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  // ---- toolbar + layout ----
  const toolbar = el('div', { class: 're-toolbar' }, [
    el('button', { class: 're-btn-primary', type: 'button', onclick: () => { parseError = null; model.rules.push({ name: 'new-rule', condition: emptyCond(), actions: [], incident: null }); renderForm(); } }, ['Add rule']),
    linkBtn('Import XML', () => { buildImportPanel(); importPanel.hidden = false; }),
    exportBtn,
    copyBtn,
    linkBtn('Load example', () => { parseError = null; model = exampleModel(); renderForm(); }),
    linkBtn('Clear', () => { parseError = null; model = { rules: [] }; renderForm(); }),
  ]);

  root.replaceChildren(toolbar, status, importPanel, form);
  renderForm();

  return {
    getModel: () => clone(model),
    getXml: () => serialize(model),
    getErrors: () => computeErrors(),
    setModel: (m: RulesModel) => { parseError = null; model = clone(m); renderForm(); },
    destroy: () => { root.replaceChildren(); root.classList.remove('re-root'); },
  };
}

// ---- re-exports: one entry for the editor + the core ---------------------
export { serialize } from './serialize.js';
export { parse, validate, validateIssues, RulesParseError } from './parse.js';
export type { ValidationIssue } from './parse.js';
export {
  OPERATORS,
  SEVERITIES,
  EDGES,
  VALUELESS_OPS,
  OP_ALIASES,
  LIMITS,
  COOLDOWN_PATTERN,
  COOLDOWN_RE,
  isGroup,
  canonicalOp,
} from './model.js';
export type {
  Op,
  Severity,
  Edge,
  Cond,
  Group,
  Condition,
  Publish,
  Incident,
  Rule,
  RulesModel,
} from './model.js';
