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
} from './gui.js';

function setup(opts?: Parameters<typeof initRulesEditor>[1]): { root: HTMLElement; api: RulesEditorHandle } {
  const root = document.createElement('div');
  document.body.append(root);
  const api = initRulesEditor(root, opts);
  return { root, api };
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('button')).find((x) => x.textContent === label);
  if (!b) throw new Error(`button "${label}" not found`);
  return b as HTMLButtonElement;
}

describe('rules editor component (jsdom)', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('renders the example model with a valid status', () => {
    const { root, api } = setup();
    expect(api.getXml()).toContain('name="alarm-camera"');
    expect(root.querySelectorAll('.re-rule').length).toBe(2);
    expect(root.querySelector('.re-status.is-ok')).toBeTruthy();
    expect(root.classList.contains('re-root')).toBe(true);
  });

  it('Clear empties the model', () => {
    const { root, api } = setup();
    button(root, 'Clear').click();
    expect(api.getXml()).toBe('<rules>\n</rules>\n');
    expect(root.querySelectorAll('.re-rule').length).toBe(0);
  });

  it('Add rule appends a rule', () => {
    const { root } = setup();
    const before = root.querySelectorAll('.re-rule').length;
    button(root, 'Add rule').click();
    expect(root.querySelectorAll('.re-rule').length).toBe(before + 1);
  });

  it('editing a tag input updates the serialized XML', () => {
    const { root, api } = setup();
    const input = Array.from(root.querySelectorAll('input')).find(
      (i) => (i as HTMLInputElement).value === 'AlarmActive'
    ) as HTMLInputElement;
    input.value = 'RenamedTag';
    input.dispatchEvent(new Event('input'));
    expect(api.getXml()).toContain('tag="RenamedTag"');
    expect(api.getXml()).not.toContain('tag="AlarmActive"');
  });

  it('uses human-readable labels and no emoji', () => {
    const { root } = setup();
    const html = root.innerHTML;
    expect(html.toLowerCase()).toContain('all of');
    expect(html.toLowerCase()).toContain('any of');
    expect(html).toContain('at least'); // geq
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Delete rule')).toBe(true);
    expect(/[\u{1F000}-\u{1FAFF}⚙✅↗✖\u{1F5D1}]/u.test(root.textContent ?? '')).toBe(false);
  });

  it('surfaces a validation error for an incomplete rule', () => {
    const { root } = setup();
    button(root, 'Clear').click();
    button(root, 'Add rule').click();
    const input = Array.from(root.querySelectorAll('input')).find(
      (i) => i.previousSibling?.textContent?.startsWith('tag')
    ) as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(root.querySelector('.re-status.is-error')).toBeTruthy();
  });

  // The add buttons must not offer a step that validate() would then reject.
  function buttons(root: HTMLElement, label: string): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll('button')).filter((b) => b.textContent === label);
  }

  const leaf = (): any => ({ kind: 'cond', tag: 'a', op: 'eq', value: '1' });
  const wrap = (condition: any): RulesModel => ({
    rules: [{ name: 'r', condition, actions: [{ topic: 't' }], incident: null }],
  });

  it('stops Add group at the deepest level that still fits a condition', () => {
    // and(1) > and(2) > and(3) > cond(4): a group added at level 3 would put
    // its own condition at level 5, past LIMITS.maxDepth.
    const { root, api } = setup({
      initialModel: wrap({
        kind: 'and',
        children: [{ kind: 'and', children: [{ kind: 'and', children: [leaf()] }] }],
      }),
    });
    expect(api.getErrors()).toEqual([]);
    // A group renders its children before its own add row, so the buttons come
    // back innermost first: level 3, then 2, then 1.
    const addGroup = buttons(root, 'Add group');
    expect(addGroup).toHaveLength(3);
    expect(addGroup.map((b) => b.disabled)).toEqual([true, false, false]);
    // A condition at level 4 is still allowed, at every level.
    expect(buttons(root, 'Add condition').map((b) => b.disabled)).toEqual([false, false, false]);
    expect(addGroup[0].title).toMatch(/4 levels|deep/i);
  });

  it('stops both add buttons at the maximum number of children', () => {
    const { root, api } = setup({
      initialModel: wrap({ kind: 'and', children: Array.from({ length: LIMITS.maxChildren }, leaf) }),
    });
    expect(api.getErrors()).toEqual([]);
    expect(buttons(root, 'Add condition')[0].disabled).toBe(true);
    expect(buttons(root, 'Add group')[0].disabled).toBe(true);
    expect(buttons(root, 'Add condition')[0].title).toMatch(/16/);
  });

  it('leaves the add buttons enabled below the limits', () => {
    const { root } = setup({ initialModel: wrap({ kind: 'and', children: [leaf()] }) });
    expect(buttons(root, 'Add condition')[0].disabled).toBe(false);
    expect(buttons(root, 'Add group')[0].disabled).toBe(false);
  });

  it('names the accepted cooldown units in the field help', () => {
    const { root } = setup();
    const cool = root.querySelector('.re-f-cool input') as HTMLInputElement;
    expect(cool.title).toMatch(/ms/);
    expect(cool.title).toMatch(/\bh\b/);
  });

  const invalid = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll('.is-invalid')).map((e) => (e as HTMLElement).dataset.loc ?? '?');

  it('marks the field an issue belongs to, not the whole rule', () => {
    const { root } = setup({
      initialModel: wrap({ kind: 'and', children: [leaf(), { kind: 'cond', tag: 'b', op: 'gt' } as any] }),
    });
    // Only the value input of the second child is at fault.
    expect(invalid(root)).toEqual(['0|value|1|']);
    const marked = root.querySelector('.is-invalid') as HTMLElement;
    expect(marked.classList.contains('re-f-val')).toBe(true);
    expect(marked.title).toMatch(/needs a value/);
  });

  it('marks a bad cooldown on the cooldown field', () => {
    const { root } = setup({
      initialXml: `<rules><rule name="r" cooldown="5d"><cond tag="a" op="eq" value="1"/><actions><publish topic="t"/></actions></rule></rules>`,
    });
    expect(invalid(root)).toEqual(['0|cooldown||']);
  });

  it('clears the mark as soon as the field is fixed, without a re-render', () => {
    const { root, api } = setup({ initialModel: wrap({ kind: 'cond', tag: '', op: 'eq', value: '1' } as any) });
    expect(invalid(root)).toEqual(['0|tag||']);
    const input = (root.querySelector('.re-f-tag input') as HTMLInputElement);
    input.value = 'AlarmActive';
    input.dispatchEvent(new Event('input'));
    expect(api.getErrors()).toEqual([]);
    expect(invalid(root)).toEqual([]);
  });

  it('marks the group an empty-group issue belongs to', () => {
    const { root } = setup({ initialModel: wrap({ kind: 'and', children: [{ kind: 'or', children: [] }] } as any) });
    expect(invalid(root)).toEqual(['0|condition|0|']);
    expect((root.querySelector('.is-invalid') as HTMLElement).classList.contains('re-group')).toBe(true);
  });

  it('marks the rule when the issue has no single field', () => {
    const { root } = setup({ initialModel: { rules: [{ name: 'r', condition: leaf(), actions: [], incident: null }] } });
    expect(invalid(root)).toEqual(['0|||']);
    expect((root.querySelector('.is-invalid') as HTMLElement).classList.contains('re-rule')).toBe(true);
  });

  it('blocks Export and Copy while the model is invalid, and frees them once fixed', () => {
    const { root } = setup({ initialModel: wrap({ kind: 'cond', tag: '', op: 'eq', value: '1' } as any) });
    expect(button(root, 'Export XML').disabled).toBe(true);
    expect(button(root, 'Copy XML').disabled).toBe(true);
    expect(button(root, 'Export XML').title).toMatch(/1 issue/);
    const input = (root.querySelector('.re-f-tag input') as HTMLInputElement);
    input.value = 'ok';
    input.dispatchEvent(new Event('input'));
    expect(button(root, 'Export XML').disabled).toBe(false);
    expect(button(root, 'Copy XML').disabled).toBe(false);
  });

  it('still reports the xml through onChange while invalid, so a host can autosave', () => {
    let last: any;
    setup({ initialModel: wrap({ kind: 'cond', tag: '', op: 'eq', value: '1' } as any), onChange: (s) => (last = s) });
    expect(last.errors.length).toBe(1);
    expect(last.xml).toContain('<rule name="r">');
  });

  it('stops mobile keyboards rewriting identifier fields', () => {
    const { root } = setup();
    // A tag must match the .udt field exactly; iOS would capitalise and correct it.
    for (const cls of ['.re-f-name', '.re-f-cool', '.re-f-dev', '.re-f-tag', '.re-f-val']) {
      const input = root.querySelector(`${cls} input`) as HTMLInputElement;
      expect(input, cls).toBeTruthy();
      expect(input.getAttribute('autocapitalize'), cls).toBe('off');
      expect(input.getAttribute('autocorrect'), cls).toBe('off');
      expect(input.getAttribute('spellcheck'), cls).toBe('false');
    }
    const inputs = Array.from(root.querySelectorAll('input')) as HTMLInputElement[];
    const topic = inputs.find((i) => i.value.includes('camera/record'))!;
    expect(topic.getAttribute('autocapitalize')).toBe('off');
    // A summary is prose, so leave the keyboard alone.
    const summary = inputs.find((i) => i.value.startsWith('Machine alarm'))!;
    expect(summary.getAttribute('autocapitalize')).toBe(null);
    expect(summary.getAttribute('spellcheck')).toBe(null);
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

  it('lifts every control to 16px when narrow, so iOS does not zoom on focus', () => {
    const blocks = narrowBlocks(sheet());
    expect(blocks.length).toBeGreaterThan(0);
    const sized = blocks.flatMap((b) => [...b.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1])));
    expect(sized.length).toBeGreaterThan(0);
    expect(sized.every((n) => n >= 16)).toBe(true);
    // The controls themselves, not just some heading.
    expect(blocks.join('')).toMatch(/\.re-field input[^{]*\{[^}]*font-size:\s*16px/);
  });

  it('gives the small controls a touch-sized target when narrow', () => {
    const block = narrowBlocks(sheet()).join('');
    for (const sel of ['.re-remove', '.re-link', '.re-btn-primary']) {
      const rule = new RegExp(`\\${sel}[^{]*\\{[^}]*min-height:\\s*(\\d+)px`).exec(block);
      expect(rule, `${sel} has no min-height when narrow`).not.toBeNull();
      expect(Number(rule![1]), sel).toBeGreaterThanOrEqual(44);
    }
    expect(block).toMatch(/\.re-toggle input[^{]*\{[^}]*(width|height):\s*2[2-9]px/);
  });

  it('gives the long fields a whole row at the smallest widths', () => {
    const css = sheet();
    // A second, tighter breakpoint, emitted for container and viewport alike.
    const tight = [...css.matchAll(/@(?:media|container)[^{]*max-width:\s*430px[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    expect(tight.length).toBe(2);
    const block = tight.join('');
    // summary, payload and topic are the longest values in the format; at two
    // columns they were showing about eleven characters.
    expect(block).toMatch(/\.re-row[^{]*,[^{]*\.re-pubrow[^{]*,[^{]*\.re-incrow[^{]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    // The remove button pairs with the fields it removes instead of sitting alone below them.
    expect(block).toMatch(/\.re-remove[^{]*\{[^}]*grid-row:\s*1\s*\/\s*-1/);
    // The trigger select clipped to "on rising edg" while sharing a row.
    expect(block).toMatch(/\.re-rule-head\s*>\s*\.re-field[^{]*\{[^}]*flex:\s*1 1 100%/);
  });

  it('injects its scoped stylesheet once', () => {
    setup();
    setup();
    expect(document.querySelectorAll('#octaview-rules-editor-styles').length).toBe(1);
  });
});

describe('rules editor component API', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  const oneRule: RulesModel = {
    rules: [{ name: 'x', condition: { kind: 'cond', tag: 'a', op: 'eq', value: '1' }, actions: [{ topic: 't' }], incident: null }],
  };

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

  it('accepts valid initialXml', () => {
    const xml = '<rules>\n  <rule name="r">\n    <cond tag="a" op="eq" value="1"/>\n    <actions>\n      <publish topic="t"/>\n    </actions>\n  </rule>\n</rules>\n';
    const { api } = setup({ initialXml: xml });
    expect(api.getXml()).toContain('name="r"');
    expect(api.getErrors()).toEqual([]);
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

  it('re-exports the located issues and the cooldown pattern too', async () => {
    const entry = await import('./index.js');
    expect(typeof entry.validateIssues).toBe('function');
    expect(typeof entry.COOLDOWN_PATTERN).toBe('string');
    expect(entry.COOLDOWN_RE.test('1m30s')).toBe(true);
    expect(entry.validateIssues({ rules: [{ name: '', condition: null, actions: [], incident: null }] })[0])
      .toMatchObject({ rule: 0, field: 'name' });
  });

  it('re-exports the core (parse/serialize/validate) from the same entry', () => {
    const m: RulesModel = parse('<rules><rule name="r"><cond tag="a" op="eq" value="1"/><actions><publish topic="t"/></actions></rule></rules>');
    expect(serialize(m)).toContain('name="r"');
    expect(validate(m)).toEqual([]);
    expect(() => parse('<bad')).toThrow(RulesParseError);
  });

  it('setModel replaces the model; destroy tears down', () => {
    const { root, api } = setup();
    api.setModel({ rules: [] });
    expect(api.getXml()).toBe('<rules>\n</rules>\n');
    api.destroy();
    expect(root.children.length).toBe(0);
    expect(root.classList.contains('re-root')).toBe(false);
  });
});
