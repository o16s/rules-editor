import { describe, it, expect, beforeEach } from 'vitest';
// Everything is importable from the one entry (the editor + the core).
import { LIMITS } from './model.js';
import {
  initRulesEditor,
  parse,
  serialize,
  validate,
  RulesParseError,
  type RulesEditorHandle,
  type RulesModel,
  type Rule,
} from './gui.js';

function setup(opts?: Parameters<typeof initRulesEditor>[1]): { root: HTMLElement; api: RulesEditorHandle } {
  const root = document.createElement('div');
  document.body.append(root);
  const api = initRulesEditor(root, opts);
  return { root, api };
}

/** Buttons by their text, or by aria-label for the icon-only ones. */
function buttons(root: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll('button')).filter(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label
  ) as HTMLButtonElement[];
}
function button(root: HTMLElement, label: string): HTMLButtonElement {
  const b = buttons(root, label)[0];
  if (!b) throw new Error(`button "${label}" not found`);
  return b;
}
function inputByLabel(root: HTMLElement, label: string): HTMLInputElement {
  const i = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!i) throw new Error(`input "${label}" not found`);
  return i;
}
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

const rule = (over: Partial<Rule> = {}): Rule => ({
  name: 'r',
  variables: [{ name: 'temp', formula: 'TAG("t")' }],
  match: 'any',
  conditions: [{ expr: 'temp > 50' }],
  actions: [{ topic: 't' }],
  incident: null,
  ...over,
});
const wrap = (over: Partial<Rule> = {}): RulesModel => ({ rules: [rule(over)] });

describe('rules editor component (jsdom)', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('renders the example model: rail rows, the first rule selected, three sheets', () => {
    const { root, api } = setup();
    expect(api.getXml()).toContain('name="alarm-camera"');
    expect(api.getErrors()).toEqual([]);
    expect(root.querySelectorAll('.re-rail-row').length).toBe(6);
    expect(root.querySelector('.re-rail-row.is-selected')?.textContent).toContain('alarm-camera');
    expect(root.querySelector('.re-sheet-vars .re-row:not(.re-row-add)')).toBeTruthy();
    expect(root.querySelectorAll('.re-sheet-vars .re-row:not(.re-row-add)').length).toBe(10);
    expect(root.querySelectorAll('.re-sheet-when .re-row:not(.re-row-add)').length).toBe(5);
    expect(root.querySelectorAll('.re-sheet-then .re-row:not(.re-row-add)').length).toBe(6);
    expect(root.classList.contains('re-root')).toBe(true);
  });

  it('shows column headers and the When sentence from the design', () => {
    const { root } = setup();
    const text = root.textContent ?? '';
    for (const h of ['Name', 'Formula', 'Formula result', 'Description', 'Condition', 'Condition result', 'Action', 'Field']) expect(text).toContain(h);
    const when = root.querySelector('.re-when-title')!;
    expect(when.textContent).toContain('When');
    expect(when.textContent).toContain('of these');
    const selects = when.querySelectorAll('select');
    expect(selects[0].value).toBe('any');
    expect(selects[1].value).toBe('rising');
    expect(root.textContent).toContain('Actions are fired at most once every');
    expect(/[\u{1F000}-\u{1FAFF}⚙✅↗✖\u{1F5D1}]/u.test(root.textContent ?? '')).toBe(false);
  });

  it('colours formula tokens in the view and shows the = prefix', () => {
    const { root } = setup();
    const view = root.querySelector('.re-sheet-vars .re-cell-formula .re-formula-view')!;
    expect(view.textContent).toBe('=TAG("plc1", "AlarmActive")');
    expect(view.querySelector('.re-tok-function')?.textContent).toBe('TAG');
    expect(view.querySelectorAll('.re-tok-string').length).toBe(2);
  });

  it('shows Then rows per field, with the literal as its result and a folded formula preview', () => {
    const { root } = setup();
    const rows = Array.from(root.querySelectorAll('.re-sheet-then .re-row:not(.re-row-add)'));
    const fields = rows.map((r) => r.querySelector('.re-cell-field')?.textContent);
    expect(fields).toEqual(['topic', 'payload', 'source', 'title', 'first step', 'cause']);
    expect(rows[0].querySelector('.re-cell-result')?.textContent).toBe('camera/record');
    expect(rows[0].querySelector('select')?.value).toBe('publish');
    expect(rows[3].querySelector('select')?.value).toBe('critical');
    // cause = condition.description & "…" previews with the first condition's description
    expect(rows[5].querySelector('.re-cell-result')?.textContent).toMatch(/^Cell 3 PLC raised its own alarm\. The press PLC/);
  });

  it('fills result cells from the monitor callback, and shows a dash without one', () => {
    const { root } = setup({
      monitor: (ref) => (ref.kind === 'variable' ? `${ref.name}!` : ref.kind === 'condition' ? `c${ref.index}` : undefined),
    });
    expect(root.querySelector('.re-sheet-vars .re-cell-result')?.textContent).toBe('alarm_active!');
    expect(root.querySelector('.re-sheet-when .re-cell-result')?.textContent).toBe('c0');
    const { root: plain } = setup();
    expect(plain.querySelector('.re-sheet-vars .re-cell-result')?.textContent).toBe('');
  });

  it('selects a rule from the rail and from the narrow select', () => {
    const { root } = setup();
    (root.querySelectorAll('.re-rail-row')[1] as HTMLElement).click();
    expect(root.querySelector('.re-rail-row.is-selected')?.textContent).toContain('pump-overtemp');
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('pump-overtemp');
    choose(root.querySelector('.re-rail-select') as HTMLSelectElement, '2');
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('wetwell-highlevel');
  });

  it('filters the rail by name', () => {
    const { root } = setup();
    type(inputByLabel(root, 'Filter rules'), 'milk');
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.re-rail-row'));
    expect(rows.filter((r) => !r.hidden).map((r) => r.textContent)).toHaveLength(1);
    expect(rows.find((r) => !r.hidden)?.textContent).toContain('bulk1-milk-temp');
    type(inputByLabel(root, 'Filter rules'), '');
    expect(rows.filter((r) => !r.hidden)).toHaveLength(6);
  });

  it('Add rule appends and selects a rule; the rail meta shows the trigger', () => {
    const { root, api } = setup();
    button(root, 'Add rule').click();
    expect(root.querySelectorAll('.re-rail-row').length).toBe(7);
    expect(api.getModel().rules[6].name).toBe('new-rule');
    expect(root.querySelector('.re-rail-row.is-selected .re-rail-meta')?.textContent).toBe('every cycle');
    expect(root.querySelector('.re-rail-row .re-rail-meta')?.textContent).toBe('rising edge');
  });

  it('duplicates a rule with a unique name and deletes from the rail', () => {
    const { root, api } = setup({ initialModel: wrap() });
    button(root, 'Duplicate r').click();
    expect(api.getModel().rules.map((r) => r.name)).toEqual(['r', 'r-copy']);
    button(root, 'Duplicate r').click();
    expect(api.getModel().rules.map((r) => r.name)).toEqual(['r', 'r-copy2', 'r-copy']);
    button(root, 'Delete r-copy2').click();
    expect(api.getModel().rules.map((r) => r.name)).toEqual(['r', 'r-copy']);
  });

  it('editing the name, a formula, a condition, and a description updates the XML', () => {
    const { root, api } = setup({ initialModel: wrap() });
    type(root.querySelector('.re-name') as HTMLInputElement, 'renamed');
    expect(api.getXml()).toContain('name="renamed"');
    expect(root.querySelector('.re-rail-name-text')?.textContent).toBe('renamed');
    type(inputByLabel(root, 'Formula of variable 1'), 'TAG("plc1", "Temp")');
    expect(api.getXml()).toContain(`formula='TAG("plc1", "Temp")'`);
    type(inputByLabel(root, 'Condition 1'), 'temp > 60');
    expect(api.getXml()).toContain('expr="temp &gt; 60"');
    type(inputByLabel(root, 'Description of condition 1'), 'Hot');
    expect(api.getXml()).toContain('description="Hot"');
    expect(root.querySelector('.re-sheet-when .re-formula-view')?.textContent).toBe('=temp > 60');
  });

  it('Add rows append a variable, a condition, and a publish; delete icons remove them', () => {
    const { root, api } = setup({ initialModel: wrap() });
    const add = (sheet: string) => (root.querySelector(`${sheet} .re-add`) as HTMLButtonElement).click();
    add('.re-sheet-vars');
    expect(api.getModel().rules[0].variables).toHaveLength(2);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Name of variable 2');
    add('.re-sheet-when');
    expect(api.getModel().rules[0].conditions).toHaveLength(2);
    add('.re-sheet-then');
    expect(api.getModel().rules[0].actions).toHaveLength(2);
    button(root, 'Delete variable').click();
    expect(api.getModel().rules[0].variables).toHaveLength(1);
    buttons(root, 'Delete condition')[1].click();
    expect(api.getModel().rules[0].conditions).toHaveLength(1);
    buttons(root, 'Delete action')[2].click();
    expect(api.getModel().rules[0].actions).toHaveLength(1);
  });

  it('stops Add at the variable and condition limits', () => {
    const { root } = setup({
      initialModel: wrap({
        variables: Array.from({ length: LIMITS.maxVariables }, (_, i) => ({ name: `v${i}`, formula: '1' })),
        conditions: Array.from({ length: LIMITS.maxChildren }, () => ({ expr: 'v0 = 1' })),
      }),
    });
    expect((root.querySelector('.re-sheet-vars .re-add') as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('.re-sheet-when .re-add') as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('.re-sheet-then .re-add') as HTMLButtonElement).disabled).toBe(false);
  });

  it('turns a publish row into an alarm through the Action select, and back', () => {
    const { root, api } = setup({ initialModel: wrap() });
    choose(root.querySelector('.re-sheet-then select') as HTMLSelectElement, 'error');
    let r = api.getModel().rules[0];
    expect(r.actions).toHaveLength(0);
    expect(r.incident).toMatchObject({ severity: 'error', source: '', summary: '' });
    expect(api.getXml()).toContain('<incident source="" severity="error"');
    // severity changes in place
    choose(root.querySelector('.re-sheet-then select') as HTMLSelectElement, 'info');
    expect(api.getModel().rules[0].incident?.severity).toBe('info');
    // fields are editable
    type(inputByLabel(root, 'title of row 2'), 'Press guard alarm');
    type(inputByLabel(root, 'first step of row 3'), 'Look.');
    expect(api.getModel().rules[0].incident).toMatchObject({ summary: 'Press guard alarm', firstStep: 'Look.' });
    // and back to a publish
    choose(root.querySelector('.re-sheet-then select') as HTMLSelectElement, 'publish');
    r = api.getModel().rules[0];
    expect(r.incident).toBeNull();
    expect(r.actions).toEqual([{ topic: '' }]);
    button(root, 'Delete action').click();
    expect(api.getModel().rules[0].actions).toEqual([]);
  });

  it('edits the match mode, the trigger, and the cooldown', () => {
    const { root, api } = setup({ initialModel: wrap({ conditions: [{ expr: 'temp > 1' }, { expr: 'temp < 9' }] }) });
    const [match, edge] = Array.from(root.querySelectorAll<HTMLSelectElement>('.re-when-title select'));
    choose(match, 'all');
    expect(api.getXml()).toContain('<and>');
    choose(edge, 'rising');
    expect(api.getXml()).toContain('edge="rising"');
    type(inputByLabel(root, 'Cooldown'), '45s');
    expect(api.getXml()).toContain('cooldown="45s"');
  });

  it('marks a bad formula on its cell with the message, and clears it without a re-render', () => {
    const { root } = setup({ initialModel: wrap() });
    const input = inputByLabel(root, 'Condition 1');
    const cellEl = input.closest('.re-cell') as HTMLElement;
    type(input, 'temp >');
    expect(cellEl.classList.contains('is-invalid')).toBe(true);
    const msg = cellEl.querySelector('.re-msg') as HTMLElement;
    expect(msg.textContent).toMatch(/column 7/);
    expect(msg.hidden).toBe(false);
    expect(root.querySelector('.re-rail-issues')?.textContent).toBe('1 issue');
    type(input, 'temp > 1');
    expect(cellEl.classList.contains('is-invalid')).toBe(false);
    expect(cellEl.querySelector('.re-msg')).toBeNull();
    expect(root.querySelector('.re-rail-issues')?.textContent).toBe('');
  });

  it('marks the variable name, the description, a Then field, and the cooldown', () => {
    const { root } = setup({
      initialModel: wrap({
        cooldown: '5d',
        variables: [{ name: '1x', formula: 'TAG("t")', description: 'x'.repeat(241) }],
        conditions: [{ expr: 'TAG("a")' }],
        actions: [{ topic: '=(' }],
      }),
    });
    const invalid = Array.from(root.querySelectorAll<HTMLElement>('.is-invalid')).map((n) => n.dataset.loc);
    expect(invalid).toContain('0|variable|0||');
    expect(invalid).toContain('0|description|0||');
    expect(invalid).toContain('0|topic|||0');
    expect(invalid).toContain('0|cooldown|||');
  });

  it('marks the sheet when a rule has no condition, and the pane when it has no action', () => {
    const { root } = setup({ initialModel: wrap({ conditions: [], actions: [], incident: null }) });
    expect(root.querySelector('.re-sheet-block.is-invalid .re-sheet-when')).toBeTruthy();
    expect(root.querySelector('.re-pane-body.is-invalid')).toBeTruthy();
    expect(root.querySelector('.re-pane-body > .re-msg')?.textContent).toMatch(/actions.*incident/i);
  });

  it('keeps whole-file issues on the status line', () => {
    const { root } = setup({ initialXml: '<not-rules/>' });
    expect(root.querySelector('.re-status.is-error')?.textContent).toMatch(/Root element/);
    expect(root.querySelector('.re-empty')).toBeTruthy();
  });

  it('opens the XML panel with the current file, and imports what is pasted', () => {
    const { root, api } = setup({ initialModel: wrap() });
    button(root, 'XML').click();
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe(api.getXml());
    ta.value = '<rules><rule name="imported"><cond expr="TAG(&quot;a&quot;)"/><actions><publish topic="t"/></actions></rule></rules>';
    button(root, 'Import').click();
    expect(api.getModel().rules[0].name).toBe('imported');
    expect(root.querySelector('.re-xml')?.hasAttribute('hidden')).toBe(true);
    button(root, 'XML').click();
    (root.querySelector('textarea') as HTMLTextAreaElement).value = '<rules><rule';
    button(root, 'Import').click();
    expect(root.querySelector('.re-xml-msg.is-error')?.textContent).toMatch(/Malformed/);
  });

  it('blocks Download and Copy while the model is invalid, and frees them once fixed', () => {
    const { root } = setup({ initialModel: wrap({ conditions: [{ expr: 'temp >' }] }) });
    button(root, 'XML').click();
    const dl = button(root, 'Download rules.xml');
    const copy = button(root, 'Copy XML');
    expect(dl.disabled).toBe(true);
    expect(copy.disabled).toBe(true);
    expect(dl.title).toMatch(/1 issue/);
    type(inputByLabel(root, 'Condition 1'), 'temp > 1');
    expect(dl.disabled).toBe(false);
    expect(copy.disabled).toBe(false);
  });

  it('still reports the xml through onChange while invalid, so a host can autosave', () => {
    let last: { xml: string; errors: string[] } | undefined;
    const { root } = setup({ initialModel: wrap(), onChange: (s) => (last = s) });
    type(inputByLabel(root, 'Condition 1'), 'temp >');
    expect(last!.errors.length).toBe(1);
    expect(last!.xml).toContain('expr="temp &gt;"');
  });

  it('stops mobile keyboards rewriting identifier cells, but not prose cells', () => {
    const { root } = setup();
    for (const label of ['Rule name', 'Name of variable 1', 'Formula of variable 1', 'Condition 1', 'Cooldown', 'Filter rules']) {
      const input = inputByLabel(root, label);
      expect(input.getAttribute('autocapitalize'), label).toBe('off');
      expect(input.getAttribute('autocorrect'), label).toBe('off');
      expect(input.getAttribute('spellcheck'), label).toBe('false');
    }
    for (const label of ['Description of variable 1', 'Description of condition 1', 'title of row 4']) {
      const input = inputByLabel(root, label);
      expect(input.getAttribute('autocapitalize'), label).toBe(null);
      expect(input.getAttribute('spellcheck'), label).toBe(null);
    }
  });

  // ---- narrow-screen guards (no browser: assertions over the injected CSS) ----
  const sheet = (): string => {
    setup();
    return document.getElementById('octaview-rules-editor-styles')!.textContent ?? '';
  };
  /** The declarations that apply only when the editor is narrow. */
  const narrowBlocks = (css: string): string[] =>
    [...css.matchAll(/@(?:media|container)[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);

  it('adapts to its container, not only to the viewport', () => {
    const css = sheet();
    // The editor is embedded, so it can be narrow inside a wide window.
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@container\s/);
    // Kept alongside a viewport query so it still adapts without container support.
    expect(css).toMatch(/@media\s*\(max-width/);
  });

  it('folds the rail into a select below 900px', () => {
    const css = sheet();
    const medium = [...css.matchAll(/@(?:media|container)[^{]*max-width:\s*900px[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    expect(medium.length).toBe(2);
    expect(medium.join('')).toMatch(/\.re-rail\s*\{[^}]*display:\s*none/);
    expect(medium.join('')).toMatch(/\.re-rail-select\s*\{[^}]*display:\s*block/);
    expect(medium.join('')).toMatch(/\.re-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it('lifts every text control to 16px when narrow, so iOS does not zoom on focus', () => {
    // The zoom happens when a focused text field is under 16px. Static help
    // text and buttons do not trigger it, so only controls are checked.
    const blocks = narrowBlocks(sheet());
    expect(blocks.length).toBeGreaterThan(0);
    const rules = [...blocks.join('').matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const controls = rules.filter(([, sel]) => /\b(input|select|textarea)\b/.test(sel));
    expect(controls.length).toBeGreaterThan(0);
    let checked = 0;
    for (const [, sel, body] of controls) {
      for (const m of body.matchAll(/font-size:\s*([\d.]+)px/g)) {
        checked++;
        expect(Number(m[1]), sel.trim()).toBeGreaterThanOrEqual(16);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(blocks.join('')).toMatch(/\.re-bar input[^{]*\{[^}]*font-size:\s*16px/);
    expect(blocks.join('')).toMatch(/\.re-cell select[^{]*\{[^}]*font-size:\s*16px/);
  });

  it('gives the small controls a touch-sized target when narrow', () => {
    const block = narrowBlocks(sheet()).join('');
    for (const sel of ['.re-remove', '.re-link', '.re-btn-primary', '.re-tab']) {
      const rule = new RegExp(`\\${sel}[^{]*\\{[^}]*min-height:\\s*(\\d+)px`).exec(block);
      expect(rule, `${sel} has no min-height when narrow`).not.toBeNull();
      expect(Number(rule![1]), sel).toBeGreaterThanOrEqual(44);
    }
  });

  it('keeps the sheet a sheet: sideways scroll in the frame, frozen row numbers', () => {
    const css = sheet();
    expect(css).toMatch(/\.re-sheet\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.re-gutter, \.re-gutter-head\s*\{[^}]*position:\s*sticky;\s*left:\s*0/);
    // rows never squeeze below a usable width; the sheet scrolls instead
    expect(css).toMatch(/\.re-sheet-vars \.re-row\s*\{[^}]*min-width:\s*\d+px/);
    const narrow = [...css.matchAll(/@(?:media|container)[^{]*max-width:\s*560px[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    expect(narrow.length).toBe(2);
    const block = narrow.join('');
    // no card layout: the grid header stays, rows stay grids, cells are tapped not typed into
    expect(block).not.toMatch(/\.re-sheet-head\s*\{[^}]*display:\s*none/);
    expect(block).not.toMatch(/::before/);
    expect(block).toMatch(/\.re-cell input\s*\{[^}]*pointer-events:\s*none/);
    expect(block).toMatch(/\.re-formula-view[^{]*\{[^}]*white-space:\s*nowrap/);
    // every cell carries its column name for the bar's address
    const { root } = setup();
    const labels = new Set(Array.from(root.querySelectorAll('.re-cell')).map((c) => c.getAttribute('data-label')));
    expect([...labels].sort()).toEqual(['Action', 'Condition', 'Condition result', 'Description', 'Field', 'Formula', 'Formula result', 'Name']);
  });

  it('shows the error as text, not only as a hover tooltip', () => {
    const { root } = setup({ initialModel: wrap({ variables: [{ name: 'temp', formula: '' }] }) });
    const field = inputByLabel(root, 'Formula of variable 1').closest('.re-cell') as HTMLElement;
    const msg = field.querySelector('.re-msg') as HTMLElement;
    expect(msg, 'no visible message under the field').toBeTruthy();
    expect(msg.textContent).toMatch(/no formula/);
    expect(msg.hidden).toBe(false);
  });

  it('makes each sheet help a button that reveals its text on tap', () => {
    const { root } = setup();
    const infos = root.querySelectorAll<HTMLButtonElement>('.re-info');
    expect(infos.length).toBe(3);
    const info = infos[0];
    expect(info.type).toBe('button');
    expect(info.getAttribute('aria-expanded')).toBe('false');
    const help = info.closest('.re-sheet-block')!.querySelector('.re-help') as HTMLElement;
    expect(help.hidden).toBe(true);
    info.click();
    expect(help.hidden).toBe(false);
    expect(info.getAttribute('aria-expanded')).toBe('true');
    expect(help.textContent).toMatch(/TAG\("device", "tag"\)/);
    info.click();
    expect(help.hidden).toBe(true);
  });

  it('injects its scoped stylesheet once', () => {
    setup();
    setup();
    expect(document.querySelectorAll('#octaview-rules-editor-styles').length).toBe(1);
  });
});

describe('narrow mode (phone: tabs, tap a cell, edit in the bar)', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  /** jsdom has no layout: fake the container width before mounting. */
  function narrowSetup(opts?: Parameters<typeof initRulesEditor>[1], width = 320) {
    const root = document.createElement('div');
    Object.defineProperty(root, 'clientWidth', { value: width, configurable: true });
    document.body.append(root);
    const api = initRulesEditor(root, opts);
    return { root, api };
  }
  const visibleBlocks = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.re-sheet-block')).filter((b) => !b.hidden);
  const bar = (root: HTMLElement) => root.querySelector('.re-bar') as HTMLElement;
  const barInput = (root: HTMLElement) => root.querySelector('.re-bar input') as HTMLInputElement;
  const tab = (root: HTMLElement, name: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.re-tab')).find((t) => t.textContent?.startsWith(name))!;

  it('sets is-narrow from the container width, and not when wide', () => {
    expect(narrowSetup().root.classList.contains('is-narrow')).toBe(true);
    expect(narrowSetup(undefined, 1180).root.classList.contains('is-narrow')).toBe(false);
    expect(setup().root.classList.contains('is-narrow')).toBe(false);
  });

  it('shows one sheet at a time, switched by tabs with counts', () => {
    const { root } = narrowSetup();
    const tabs = root.querySelectorAll('.re-tab');
    expect(tabs.length).toBe(3);
    expect(Array.from(tabs).map((t) => t.textContent)).toEqual(['Variables10', 'When5', 'Then6']);
    expect(visibleBlocks(root).map((b) => b.dataset.sheet)).toEqual(['vars']);
    expect(tab(root, 'Variables').getAttribute('aria-selected')).toBe('true');
    tab(root, 'When').click();
    expect(visibleBlocks(root).map((b) => b.dataset.sheet)).toEqual(['when']);
    expect(tab(root, 'When').getAttribute('aria-selected')).toBe('true');
    expect(tab(root, 'Variables').getAttribute('aria-selected')).toBe('false');
    // the choice survives a rule change
    (root.querySelectorAll('.re-rail-row')[1] as HTMLElement).click();
    expect(visibleBlocks(root).map((b) => b.dataset.sheet)).toEqual(['when']);
    // wide: every sheet shows and the tabs are inert
    const wide = setup().root;
    expect(visibleBlocks(wide).length).toBe(3);
  });

  it('tapping a formula cell selects it and opens the bar with its address and content', () => {
    const { root } = narrowSetup();
    expect(bar(root).classList.contains('is-open')).toBe(false);
    const cellEl = inputByLabel(root, 'Formula of variable 1').closest('.re-cell') as HTMLElement;
    cellEl.click();
    expect(cellEl.classList.contains('is-selected')).toBe(true);
    expect(bar(root).classList.contains('is-open')).toBe(true);
    expect(root.querySelector('.re-bar-address')?.textContent).toBe('alarm_active · Formula');
    expect(barInput(root).value).toBe('TAG("plc1", "AlarmActive")');
    expect(barInput(root).readOnly).toBe(false);
    expect(barInput(root).getAttribute('autocapitalize')).toBe('off');
    // the keyboard does not open on tap: nothing inside the cell has focus
    expect(cellEl.contains(document.activeElement)).toBe(false);
  });

  it('typing in the bar edits the cell; the cross restores, the tick keeps', () => {
    const { root, api } = narrowSetup({ initialModel: wrap() });
    const cellEl = inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement;
    cellEl.click();
    type(barInput(root), 'temp > 60');
    expect(api.getXml()).toContain('expr="temp &gt; 60"');
    expect(cellEl.querySelector('.re-formula-view')?.textContent).toBe('=temp > 60');
    button(root, 'Cancel').click();
    expect(api.getXml()).toContain('expr="temp &gt; 50"');
    expect(bar(root).classList.contains('is-open')).toBe(false);
    expect(cellEl.classList.contains('is-selected')).toBe(false);
    cellEl.click();
    type(barInput(root), 'temp > 70');
    button(root, 'Done').click();
    expect(api.getXml()).toContain('expr="temp &gt; 70"');
    expect(bar(root).classList.contains('is-open')).toBe(false);
  });

  it('shows the cell validation message in the bar while editing', () => {
    const { root } = narrowSetup({ initialModel: wrap() });
    (inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement).click();
    type(barInput(root), 'temp >');
    const msg = bar(root).querySelector('.re-msg') as HTMLElement;
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toMatch(/column 7/);
    type(barInput(root), 'temp > 1');
    expect(msg.hidden).toBe(true);
  });

  it('a result cell opens the bar read-only, without Done or Cancel', () => {
    const { root } = narrowSetup({ monitor: (ref) => (ref.kind === 'variable' ? '48.2 °C' : undefined) });
    (root.querySelector('.re-sheet-vars .re-cell-result') as HTMLElement).click();
    expect(barInput(root).readOnly).toBe(true);
    expect(barInput(root).value).toBe('48.2 °C');
    expect(button(root, 'Done').hidden).toBe(true);
    expect(button(root, 'Cancel').hidden).toBe(true);
    expect(button(root, 'Delete row').hidden).toBe(false);
  });

  it('a choice cell keeps its native picker and does not open the bar', () => {
    const { root } = narrowSetup();
    tab(root, 'Then').click();
    (root.querySelector('.re-sheet-then .re-cell') as HTMLElement).click();
    expect(bar(root).classList.contains('is-open')).toBe(false);
  });

  it('Delete row in the bar removes the selected row', () => {
    const { root, api } = narrowSetup({ initialModel: wrap({ variables: [{ name: 'a', formula: '1' }, { name: 'b', formula: '2' }], conditions: [{ expr: 'a = 1' }] }) });
    (inputByLabel(root, 'Name of variable 2').closest('.re-cell') as HTMLElement).click();
    expect(root.querySelector('.re-bar-address')?.textContent).toBe('b · Name');
    button(root, 'Delete row').click();
    expect(api.getModel().rules[0].variables.map((v) => v.name)).toEqual(['a']);
    expect(bar(root).classList.contains('is-open')).toBe(false);
  });

  it('Add selects the new row in the bar instead of focusing a hidden input', () => {
    const { root } = narrowSetup({ initialModel: wrap() });
    tab(root, 'When').click();
    (root.querySelector('.re-sheet-when .re-add') as HTMLButtonElement).click();
    expect(visibleBlocks(root).map((b) => b.dataset.sheet)).toEqual(['when']);
    expect(root.querySelector('.re-bar-address')?.textContent).toBe('Row 2 · Condition');
    expect(bar(root).classList.contains('is-open')).toBe(true);
  });

  it('tapping outside a cell closes the bar; wide mode never opens it', () => {
    const { root } = narrowSetup();
    (inputByLabel(root, 'Formula of variable 1').closest('.re-cell') as HTMLElement).click();
    expect(bar(root).classList.contains('is-open')).toBe(true);
    (root.querySelector('.re-sheet-title') as HTMLElement).click();
    expect(bar(root).classList.contains('is-open')).toBe(false);
    const wide = setup().root;
    (inputByLabel(wide, 'Formula of variable 1').closest('.re-cell') as HTMLElement).click();
    expect(bar(wide).classList.contains('is-open')).toBe(false);
  });
});

describe('rules editor component API', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  const oneRule: RulesModel = wrap({ name: 'x' });

  it('honours initialModel', () => {
    const { api } = setup({ initialModel: oneRule });
    expect(api.getXml()).toContain('name="x"');
  });

  it('does not mutate the caller model (clones in and out)', () => {
    const src = JSON.parse(JSON.stringify(oneRule)) as RulesModel;
    const { api } = setup({ initialModel: src });
    api.getModel().rules[0].name = 'zzz'; // mutating the returned copy...
    expect(api.getXml()).toContain('name="x"'); // ...doesn't touch internal state
    expect(src.rules[0].name).toBe('x'); // ...and the source is untouched
  });

  it('fires onChange on mount and edits with model/xml/errors', () => {
    let last: { model: RulesModel; xml: string; errors: string[] } | undefined;
    const { root } = setup({ onChange: (s) => (last = s) });
    expect(last).toBeTruthy();
    expect(last!.xml).toContain('<rules>');
    expect(Array.isArray(last!.errors)).toBe(true);
    button(root, 'Add rule').click();
    expect(last!.model.rules.some((r) => r.name === 'new-rule')).toBe(true);
  });

  it('accepts valid initialXml, in the v0.2 form too', () => {
    const xml = '<rules>\n  <rule name="r">\n    <cond tag="a" op="eq" value="1"/>\n    <actions>\n      <publish topic="t"/>\n    </actions>\n  </rule>\n</rules>\n';
    const { root, api } = setup({ initialXml: xml });
    expect(api.getXml()).toContain('name="r"');
    expect(api.getErrors()).toEqual([]);
    expect(root.querySelector('.re-sheet-when .re-formula-view')?.textContent).toBe('=TAG("a") = 1');
  });

  it('surfaces a malformed initialXml via errors instead of throwing', () => {
    let last: { errors: string[] } | undefined;
    // Would throw if we called parse() ourselves — here it must NOT throw.
    const { api } = setup({ initialXml: '<rules><rule name="r"></rules>', onChange: (s) => (last = s) });
    expect(api.getErrors().length).toBeGreaterThan(0);
    expect(api.getErrors()[0]).toMatch(/malformed|parse|xml/i);
    expect(last!.errors.length).toBeGreaterThan(0);
  });

  it('clears the parse error after a user action (Load example)', () => {
    const { root, api } = setup({ initialXml: '<not-rules/>' });
    expect(api.getErrors().length).toBeGreaterThan(0);
    button(root, 'Load example').click();
    expect(api.getErrors()).toEqual([]);
  });

  it('re-exports the located issues, the patterns, and the formula core', async () => {
    const entry = await import('./index.js');
    expect(typeof entry.validateIssues).toBe('function');
    expect(typeof entry.COOLDOWN_PATTERN).toBe('string');
    expect(entry.COOLDOWN_RE.test('1m30s')).toBe(true);
    expect(entry.VARIABLE_NAME_RE.test('milk_temp')).toBe(true);
    expect(entry.validateIssues({ rules: [rule({ name: '' })] })[0]).toMatchObject({ rule: 0, field: 'name' });
    expect(entry.printFormula(entry.parseFormula('and(a,b)'))).toBe('AND(a, b)');
    expect(entry.FUNCTIONS.some((f) => f.name === 'RATE')).toBe(true);
    expect(entry.LIMITS.maxVariables).toBe(64);
  });

  it('re-exports the core (parse/serialize/validate) from the same entry', () => {
    const m: RulesModel = parse('<rules><rule name="r"><cond expr="TAG(&quot;a&quot;)"/><actions><publish topic="t"/></actions></rule></rules>');
    expect(serialize(m)).toContain('name="r"');
    expect(validate(m)).toEqual([]);
    expect(() => parse('<bad')).toThrow(RulesParseError);
  });

  it('setModel replaces the model; destroy tears down', () => {
    const { root, api } = setup();
    api.setModel({ rules: [] });
    expect(api.getXml()).toBe('<rules>\n</rules>\n');
    expect(root.querySelector('.re-empty')).toBeTruthy();
    api.destroy();
    expect(root.children.length).toBe(0);
    expect(root.classList.contains('re-root')).toBe(false);
  });
});
