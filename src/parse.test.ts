import { describe, it, expect } from 'vitest';
import { parse, validate, RulesParseError } from './parse.js';
import { serialize } from './serialize.js';
import type { RulesModel } from './model.js';

describe('parse', () => {
  it('parses a single rule with a leaf condition', () => {
    const m = parse(`<rules><rule name="alarm"><cond tag="AlarmActive" op="eq" value="true"/></rule></rules>`);
    expect(m.rules).toHaveLength(1);
    const r = m.rules[0];
    expect(r.name).toBe('alarm');
    expect(r.condition).toEqual({ kind: 'cond', tag: 'AlarmActive', op: 'eq', value: 'true' });
    expect(r.actions).toEqual([]);
    expect(r.incident).toBeNull();
  });

  it('parses device, cooldown, and edge', () => {
    const m = parse(
      `<rules><rule name="r" cooldown="30s" edge="rising"><cond device="vibration1" tag="temperature" op="gt" value="50.0"/></rule></rules>`
    );
    expect(m.rules[0].cooldown).toBe('30s');
    expect(m.rules[0].edge).toBe('rising');
    expect(m.rules[0].condition).toMatchObject({ device: 'vibration1', tag: 'temperature' });
  });

  it('normalizes operator aliases to canonical form', () => {
    const m = parse(`<rules><rule name="r"><cond tag="a" op="&gt;=" value="5"/></rule></rules>`);
    expect(m.rules[0].condition).toMatchObject({ op: 'geq' });
  });

  it('parses the changed operator without a value', () => {
    const m = parse(`<rules><rule name="r"><cond tag="AlarmCode" op="changed"/></rule></rules>`);
    expect(m.rules[0].condition).toEqual({ kind: 'cond', tag: 'AlarmCode', op: 'changed' });
  });

  it('parses nested and/or groups', () => {
    const m = parse(
      `<rules><rule name="r"><or><and><cond tag="a" op="eq" value="true"/><cond tag="b" op="gt" value="1"/></and><cond tag="c" op="eq" value="true"/></or></rule></rules>`
    );
    const cond = m.rules[0].condition as any;
    expect(cond.kind).toBe('or');
    expect(cond.children).toHaveLength(2);
    expect(cond.children[0].kind).toBe('and');
    expect(cond.children[0].children).toHaveLength(2);
  });

  it('parses actions and incident', () => {
    const m = parse(
      `<rules><rule name="r"><cond tag="a" op="eq" value="true"/><actions><publish topic="camera/record" payload='{"duration":40}'/><publish topic="t"/></actions><incident source="plc1" severity="critical" summary="Boom"/></rule></rules>`
    );
    const r = m.rules[0];
    expect(r.actions).toEqual([
      { topic: 'camera/record', payload: '{"duration":40}' },
      { topic: 't' },
    ]);
    expect(r.incident).toEqual({ source: 'plc1', severity: 'critical', summary: 'Boom' });
  });

  it('throws RulesParseError on malformed XML', () => {
    expect(() => parse('<rules><rule name="r"></rules>')).toThrow(RulesParseError);
  });

  it('throws when the root element is not <rules>', () => {
    expect(() => parse('<config/>')).toThrow(RulesParseError);
  });

  it('throws on an unknown operator', () => {
    expect(() => parse(`<rules><rule name="r"><cond tag="a" op="between" value="1"/></rule></rules>`)).toThrow(
      RulesParseError
    );
  });
});

describe('round-trip', () => {
  it('serialize → parse → serialize is stable', () => {
    const model: RulesModel = {
      rules: [
        {
          name: 'alarm-camera',
          cooldown: '45s',
          edge: 'rising',
          condition: {
            kind: 'and',
            children: [
              { kind: 'cond', tag: 'AlarmActive', op: 'eq', value: 'true' },
              { kind: 'cond', device: 'vibration1', tag: 'temperature', op: 'geq', value: '85.0' },
            ],
          },
          actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
          incident: { source: 'plc1', severity: 'critical', summary: 'Machine alarm active' },
        },
      ],
    };
    const once = serialize(model);
    const twice = serialize(parse(once));
    expect(twice).toBe(once);
  });
});

describe('validate', () => {
  const base = (over: any): RulesModel => ({
    rules: [{ name: 'r', condition: { kind: 'cond', tag: 'a', op: 'eq', value: '1' }, actions: [{ topic: 't' }], incident: null, ...over }],
  });

  it('returns no errors for a valid model', () => {
    expect(validate(base({}))).toEqual([]);
  });

  it('flags a rule with neither actions nor incident', () => {
    const errs = validate(base({ actions: [], incident: null }));
    expect(errs.join('\n')).toMatch(/actions.*incident|incident.*actions/i);
  });

  it('flags a rule with no condition', () => {
    expect(validate(base({ condition: null })).join('\n')).toMatch(/condition/i);
  });

  it('flags duplicate rule names', () => {
    const m: RulesModel = {
      rules: [
        { name: 'dup', condition: { kind: 'cond', tag: 'a', op: 'eq', value: '1' }, actions: [{ topic: 't' }], incident: null },
        { name: 'dup', condition: { kind: 'cond', tag: 'a', op: 'eq', value: '1' }, actions: [{ topic: 't' }], incident: null },
      ],
    };
    expect(validate(m).join('\n')).toMatch(/duplicate/i);
  });

  it('flags a missing value for a comparison operator', () => {
    expect(validate(base({ condition: { kind: 'cond', tag: 'a', op: 'gt' } })).join('\n')).toMatch(/value/i);
  });

  it('flags a summary over 120 characters', () => {
    const long = 'x'.repeat(121);
    expect(validate(base({ incident: { source: 's', severity: 'info', summary: long } })).join('\n')).toMatch(/120/);
  });

  it('flags nesting deeper than 4 levels', () => {
    const deep: any = { kind: 'cond', tag: 'a', op: 'eq', value: '1' };
    let node: any = deep;
    for (let i = 0; i < 5; i++) node = { kind: 'and', children: [node] };
    expect(validate(base({ condition: node })).join('\n')).toMatch(/depth|nest/i);
  });
});
