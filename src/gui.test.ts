import { describe, it, expect, beforeEach } from 'vitest';
// Everything is importable from the one entry (the editor + the core).
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
