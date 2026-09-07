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
/** Type without committing: the cell holds a draft. */
function draft(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
/** Type and commit, as Tab or leaving the cell does (the `change` event). */
function type(input: HTMLInputElement, value: string): void {
  draft(input, value);
  input.dispatchEvent(new Event('change'));
}
function key(input: HTMLElement, k: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
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

  it('shows nothing over the placeholder of an empty formula cell, and strips a typed leading =', () => {
    const { root, api } = setup({ initialModel: wrap({ conditions: [{ expr: '' }] }) });
    const cellEl = inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement;
    expect(cellEl.querySelector('.re-formula-view')?.textContent).toBe('');
    expect(inputByLabel(root, 'Condition 1').placeholder).toBe('temp > 50');
    type(inputByLabel(root, 'Condition 1'), '=temp > 1');
    expect(inputByLabel(root, 'Condition 1').value).toBe('temp > 1');
    expect(api.getModel().rules[0].conditions[0].expr).toBe('temp > 1');
    expect(cellEl.querySelector('.re-formula-view')?.textContent).toBe('=temp > 1');
    // Then fields keep the "=": there it marks a formula
    type(inputByLabel(root, 'topic of row 1'), '="a/" & "b"');
    expect(api.getModel().rules[0].actions[0].topic).toBe('="a/" & "b"');
  });

  it('shows Then rows per field, with the literal as its result and a folded formula preview', () => {
    const { root } = setup();
    const rows = Array.from(root.querySelectorAll('.re-sheet-then .re-row:not(.re-row-add)'));
    const fields = rows.map((r) => r.querySelector('.re-cell-field')?.textContent);
    expect(fields).toEqual(['topic', 'payload', 'source', 'title', 'first step', 'cause']);
    expect(rows[0].querySelector('.re-cell-result')?.textContent).toBe('camera/record');
    // one Action choice per action, on its first row; the rows under it continue the cell
    expect(rows[0].querySelector('select')?.value).toBe('publish');
    expect(rows[2].querySelector('select')?.value).toBe('critical');
    expect(rows.map((r) => Boolean(r.querySelector('.re-cell-merged')))).toEqual([false, true, false, true, true, true]);
    expect(rows[1].querySelector('select')).toBeNull();
    expect(rows.map((r) => Boolean(r.querySelector('.re-remove')))).toEqual([true, false, true, false, false, false]);
    // cause = condition.description & "…" previews with the first condition's description
    expect(rows[5].querySelector('.re-cell-result')?.textContent).toMatch(/^Cell 3 PLC raised its own alarm\. The press PLC/);
  });

  it('keeps the phone keyboard off names, topics and payloads in the Then sheet; prose keeps it', () => {
    const { root } = setup();
    const off = (label: string) => inputByLabel(root, label).getAttribute('autocapitalize') === 'off';
    expect(off('topic of row 1')).toBe(true);
    expect(off('payload of row 2')).toBe(true);
    expect(off('source of row 3')).toBe(true);
    expect(off('title of row 4')).toBe(false);
    expect(off('cause of row 6')).toBe(false);
  });

  it('does not fire onChange for a change of the selected rule', () => {
    let changes = 0;
    const { root } = setup({ onChange: () => changes++ });
    expect(changes).toBe(1);
    (root.querySelectorAll<HTMLElement>('.re-rail-row')[2]).click();
    (root.querySelectorAll<HTMLElement>('.re-rail-row')[0]).click();
    expect(changes).toBe(1);
    type(inputByLabel(root, 'Condition 1'), 'temp > 61');
    expect(changes).toBe(2);
  });

  it('the XML panel does not overwrite a pasted file that is not imported yet', () => {
    const { root } = setup({ initialModel: wrap() });
    button(root, 'XML').click();
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = '<rules/>';
    type(inputByLabel(root, 'Condition 1'), 'temp > 61');
    expect(ta.value).toBe('<rules/>');
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
    // one Delete per action, on its first row
    expect(buttons(root, 'Delete action')).toHaveLength(2);
    buttons(root, 'Delete action')[1].click();
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

  it('validates on commit only: keystrokes leave the model, the marks and onChange alone', () => {
    let changes = 0;
    const { root, api } = setup({ initialModel: wrap(), onChange: () => changes++ });
    const mounted = changes;
    const input = inputByLabel(root, 'Condition 1');
    const cellEl = input.closest('.re-cell') as HTMLElement;
    draft(input, 'temp >');
    expect(cellEl.classList.contains('is-invalid')).toBe(false);
    expect(api.getXml()).toContain('expr="temp &gt; 50"');
    expect(changes).toBe(mounted);
    // the coloured view still follows the draft
    expect(cellEl.querySelector('.re-formula-view')?.textContent).toBe('=temp >');
    // Enter commits: model, mark, onChange
    key(input, 'Enter');
    expect(api.getXml()).toContain('expr="temp &gt;"');
    expect(cellEl.classList.contains('is-invalid')).toBe(true);
    expect(changes).toBe(mounted + 1);
    // Escape restores the committed value and does not fire onChange
    draft(input, 'temp > 9');
    key(input, 'Escape');
    expect(input.value).toBe('temp >');
    expect(cellEl.querySelector('.re-formula-view')?.textContent).toBe('=temp >');
    expect(changes).toBe(mounted + 1);
    // leaving the cell (change) commits too; an unchanged value does not fire
    type(input, 'temp > 60');
    expect(api.getXml()).toContain('expr="temp &gt; 60"');
    expect(cellEl.classList.contains('is-invalid')).toBe(false);
    expect(changes).toBe(mounted + 2);
    input.dispatchEvent(new Event('change'));
    expect(changes).toBe(mounted + 2);
  });

  it('the rule name and the cooldown commit the same way', () => {
    const { root, api } = setup({ initialModel: wrap() });
    draft(root.querySelector('.re-name') as HTMLInputElement, 'renamed');
    expect(api.getXml()).toContain('name="r"');
    key(root.querySelector('.re-name') as HTMLInputElement, 'Enter');
    expect(api.getXml()).toContain('name="renamed"');
    draft(inputByLabel(root, 'Cooldown'), '5d');
    expect(root.querySelector('.re-cool.is-invalid')).toBeNull();
    key(inputByLabel(root, 'Cooldown'), 'Enter');
    expect(root.querySelector('.re-cool.is-invalid')).toBeTruthy();
  });

  it('deleting a rule before the selected one keeps the same rule on screen', () => {
    const { root, api } = setup();
    (root.querySelectorAll('.re-rail-row')[2] as HTMLElement).click();
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('wetwell-highlevel');
    button(root, 'Delete alarm-camera').click();
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('wetwell-highlevel');
    expect(api.getModel().rules.map((r) => r.name)[1]).toBe('wetwell-highlevel');
    // deleting the selected one moves to its neighbour
    button(root, 'Delete wetwell-highlevel').click();
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('weekly-flow-total');
  });

  it('refreshValues asks for a renamed variable under its new name', () => {
    const asked: string[] = [];
    const { root, api } = setup({ initialModel: wrap(), monitor: (ref) => { if (ref.kind === 'variable') asked.push(ref.name); return undefined; } });
    type(inputByLabel(root, 'Name of variable 1'), 'temp2');
    asked.length = 0;
    api.refreshValues();
    expect(asked).toEqual(['temp2']);
  });

  it('changing the alarm severity in place recolours the rail square', () => {
    const { root } = setup({ initialModel: wrap({ incident: { source: 's', severity: 'critical', summary: 'x' } }) });
    expect(root.querySelector('.re-rail-row .re-square')?.className).toBe('re-square is-critical');
    choose(root.querySelector('.re-sheet-then select') as HTMLSelectElement, 'info');
    expect(root.querySelector('.re-rail-row .re-square')?.className).toBe('re-square is-info');
  });

  it('selecting a rule keeps the rail rows and only re-renders the pane', () => {
    const { root } = setup();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.re-rail-row'));
    rows[2].click();
    expect(Array.from(root.querySelectorAll<HTMLElement>('.re-rail-row'))).toEqual(rows);
    expect(rows[2].classList.contains('is-selected')).toBe(true);
    expect(rows[0].classList.contains('is-selected')).toBe(false);
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('wetwell-highlevel');
  });

  it('the Then preview follows a change of condition 1 description', () => {
    const { root } = setup();
    const cause = Array.from(root.querySelectorAll('.re-sheet-then .re-row:not(.re-row-add)'))[5];
    expect(cause.querySelector('.re-cell-result')?.textContent).toMatch(/^Cell 3 PLC raised its own alarm\./);
    type(inputByLabel(root, 'Description of condition 1'), 'Alarm bit set');
    expect(cause.querySelector('.re-cell-result')?.textContent).toMatch(/^Alarm bit set\./);
  });

  it('refreshValues re-reads the monitor in place; setModel keeps the selected rule', () => {
    let value = 'a';
    const { root, api } = setup({ monitor: (ref) => (ref.kind === 'variable' ? value : undefined) });
    const cellEl = root.querySelector('.re-sheet-vars .re-cell-result') as HTMLElement;
    expect(cellEl.textContent).toBe('a');
    value = 'b';
    api.refreshValues();
    expect(cellEl.textContent).toBe('b');
    expect(root.querySelector('.re-sheet-vars .re-cell-result')).toBe(cellEl); // no re-render
    (root.querySelectorAll('.re-rail-row')[1] as HTMLElement).click();
    api.setModel(api.getModel());
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('pump-overtemp');
    api.setModel({ rules: [api.getModel().rules[0]] });
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('alarm-camera');
  });

  it('the XML panel follows commits while open, unless it is being edited', () => {
    const { root } = setup({ initialModel: wrap() });
    button(root, 'XML').click();
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    type(inputByLabel(root, 'Condition 1'), 'temp > 61');
    expect(ta.value).toContain('expr="temp &gt; 61"');
    ta.focus();
    type(inputByLabel(root, 'Condition 1'), 'temp > 62');
    expect(ta.value).toContain('expr="temp &gt; 61"');
  });

  it('gives the tabs panels: aria-controls on each tab, role tabpanel on each sheet', () => {
    const { root } = setup();
    for (const tabEl of Array.from(root.querySelectorAll<HTMLElement>('.re-tab'))) {
      const panel = root.querySelector(`#${tabEl.getAttribute('aria-controls')}`);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tabEl.id);
    }
    // two editors on one page do not share ids
    const other = setup();
    expect(other.root.querySelector('.re-tab')?.id).not.toBe(root.querySelector('.re-tab')?.id);
  });

  it('marks a bad formula on its cell with the message, and clears it without a re-render', () => {
    const { root } = setup({ initialModel: wrap() });
    const input = inputByLabel(root, 'Condition 1');
    const cellEl = input.closest('.re-cell') as HTMLElement;
    type(input, 'temp >');
    expect(cellEl.classList.contains('is-invalid')).toBe(true);
    // the message sits inside the cell, under the value, and names no rule: the rule is on screen
    const row = cellEl.parentElement as HTMLElement;
    const msg = cellEl.querySelector(':scope > .re-msg') as HTMLElement;
    expect(msg.textContent).toMatch(/^Condition 1: .*column 7/);
    expect(msg.textContent).not.toMatch(/Rule "/);
    expect(msg.hidden).toBe(false);
    expect(row.querySelector(':scope > .re-msg')).toBeNull();
    expect(root.querySelector('.re-rail-issues')?.textContent).toBe('1 issue');
    type(input, 'temp > 1');
    expect(cellEl.classList.contains('is-invalid')).toBe(false);
    expect(row.querySelector('.re-msg')).toBeNull();
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
  /** The rules scoped to one width class, as "selector {declarations}" strings. */
  const rulesFor = (css: string, cls: string): string =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, sel]) => sel.includes(`.re-root.${cls}`))
      .map(([, sel, body]) => `${sel.trim()} {${body}}`)
      .join('\n');
  /** The declarations that apply only when the editor is narrow. */
  const narrowBlocks = (css: string): string[] => ['is-medium', 'is-narrow', 'is-tight'].map((cls) => rulesFor(css, cls));

  it('keys the responsive layout off its own width, never the viewport', () => {
    const css = sheet();
    // One source of truth: the width classes the ResizeObserver sets. A media
    // query would apply phone styles to a wide editor on a phone, while the
    // behaviour (tabs, the bar) stayed in desktop mode.
    // (a hover-capability query is fine: it is about the pointer, not the width)
    expect(css).not.toMatch(/@media[^{]*(max|min)-width/);
    expect(css).not.toMatch(/@container/);
    expect(css).not.toMatch(/container-type/);
    const at = (width: number) => {
      const root = document.createElement('div');
      Object.defineProperty(root, 'clientWidth', { value: width, configurable: true });
      document.body.append(root);
      initRulesEditor(root);
      return ['is-medium', 'is-narrow', 'is-tight'].filter((c) => root.classList.contains(c));
    };
    expect(at(1180)).toEqual([]);
    expect(at(900)).toEqual(['is-medium']);
    expect(at(800)).toEqual(['is-medium']);
    expect(at(560)).toEqual(['is-medium', 'is-narrow']);
    expect(at(320)).toEqual(['is-medium', 'is-narrow', 'is-tight']);
  });

  it('folds the rail into a select at 900px and below', () => {
    const medium = rulesFor(sheet(), 'is-medium');
    expect(medium).toMatch(/\.re-rail\s*\{[^}]*display:\s*none/);
    expect(medium).toMatch(/\.re-rail-select\s*\{[^}]*display:\s*block/);
    expect(medium).toMatch(/\.re-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
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
    const block = rulesFor(css, 'is-narrow');
    expect(block).not.toBe('');
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
    expect(msg.textContent).toBe('Variable "temp": has no formula.');
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

  it('tapping the selected cell again keeps the value Cancel goes back to', () => {
    const { root, api } = narrowSetup({ initialModel: wrap() });
    const cellEl = inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement;
    cellEl.click();
    draft(barInput(root), 'temp > 99');
    cellEl.click();
    expect(barInput(root).value).toBe('temp > 99');
    button(root, 'Cancel').click();
    expect(cellEl.querySelector('.re-formula-view')?.textContent).toBe('=temp > 50');
    expect(api.getXml()).toContain('expr="temp &gt; 50"');
  });

  it('the bar holds a draft; the cross discards it, the tick or Enter commits it', () => {
    const { root, api } = narrowSetup({ initialModel: wrap() });
    const cellEl = inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement;
    cellEl.click();
    draft(barInput(root), 'temp > 60');
    // the cell view follows the draft, the model does not
    expect(cellEl.querySelector('.re-formula-view')?.textContent).toBe('=temp > 60');
    expect(api.getXml()).toContain('expr="temp &gt; 50"');
    button(root, 'Cancel').click();
    expect(api.getXml()).toContain('expr="temp &gt; 50"');
    expect(cellEl.querySelector('.re-formula-view')?.textContent).toBe('=temp > 50');
    expect(bar(root).classList.contains('is-open')).toBe(false);
    expect(cellEl.classList.contains('is-selected')).toBe(false);
    cellEl.click();
    draft(barInput(root), 'temp > 70');
    button(root, 'Done').click();
    expect(api.getXml()).toContain('expr="temp &gt; 70"');
    expect(bar(root).classList.contains('is-open')).toBe(false);
    cellEl.click();
    draft(barInput(root), 'temp > 80');
    key(barInput(root), 'Enter');
    expect(api.getXml()).toContain('expr="temp &gt; 80"');
    expect(bar(root).classList.contains('is-open')).toBe(false);
  });

  it('tapping another cell or a tab commits the draft', () => {
    const { root, api } = narrowSetup({ initialModel: wrap() });
    (inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement).click();
    draft(barInput(root), 'temp > 61');
    (inputByLabel(root, 'Description of condition 1').closest('.re-cell') as HTMLElement).click();
    expect(api.getXml()).toContain('expr="temp &gt; 61"');
    expect(root.querySelector('.re-bar-address')?.textContent).toBe('Row 1 · Description');
    draft(barInput(root), 'Hot');
    tab(root, 'Then').click();
    expect(api.getXml()).toContain('description="Hot"');
  });

  it('makes room under the sheet while the bar is open, so the last rows can scroll above it', () => {
    const { root } = narrowSetup();
    const paneEl = root.querySelector('.re-pane') as HTMLElement;
    const barEl = bar(root);
    Object.defineProperty(barEl, 'offsetHeight', { value: 96, configurable: true });
    expect(paneEl.style.paddingBottom).toBe('');
    (inputByLabel(root, 'Formula of variable 1').closest('.re-cell') as HTMLElement).click();
    expect(paneEl.style.paddingBottom).toBe('96px');
    button(root, 'Done').click();
    expect(paneEl.style.paddingBottom).toBe('');
  });

  it('Escape in the bar discards the draft; a commit with an error keeps the focus in the bar', () => {
    const { root, api } = narrowSetup({ initialModel: wrap() });
    (inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement).click();
    draft(barInput(root), 'temp > 99');
    key(barInput(root), 'Escape');
    expect(api.getXml()).toContain('expr="temp &gt; 50"');
    expect(bar(root).classList.contains('is-open')).toBe(false);
    (inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement).click();
    draft(barInput(root), 'temp >');
    button(root, 'Done').click();
    expect(bar(root).classList.contains('is-open')).toBe(true);
    expect(document.activeElement).toBe(barInput(root));
  });

  it('a structural change with a pending draft fires onChange once', () => {
    let changes = 0;
    const { root, api } = narrowSetup({ initialModel: wrap(), onChange: () => changes++ });
    const before = changes;
    (inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement).click();
    draft(barInput(root), 'temp > 63');
    (root.querySelector('.re-sheet-when .re-add') as HTMLButtonElement).click();
    const r = api.getModel().rules[0];
    expect(r.conditions.map((c) => c.expr)).toEqual(['temp > 63', '']);
    expect(changes).toBe(before + 1);
  });

  it('after a commit with an error the bar stays open and shows the message', () => {
    const { root, api } = narrowSetup({ initialModel: wrap() });
    const cellEl = inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement;
    cellEl.click();
    draft(barInput(root), 'temp >');
    const msg = bar(root).querySelector('.re-msg') as HTMLElement;
    expect(msg.hidden).toBe(true); // a draft is not validated
    key(barInput(root), 'Enter');
    expect(api.getXml()).toContain('expr="temp &gt;"');
    expect(cellEl.classList.contains('is-invalid')).toBe(true);
    expect(bar(root).classList.contains('is-open')).toBe(true);
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toMatch(/column 7/);
    draft(barInput(root), 'temp > 1');
    key(barInput(root), 'Enter');
    expect(cellEl.classList.contains('is-invalid')).toBe(false);
    expect(bar(root).classList.contains('is-open')).toBe(false);
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

  it('locks the in-cell inputs so only the bar edits, and unlocks them when wide', () => {
    const { root, api } = narrowSetup({ initialModel: wrap() });
    const cellInput = inputByLabel(root, 'Condition 1');
    expect(cellInput.readOnly).toBe(true);
    expect(cellInput.tabIndex).toBe(-1);
    // a row added while narrow is locked too
    (root.querySelector('.re-sheet-when .re-add') as HTMLButtonElement).click();
    expect(inputByLabel(root, 'Condition 2').readOnly).toBe(true);
    // going wide unlocks without a re-render
    Object.defineProperty(root, 'clientWidth', { value: 1180, configurable: true });
    api.setModel(api.getModel());
    expect(inputByLabel(root, 'Condition 1').readOnly).toBe(false);
    expect(inputByLabel(root, 'Condition 1').tabIndex).toBe(0);
  });

  it('Add focuses the bar input so the keyboard opens', () => {
    const { root } = narrowSetup({ initialModel: wrap() });
    (root.querySelector('.re-sheet-vars .re-add') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(barInput(root));
    expect(root.querySelector('.re-bar-address')?.textContent).toBe('Row 2 · Name');
  });

  it('shows choices as cell text with a transparent native select over it', () => {
    const { root } = setup();
    const pick = root.querySelector('.re-sheet-then .re-cell-pick .re-pick') as HTMLElement;
    expect(pick.querySelector('.re-pick-label')?.textContent).toBe('Publish MQTT message');
    const select = pick.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('publish');
    choose(select, 'warning');
    // the label follows the choice, and the model too
    expect((root.querySelector('.re-sheet-then .re-cell-pick .re-pick-label') as HTMLElement).textContent).toBe('Raise warning alarm');
    const css = document.getElementById('octaview-rules-editor-styles')!.textContent ?? '';
    expect(css).toMatch(/\.re-pick select\s*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.re-pick select\s*\{[^}]*font-size:\s*16px/);
    expect(css).toMatch(/\.re-add\s*\{[^}]*position:\s*sticky/);
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

describe('TAG("…") autocomplete', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  const CATALOG = {
    devices: [
      { tags: [{ tag: 'AlarmActive' }, { tag: 'StatusWord' }] },
      { device: 'vibration1', description: 'Press motor sensor', tags: [{ tag: 'temperature', unit: '°C', value: '48.2' }, { tag: 'alert_vrms_max', stale: true }] },
      { device: 'bulk1', tags: [{ tag: 'milk_temperature', unit: '°C' }] },
    ],
  };
  const menu = (root: HTMLElement) => root.querySelector('.re-menu') as HTMLElement;
  const items = (root: HTMLElement) => Array.from(root.querySelectorAll('.re-menu-item .re-menu-main')).map((m) => m.textContent);
  /** Type into an input with the caret at the end, without committing. */
  function typeAt(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event('input'));
  }

  it('lists devices and implicit-device tags after TAG(", then the device\'s tags, and completes the call', () => {
    const { root, api } = setup({ initialModel: wrap(), catalog: CATALOG });
    const input = inputByLabel(root, 'Condition 1');
    typeAt(input, 'TAG("');
    expect(menu(root).hidden).toBe(false);
    expect(items(root)).toEqual(['AlarmActive', 'StatusWord', 'vibration1', 'bulk1']);
    expect(root.querySelectorAll('.re-menu-item')[2].querySelector('.re-menu-meta')?.textContent).toBe('Press motor sensor · 2 tags');
    typeAt(input, 'TAG("vib');
    expect(items(root)).toEqual(['vibration1']);
    key(input, 'Enter');
    // a device opens the second argument and the menu moves on to its tags
    expect(input.value).toBe('TAG("vibration1", "');
    expect(input.selectionStart).toBe(input.value.length);
    expect(menu(root).hidden).toBe(false);
    expect(items(root)).toEqual(['temperature', 'alert_vrms_max']);
    expect(root.querySelector('.re-menu-item .re-menu-meta')?.textContent).toBe('48.2 °C');
    expect(root.querySelectorAll('.re-menu-item')[1].classList.contains('is-stale')).toBe(true);
    key(input, 'ArrowDown');
    key(input, 'ArrowUp');
    key(input, 'Tab');
    expect(input.value).toBe('TAG("vibration1", "temperature")');
    expect(menu(root).hidden).toBe(true);
    // nothing committed yet: Enter now commits the cell as usual
    expect(api.getXml()).toContain('expr="temp &gt; 50"');
    key(input, 'Enter');
    expect(api.getXml()).toContain(`expr='TAG("vibration1", "temperature")'`);
  });

  it('a pick is a click, so a touch drag scrolls the list; mousedown keeps the focus in the cell', () => {
    const { root } = setup({ initialModel: wrap(), catalog: CATALOG });
    const input = inputByLabel(root, 'Condition 1');
    typeAt(input, 'TAG("Al');
    const item = root.querySelector('.re-menu-item') as HTMLElement;
    // the start of a touch must not pick, or a drag could never scroll
    const pointer = new Event('pointerdown', { bubbles: true, cancelable: true });
    item.dispatchEvent(pointer);
    expect(pointer.defaultPrevented).toBe(false);
    expect(input.value).toBe('TAG("Al');
    // mousedown (also the compatibility event after a tap) is prevented so the input keeps focus
    const down = new Event('mousedown', { bubbles: true, cancelable: true });
    item.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    item.click();
    expect(input.value).toBe('TAG("AlarmActive")');
    typeAt(input, 'TAG("AlarmActive") > TAG("');
    expect(menu(root).hidden).toBe(false);
    key(input, 'Escape');
    expect(menu(root).hidden).toBe(true);
    expect(input.value).toBe('TAG("AlarmActive") > TAG("'); // the draft survives
  });

  it('keeps the list DOM while the list is unchanged, so scrolling and highlighting stay calm', () => {
    const { root } = setup({ initialModel: wrap(), catalog: CATALOG });
    const input = inputByLabel(root, 'Condition 1');
    typeAt(input, 'TAG("');
    const before = Array.from(root.querySelectorAll('.re-menu-item'));
    key(input, 'ArrowDown');
    const after = Array.from(root.querySelectorAll('.re-menu-item'));
    expect(after).toEqual(before);
    expect(after[1].classList.contains('is-active')).toBe(true);
    expect(after[0].classList.contains('is-active')).toBe(false);
    typeAt(input, 'TAG("vi');
    expect(root.querySelectorAll('.re-menu-item').length).toBe(1);
    // touch hygiene on the menu and the inputs
    const css = document.getElementById('octaview-rules-editor-styles')!.textContent ?? '';
    expect(css).toMatch(/\.re-menu\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(css).toMatch(/\.re-menu\s*\{[^}]*touch-action:\s*pan-y/);
    expect(css).toMatch(/@media \(hover: hover\)\s*\{[^@]*\.re-menu-item:hover/);
    // every hover rule lives inside that block: none outside it
    const hoverBlock = /@media \(hover: hover\)\s*\{([\s\S]*?)\n\}/.exec(css)![1];
    const outside = css.replace(hoverBlock, '');
    expect(outside).not.toMatch(/:hover/);
    expect(input.getAttribute('autocomplete')).toBe('off');
  });

  it('a complete name has nothing to pick: Enter commits it even while a longer name is listed', () => {
    const { root, api } = setup({ initialModel: wrap({ variables: [{ name: 'temp', formula: 'TAG("t")' }, { name: 'temp_rate', formula: 'RATE(temp, 30min)' }] }) });
    const input = inputByLabel(root, 'Condition 1');
    typeAt(input, 'temp');
    expect(items(root)).toEqual(['temp', 'temp_rate']);
    key(input, 'Enter');
    expect(menu(root).hidden).toBe(true);
    expect(input.value).toBe('temp');
    expect(api.getXml()).toContain('expr="temp"');
  });

  it('completes the rule\'s variables and the functions in a bare name; Tab accepts; TAG chains into the device list', () => {
    const { root, api } = setup({ initialModel: wrap({ variables: [{ name: 'temp', formula: 'TAG("t")', description: 'Housing' }, { name: 'temp_rate', formula: 'RATE(temp, 30min)' }] }), catalog: CATALOG, monitor: (ref) => (ref.kind === 'variable' && ref.name === 'temp' ? '48.2 °C' : undefined) });
    const input = inputByLabel(root, 'Condition 1');
    typeAt(input, 'te');
    expect(items(root)).toEqual(['temp', 'temp_rate']);
    expect(root.querySelector('.re-menu-item .re-menu-meta')?.textContent).toBe('48.2 °C');
    expect((root.querySelector('.re-menu-item') as HTMLElement).title).toBe('Housing');
    key(input, 'ArrowDown');
    key(input, 'Tab');
    expect(input.value).toBe('temp_rate');
    expect(input.selectionStart).toBe(9);
    expect(menu(root).hidden).toBe(true);
    // a function opens its call
    typeAt(input, 'temp_rate > ra');
    expect(items(root)).toEqual(['temp_rate', 'RATE(']);
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(input.value).toBe('temp_rate > RATE(');
    // TAG opens its string and hands over to the device list
    typeAt(input, 'temp_rate > RATE(ta');
    expect(items(root)).toEqual(['TAG(']);
    key(input, 'Tab');
    expect(input.value).toBe('temp_rate > RATE(TAG("');
    expect(items(root)).toEqual(['AlarmActive', 'StatusWord', 'vibration1', 'bulk1']);
    // nothing is committed until Enter outside the menu
    expect(api.getXml()).toContain('expr="temp &gt; 50"');
  });

  it('completes names in a Then field only once it is a formula, and never in the Variables name column', () => {
    const { root } = setup({ initialModel: wrap({ variables: [{ name: 'temp', formula: 'TAG("t")' }] }) });
    typeAt(inputByLabel(root, 'topic of row 1'), 'te');
    expect(menu(root).hidden).toBe(true);
    typeAt(inputByLabel(root, 'topic of row 1'), '=te');
    expect(items(root)).toEqual(['temp']);
    inputByLabel(root, 'topic of row 1').dispatchEvent(new Event('blur')); // focus moves on: the menu closes
    expect(menu(root).hidden).toBe(true);
    typeAt(inputByLabel(root, 'Name of variable 1'), 'te');
    expect(menu(root).hidden).toBe(true);
    // works without any catalog, since variables and functions come from the rule and the language
    typeAt(inputByLabel(root, 'Formula of variable 1'), 'CHA');
    expect(items(root)).toEqual(['CHANGED(']);
  });

  it('does nothing without a catalog, and starts working after setCatalog', () => {
    const { root, api } = setup({ initialModel: wrap() });
    const input = inputByLabel(root, 'Condition 1');
    typeAt(input, 'TAG("');
    expect(menu(root).hidden).toBe(true);
    api.setCatalog(() => CATALOG);
    typeAt(input, 'TAG("bu');
    expect(items(root)).toEqual(['bulk1']);
    api.setCatalog(undefined);
    typeAt(input, 'TAG("bul');
    expect(menu(root).hidden).toBe(true);
  });

  it('stays closed outside a TAG string and in non-formula cells', () => {
    const { root } = setup({ initialModel: wrap(), catalog: CATALOG });
    typeAt(inputByLabel(root, 'Condition 1'), 'temp > TAG(');
    expect(menu(root).hidden).toBe(true);
    typeAt(inputByLabel(root, 'Condition 1'), 'temp > 5');
    expect(menu(root).hidden).toBe(true);
    typeAt(inputByLabel(root, 'Description of condition 1'), 'TAG("');
    expect(menu(root).hidden).toBe(true);
    typeAt(inputByLabel(root, 'Name of variable 1'), 'TAG("');
    expect(menu(root).hidden).toBe(true);
  });

  it('works in the phone bar, inline above the input', () => {
    const root = document.createElement('div');
    Object.defineProperty(root, 'clientWidth', { value: 360, configurable: true });
    document.body.append(root);
    initRulesEditor(root, { initialModel: wrap(), catalog: CATALOG });
    (inputByLabel(root, 'Condition 1').closest('.re-cell') as HTMLElement).click();
    const barIn = root.querySelector('.re-bar input') as HTMLInputElement;
    typeAt(barIn, 'TAG("');
    expect(menu(root).hidden).toBe(false);
    expect(menu(root).classList.contains('re-menu-inline')).toBe(true);
    expect(menu(root).parentElement).toBe(root.querySelector('.re-bar'));
    key(barIn, 'ArrowDown');
    key(barIn, 'ArrowDown');
    key(barIn, 'Enter');
    expect(barIn.value).toBe('TAG("vibration1", "');
    expect(inputByLabel(root, 'Condition 1').value).toBe('TAG("vibration1", "');
    key(barIn, 'Enter');
    expect(barIn.value).toBe('TAG("vibration1", "temperature")');
    expect(menu(root).hidden).toBe(true);
    // a description cell does not offer the menu
    (inputByLabel(root, 'Description of condition 1').closest('.re-cell') as HTMLElement).click();
    typeAt(barIn, 'TAG("');
    expect(menu(root).hidden).toBe(true);
  });

  it('setXml replaces the file and reports its problems; setMonitor re-reads the cells', () => {
    const { root, api } = setup({ initialModel: wrap() });
    expect(api.setXml('<rules><rule name="x"><cond expr="TAG(&quot;a&quot;)"/><actions><publish topic="t"/></actions></rule></rules>')).toEqual([]);
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('x');
    expect(api.setXml('<rules><rule')).toEqual([expect.stringMatching(/Malformed/)]);
    expect((root.querySelector('.re-name') as HTMLInputElement).value).toBe('x');
    api.setMonitor(() => '7');
    expect(root.querySelector('.re-sheet-when .re-cell-result')?.textContent).toBe('7');
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
