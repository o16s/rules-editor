// Drop-in rules.xml editor component (browser). Self-contained: it injects its
// own scoped, prefixed styles (`re-*` under `.re-root`) and depends only on the
// tested core (model/formula/serialize/parse/validate) — no external stylesheet.
//
//   import { initRulesEditor } from '@octanis/rules-editor';
//   const editor = initRulesEditor(document.getElementById('app'), {
//     initialModel,                       // optional; defaults to an example
//     onChange: ({ model, xml, errors }) => save(xml),
//     monitor: (ref) => liveValues[ref.kind === 'variable' ? ref.name : ref.index],
//   });
//   editor.getXml(); editor.getModel(); editor.setModel(m); editor.destroy();
//
// Layout: a rule rail on the left, and for the selected rule three sheets —
// Variables (name / formula / result / description), When (condition / result
// / description) and Then (action / field / formula / result) — in the
// spreadsheet style of the design handoff. Colours and fonts read the host's
// design tokens (--accent, --ink, --font-body, …) with fallbacks.
//
// This file owns the public API, the shared state, validation and the render
// cycle. The parts live in `gui/`: the rail, the sheets, the cells, the
// formula bar of the phone layout, the autocomplete menu, the XML panel, the
// styles, and the example file.

import type { RulesModel } from './model.js';
import { serialize } from './serialize.js';
import { parse, validateIssues, RulesParseError, type ValidationIssue } from './parse.js';
import type { Token } from './formula.js';
import type { TagCatalog } from './catalog.js';
import { clone, el } from './gui/dom.js';
import { exampleModel } from './gui/example.js';
import { injectStyles, WIDTH_CLASSES } from './gui/styles.js';
import { locKey, type EditorState, type Monitor, type MonitorRef, type SheetName } from './gui/state.js';
import { createMenu } from './gui/menu.js';
import { createBar } from './gui/bar.js';
import { createCells } from './gui/cells.js';
import { createRail } from './gui/rail.js';
import { createSheets } from './gui/sheets.js';
import { createXmlPanel } from './gui/xml-panel.js';

export type { MonitorRef };

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
  /**
   * Called once on mount and after every committed edit: a text cell commits
   * on Enter, Tab, or when it loses focus; choices, Add, Delete and Import
   * commit at once. Keystrokes inside a cell do not fire it.
   */
  onChange?: (state: { model: RulesModel; xml: string; errors: string[] }) => void;
  /**
   * Live values for the "Formula result" and "Condition result" cells. Called
   * when a rule is rendered and on `refreshValues()`. Return undefined for a
   * cell with no value; it shows "—".
   */
  monitor?: (ref: MonitorRef) => string | undefined;
  /**
   * The devices and tags the gateway knows, for the TAG("…") autocomplete.
   * Typing `TAG("` lists devices (and the tags of a device-less source);
   * after the device, the tags of that device. A function is read each time
   * the menu opens, so it can return live values. Update later with
   * `setCatalog()`. Without a catalog the editor works as before.
   */
  catalog?: TagCatalog | (() => TagCatalog);
}

export interface RulesEditorHandle {
  /** Deep copy of the current model. */
  getModel(): RulesModel;
  /** Current model serialized to rules.xml. */
  getXml(): string;
  /** Validation messages for the current model (empty = valid). */
  getErrors(): string[];
  /** Replace the model and re-render. The selected rule is kept when it still exists. */
  setModel(model: RulesModel): void;
  /** Re-read `monitor` for every result cell, without a re-render. Call it when live values change. */
  refreshValues(): void;
  /** Replace the `monitor` callback and re-read every result cell. */
  setMonitor(monitor: ((ref: MonitorRef) => string | undefined) | undefined): void;
  /** Replace the tag catalog. Takes effect the next time the TAG("…") menu opens. */
  setCatalog(catalog: TagCatalog | (() => TagCatalog) | undefined): void;
  /**
   * Replace the file from rules.xml text. Returns the validation messages; a
   * malformed file is reported there and leaves the editor unchanged.
   */
  setXml(xml: string): string[];
  /** Tear down the editor (empties the container). */
  destroy(): void;
}

/** Editors mounted so far, for unique ids (tabs and their panels). */
let instances = 0;

const parseErrorText = (e: unknown): string => (e instanceof RulesParseError ? e.message : 'Could not parse XML.');

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
      parseError = parseErrorText(e);
    }
  } else {
    model = opts.initialModel ? clone(opts.initialModel) : exampleModel();
  }
  const state: EditorState = {
    model,
    parseError,
    selected: 0,
    filter: '',
    focusNext: null,
    narrow: false,
    activeSheet: 'vars',
    batching: false,
    monitor: opts.monitor,
    catalog: opts.catalog,
  };
  const uid = ++instances;

  /** Validation messages, with any initial parse error surfaced first. */
  const computeErrors = (issues: ValidationIssue[] = validateIssues(state.model)): string[] => {
    const errs = issues.map((i) => i.message);
    return state.parseError ? [state.parseError, ...errs] : errs;
  };

  const status = el('div', { class: 're-status', role: 'alert' });
  const pane = el('section', { class: 're-pane' });
  const xmlPanel = createXmlPanel({
    xml: () => serialize(state.model),
    onImport: (next) => replaceModel(next, true),
  });
  const menu = createMenu({
    root,
    state,
    inline: (input) => (input === bar.input ? { container: bar.element, before: bar.line } : null),
    cellInputOf: (input) => (input === bar.input ? bar.selectedInput() : input),
  });
  const bar = createBar({ state, pane, menu, messageFor });
  const cells = createCells({ state, menu, bar, refresh });
  const rail = createRail({ state, pane, render, renderSelected });
  const sheets = createSheets({ state, pane, uid, cells, bar, rail, render, refresh });

  // ---- validation + change notification (runs once per committed change) ----
  function refresh(): void {
    if (state.batching) return;
    const issues = validateIssues(state.model);
    const errs = computeErrors(issues);
    status.replaceChildren();
    const fileLevel = issues.filter((i) => i.rule === undefined).map((i) => i.message);
    if (state.parseError) fileLevel.unshift(state.parseError);
    status.className = fileLevel.length ? 're-status is-error' : 're-status';
    status.textContent = fileLevel.join(' ');
    markFields(issues);
    rail.mark(issues);
    sheets.updatePreviews();
    const xml = serialize(state.model);
    xmlPanel.sync(xml);
    xmlPanel.gate(errs.length);
    // onChange still carries the xml while invalid, so a host can autosave a draft.
    opts.onChange?.({ model: clone(state.model), xml, errors: errs });
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
    for (const node of Array.from(pane.querySelectorAll<HTMLElement>('[data-loc]'))) {
      const loc = node.dataset.loc ?? '';
      const messages = byLoc.get(loc);
      node.classList.toggle('is-invalid', messages !== undefined);
      // The message is text on the page, not a tooltip: touch has no hover.
      // A cell's message goes under its row, across every column, so a narrow
      // column never has to fit a sentence.
      const shown = messageFor(node);
      if (messages) {
        node.title = messages.join(' ');
        const p = shown ?? messageHost(node).appendChild(el('p', { class: 're-msg', 'data-for': loc }));
        p.textContent = messages.join(' ');
      } else {
        node.removeAttribute('title');
        shown?.remove();
      }
    }
  }

  /** Where a node's message goes: under a cell's row, else inside the node. */
  const messageHost = (node: HTMLElement): HTMLElement =>
    node.classList.contains('re-cell') ? node.parentElement ?? node : node;

  /** The message element shown for a marked node, or null. */
  function messageFor(node: HTMLElement): HTMLElement | null {
    const loc = node.dataset.loc ?? '';
    const found = Array.from(messageHost(node).children).find(
      (c) => c.classList.contains('re-msg') && (c as HTMLElement).dataset.for === loc
    );
    return (found as HTMLElement | undefined) ?? null;
  }

  // ---- width: the phone model below 560px ----
  /**
   * In narrow mode the in-cell inputs are display only: read-only and out of
   * the tab order, so neither a tap nor Safari's form-navigation arrows can
   * focus one (a focused 13px field makes iOS zoom the page). The bar edits.
   */
  function lockCells(): void {
    for (const input of Array.from(pane.querySelectorAll<HTMLInputElement>('.re-cell input'))) {
      input.readOnly = state.narrow;
      input.tabIndex = state.narrow ? -1 : 0;
    }
  }

  function setNarrow(v: boolean): void {
    if (v === state.narrow) return;
    state.narrow = v;
    // A cell being typed into when the width crosses the line commits first,
    // so its draft is not stranded in an input that is about to be locked.
    const active = document.activeElement;
    if (v && active instanceof HTMLInputElement && active.closest('.re-cell') && pane.contains(active)) active.blur();
    lockCells();
    sheets.applyVisibility();
    if (v) bar.update();
    else bar.clear();
  }

  /** Read the container width and set the width classes; 0 (not in the DOM yet) changes nothing. */
  const measure = (): void => {
    const width = root.clientWidth;
    if (width <= 0) return;
    for (const [cls, max] of WIDTH_CLASSES) root.classList.toggle(cls, width <= max);
    setNarrow(width <= 560);
  };
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  resizeObserver?.observe(root);

  // ---- render ----
  /** Rebuild everything: the rail and the pane. For structural changes. */
  function render(): void {
    beginRender();
    rail.render();
    endRender();
  }

  /** Rebuild the pane only; the rail keeps its rows. For a change of selection. */
  function renderSelected(): void {
    beginRender();
    endRender();
  }

  function beginRender(): void {
    measure();
    // A draft in the bar survives a structural change (Add, Delete) by being
    // committed first. Its own refresh is skipped: endRender runs one.
    state.batching = true;
    bar.commit();
    state.batching = false;
    bar.reset();
  }

  function endRender(): void {
    sheets.render();
    lockCells();
    refresh();
    if (!state.focusNext) return;
    const target = pane.querySelector<HTMLElement>(`[data-loc="${state.focusNext}"]`);
    state.focusNext = null;
    if (!target) return;
    if (state.narrow && target.classList.contains('re-cell')) {
      const sheet = target.closest<HTMLElement>('.re-sheet-block')?.dataset.sheet as SheetName | undefined;
      if (sheet) { state.activeSheet = sheet; sheets.applyVisibility(); }
      bar.select(target);
      // The row came from a tap on Add, so the keyboard may open right away.
      bar.input.focus();
    } else {
      target.querySelector<HTMLElement>('input')?.focus();
    }
  }

  /** Swap in a new file; `first` shows its first rule, else the selection is kept when it still exists. */
  function replaceModel(next: RulesModel, first = false): void {
    state.parseError = null;
    state.model = next;
    if (first || state.selected >= next.rules.length) state.selected = 0;
    render();
  }

  // ---- top bar + layout ----
  const top = el('div', { class: 're-top' }, [
    el('span', { class: 're-title' }, ['Rules']),
    el('div', { class: 're-top-actions' }, [
      el('button', { class: 're-btn', type: 'button', onclick: () => xmlPanel.toggle() }, ['XML']),
      el('button', { class: 're-btn-primary', type: 'button', onclick: () => {
        state.parseError = null;
        state.model.rules.push({ name: 'new-rule', variables: [], match: 'any', conditions: [{ expr: '' }], actions: [], incident: null });
        state.selected = state.model.rules.length - 1;
        state.focusNext = locKey({ rule: state.selected, field: 'name' });
        render();
      } }, ['Add rule']),
    ]),
  ]);

  root.replaceChildren(top, status, xmlPanel.element, el('div', { class: 're-body' }, [rail.element, pane]), bar.element, menu.element);
  render();

  return {
    getModel: () => clone(state.model),
    getXml: () => serialize(state.model),
    getErrors: () => computeErrors(),
    setModel: (m: RulesModel) => replaceModel(clone(m)),
    refreshValues: cells.refreshValues,
    setMonitor: (m: Monitor | undefined) => { state.monitor = m; cells.refreshValues(); },
    setCatalog: (c: TagCatalog | (() => TagCatalog) | undefined) => { state.catalog = c; menu.close(); },
    setXml: (xml: string) => {
      try {
        replaceModel(parse(xml));
        return computeErrors();
      } catch (e) {
        return [parseErrorText(e)];
      }
    },
    destroy: () => {
      resizeObserver?.disconnect();
      bar.destroy();
      menu.destroy();
      root.replaceChildren();
      root.classList.remove('re-root', ...WIDTH_CLASSES.map(([cls]) => cls));
    },
  };
}

export type { Token };

// ---- re-exports: one entry for the editor + the core ---------------------
export { serialize } from './serialize.js';
export { parse, validate, validateIssues, RulesParseError } from './parse.js';
export type { ValidationIssue } from './parse.js';
export {
  FUNCTIONS,
  RESERVED_NAMES,
  CONTEXT_NAMES,
  FormulaError,
  parseFormula,
  printFormula,
  formulaTokens,
  formulaRefs,
  inferType,
  checkFunctions,
  functionSpec,
  legacyCondToFormula,
  isFormula,
  formulaBody,
  quoteString,
} from './formula.js';
export type { Ast, BinaryOp, FormulaType, FunctionSpec, FormulaRefs, TagRef, TokenKind } from './formula.js';
export { tagContext, tagChoices, applyTagChoice, nameContext, nameChoices, applyNameChoice } from './catalog.js';
export type { TagCatalog, DeviceEntry, TagEntry, TagContext, TagChoice, NameContext, NameChoice } from './catalog.js';
export {
  OPERATORS,
  SEVERITIES,
  EDGES,
  MATCHES,
  VALUELESS_OPS,
  OP_ALIASES,
  LIMITS,
  COOLDOWN_PATTERN,
  COOLDOWN_RE,
  VARIABLE_NAME_PATTERN,
  VARIABLE_NAME_RE,
  canonicalOp,
} from './model.js';
export type {
  Op,
  Severity,
  Edge,
  Match,
  Variable,
  Cond,
  Publish,
  Incident,
  Rule,
  RulesModel,
} from './model.js';
