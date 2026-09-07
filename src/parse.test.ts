import { describe, it, expect } from 'vitest';
import { parse, validate, validateIssues, RulesParseError } from './parse.js';
import { serialize } from './serialize.js';
import type { Rule, RulesModel } from './model.js';

const rule = (over: Partial<Rule> = {}): Rule => ({
  name: 'r',
  variables: [],
  match: 'any',
  conditions: [{ expr: 'TAG("a") = 1' }],
  actions: [{ topic: 't' }],
  incident: null,
  ...over,
});
const wrap = (over: Partial<Rule> = {}): RulesModel => ({ rules: [rule(over)] });

describe('parse', () => {
  it('parses a single formula condition', () => {
    const m = parse(`<rules><rule name="alarm"><cond expr="alarm_active" description="PLC alarm"/></rule></rules>`);
    expect(m.rules).toHaveLength(1);
    const r = m.rules[0];
    expect(r.name).toBe('alarm');
    expect(r.match).toBe('any');
    expect(r.conditions).toEqual([{ expr: 'alarm_active', description: 'PLC alarm' }]);
    expect(r.variables).toEqual([]);
    expect(r.actions).toEqual([]);
    expect(r.incident).toBeNull();
  });

  it('drops a leading = from expr and formula', () => {
    const m = parse(`<rules><rule name="r"><variables><var name="t" formula='=TAG("a")'/></variables><cond expr="=t &gt; 1"/></rule></rules>`);
    expect(m.rules[0].variables[0].formula).toBe('TAG("a")');
    expect(m.rules[0].conditions[0].expr).toBe('t > 1');
  });

  it('parses variables with descriptions', () => {
    const m = parse(
      `<rules><rule name="r"><variables><var name="temp" formula='TAG("vibration1", "temperature")' description="Housing"/><var name="hot" formula="temp &gt; 50"/></variables><cond expr="hot"/></rule></rules>`
    );
    expect(m.rules[0].variables).toEqual([
      { name: 'temp', formula: 'TAG("vibration1", "temperature")', description: 'Housing' },
      { name: 'hot', formula: 'temp > 50' },
    ]);
  });

  it('parses a level-1 group as rows with the match mode', () => {
    const or = parse(`<rules><rule name="r"><or><cond expr="a"/><cond expr="b" description="B"/></or></rule></rules>`);
    expect(or.rules[0].match).toBe('any');
    expect(or.rules[0].conditions).toEqual([{ expr: 'a' }, { expr: 'b', description: 'B' }]);
    const and = parse(`<rules><rule name="r"><and><cond expr="a"/><cond expr="b"/></and></rule></rules>`);
    expect(and.rules[0].match).toBe('all');
  });

  it('reads a v0.2 leaf as a formula row', () => {
    const m = parse(`<rules><rule name="alarm"><cond tag="AlarmActive" op="eq" value="true"/></rule></rules>`);
    expect(m.rules[0].conditions).toEqual([{ expr: 'TAG("AlarmActive") = true' }]);
  });

  it('parses device, cooldown, and edge', () => {
    const m = parse(
      `<rules><rule name="r" cooldown="30s" edge="rising"><cond device="vibration1" tag="temperature" op="gt" value="50.0"/></rule></rules>`
    );
    expect(m.rules[0].cooldown).toBe('30s');
    expect(m.rules[0].edge).toBe('rising');
    expect(m.rules[0].conditions[0].expr).toBe('TAG("vibration1", "temperature") > 50.0');
  });

  it('normalizes v0.2 operator aliases', () => {
    const m = parse(`<rules><rule name="r"><cond tag="a" op="&gt;=" value="5"/></rule></rules>`);
    expect(m.rules[0].conditions[0].expr).toBe('TAG("a") >= 5');
  });

  it('reads the v0.2 changed operator as CHANGED()', () => {
    const m = parse(`<rules><rule name="r"><cond tag="AlarmCode" op="changed"/></rule></rules>`);
    expect(m.rules[0].conditions[0].expr).toBe('CHANGED(TAG("AlarmCode"))');
  });

  it('folds nested v0.2 groups into one formula row', () => {
    const m = parse(
      `<rules><rule name="r"><or><and description="both"><cond tag="a" op="eq" value="true"/><cond tag="b" op="gt" value="1"/></and><cond tag="c" op="eq" value="true"/></or></rule></rules>`
    );
    expect(m.rules[0].match).toBe('any');
    expect(m.rules[0].conditions).toEqual([
      { expr: 'AND(TAG("a") = true, TAG("b") > 1)', description: 'both' },
      { expr: 'TAG("c") = true' },
    ]);
  });

  it('folds a one-child group into the child', () => {
    const m = parse(`<rules><rule name="r"><and><or><cond expr="x"/></or></and></rule></rules>`);
    expect(m.rules[0].conditions).toEqual([{ expr: 'x' }]);
  });

  it('parses actions and incident, with first_step and cause', () => {
    const m = parse(
      `<rules><rule name="r"><cond expr="a"/><actions><publish topic="camera/record" payload='{"duration":40}'/><publish topic="t"/></actions><incident source="plc1" severity="critical" summary="Boom" first_step="Look" cause="=condition.description"/></rule></rules>`
    );
    const r = m.rules[0];
    expect(r.actions).toEqual([
      { topic: 'camera/record', payload: '{"duration":40}' },
      { topic: 't' },
    ]);
    expect(r.incident).toEqual({ source: 'plc1', severity: 'critical', summary: 'Boom', firstStep: 'Look', cause: '=condition.description' });
  });

  it('throws RulesParseError on malformed XML', () => {
    expect(() => parse('<rules><rule name="r"></rules>')).toThrow(RulesParseError);
  });

  it('throws when the root element is not <rules>', () => {
    expect(() => parse('<config/>')).toThrow(RulesParseError);
  });

  it('throws on a v0.2 leaf with an unknown operator, no op, no tag, or no value', () => {
    const bad = (cond: string) => expect(() => parse(`<rules><rule name="r">${cond}</rule></rules>`)).toThrow(RulesParseError);
    bad('<cond tag="a" op="between" value="1"/>');
    bad('<cond tag="a" value="1"/>');
    bad('<cond op="eq" value="1"/>');
    bad('<cond tag="a" op="gt"/>');
    bad('<cond tag="a" op="eq" value=""/>');
  });

  it('throws on a cond with both expr and tag, or with neither', () => {
    expect(() => parse(`<rules><rule name="r"><cond expr="a" tag="b" op="eq" value="1"/></rule></rules>`)).toThrow(/both/);
    expect(() => parse(`<rules><rule name="r"><cond description="x"/></rule></rules>`)).toThrow(/missing expr/);
  });

  it('throws on a nested group that is empty, too wide, or too deep', () => {
    const bad = (body: string, re: RegExp) => expect(() => parse(`<rules><rule name="r">${body}</rule></rules>`)).toThrow(re);
    bad('<and><or/></and>', /empty/);
    bad(`<and><or>${'<cond expr="x"/>'.repeat(17)}</or></and>`, /17 children/);
    bad('<and><and><and><and><cond expr="x"/></and></and></and></and>', /nested deeper than 4 levels/);
  });

  it('throws on a var without name or formula', () => {
    expect(() => parse(`<rules><rule name="r"><variables><var formula="1"/></variables><cond expr="a"/></rule></rules>`)).toThrow(/missing name/);
    expect(() => parse(`<rules><rule name="r"><variables><var name="x"/></variables><cond expr="a"/></rule></rules>`)).toThrow(/missing formula/);
  });
});

describe('round-trip', () => {
  it('serialize → parse → serialize is stable', () => {
    const model = wrap({
      name: 'alarm-camera',
      cooldown: '45s',
      edge: 'rising',
      variables: [
        { name: 'alarm_active', formula: 'TAG("plc1", "AlarmActive")', description: 'Cell 3 PLC has set its own alarm bit' },
        { name: 'temp', formula: 'TAG("vibration1", "temperature")' },
      ],
      match: 'all',
      conditions: [{ expr: 'alarm_active', description: 'PLC alarm' }, { expr: 'temp >= 85.0' }],
      actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
      incident: { source: 'plc1', severity: 'critical', summary: 'Machine alarm active', firstStep: 'Watch the clip.', cause: '=condition.description & "."' },
    });
    const once = serialize(model);
    expect(parse(once)).toEqual(model);
    expect(serialize(parse(once))).toBe(once);
  });

  it('re-saves a v0.2 file in the v0.3 form', () => {
    const v2 = `<rules><rule name="r" edge="rising"><and><cond tag="AlarmActive" op="eq" value="true"/><cond tag="Temperature" op="geq" value="85.0"/></and><incident source="plc1" severity="critical" summary="s"/></rule></rules>`;
    const xml = serialize(parse(v2));
    expect(xml).toContain(`<and>\n      <cond expr='TAG("AlarmActive") = true'/>\n      <cond expr='TAG("Temperature") &gt;= 85.0'/>\n    </and>`);
    expect(xml).not.toContain('tag=');
  });
});

describe('validate', () => {
  it('returns no errors for a valid model', () => {
    expect(validate(wrap())).toEqual([]);
  });

  it('accepts the 13a rule', () => {
    const m = wrap({
      variables: [
        { name: 'alarm_active', formula: 'TAG("plc1", "AlarmActive")' },
        { name: 'temp', formula: 'TAG("vibration1", "temperature")' },
        { name: 'temp_rate', formula: 'RATE(temp, 30min)' },
        { name: 'milk_temp', formula: 'TAG("bulk1", "milk_temperature")' },
        { name: 'door_changed', formula: 'CHANGED(TAG("bulk1", "door_state"))' },
        { name: 'status_word', formula: 'TAG("plc1", "StatusWord")' },
        { name: 'guard_open', formula: 'BITAND(status_word, 4) != 0' },
        { name: 'in_manual', formula: 'BITAND(status_word, HEX2DEC("10")) != 0' },
        { name: 'alarm_byte', formula: 'TAG("plc1", "AlarmFlags")' },
        { name: 'any_plc_alarm', formula: 'BITAND(alarm_byte, HEX2DEC("FF")) != 0' },
      ],
      conditions: [
        { expr: 'alarm_active', description: 'Cell 3 PLC raised its own alarm' },
        { expr: 'temp > 50' },
        { expr: 'temp_rate > 4' },
        { expr: 'AND(milk_temp > 3.6, door_changed)' },
        { expr: 'any_plc_alarm' },
      ],
      actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
      incident: {
        source: 'Cell 3 press',
        severity: 'critical',
        summary: 'Press guard alarm on cell 3',
        firstStep: 'Watch the 40 s camera clip before you open the cell.',
        cause: '=condition.description & ". The press PLC set its own alarm bit."',
      },
    });
    expect(validate(m)).toEqual([]);
  });

  it('flags a rule with neither actions nor incident', () => {
    const errs = validate(wrap({ actions: [], incident: null }));
    expect(errs.join('\n')).toMatch(/add an action in Then/);
  });

  it('flags a rule with no condition, and one with too many', () => {
    expect(validate(wrap({ conditions: [] })).join('\n')).toMatch(/at least one condition/i);
    expect(validate(wrap({ conditions: Array.from({ length: 17 }, () => ({ expr: 'a = 1' })) })).join('\n')).toMatch(/17 conditions/);
  });

  it('flags an empty condition row', () => {
    expect(validate(wrap({ conditions: [{ expr: '' }] })).join('\n')).toMatch(/condition 1 is empty/);
  });

  it('flags duplicate rule names', () => {
    const m: RulesModel = { rules: [rule({ name: 'dup' }), rule({ name: 'dup' })] };
    expect(validate(m).join('\n')).toMatch(/Another rule is already called "dup"/);
  });

  it('flags a formula that does not parse, with its column', () => {
    expect(validate(wrap({ conditions: [{ expr: 'temp >' }] })).join('\n')).toMatch(/condition 1: .*column 7/);
    expect(validate(wrap({ variables: [{ name: 'x', formula: 'AND(a' }] })).join('\n')).toMatch(/variable "x": .*column/);
  });

  it('flags an unknown variable reference', () => {
    expect(validate(wrap({ conditions: [{ expr: 'temp > 50' }] })).join('\n')).toMatch(/"temp" is not a variable/);
    const ok = wrap({ variables: [{ name: 'temp', formula: 'TAG("t")' }], conditions: [{ expr: 'temp > 50' }] });
    expect(validate(ok)).toEqual([]);
  });

  it('flags unknown functions and wrong argument counts', () => {
    expect(validate(wrap({ conditions: [{ expr: 'NOPE(1)' }] })).join('\n')).toMatch(/There is no function called NOPE\(\)/);
    expect(validate(wrap({ conditions: [{ expr: 'NOT(a, b)' }] })).join('\n')).toMatch(/NOT\(\) takes 1 argument/);
    expect(validate(wrap({ conditions: [{ expr: 'AND(TAG("a"))' }] })).join('\n')).toMatch(/AND\(\) takes 2 to 16 arguments, not 1/);
  });

  it('flags a condition that is not a boolean', () => {
    const m = wrap({ variables: [{ name: 'temp', formula: 'TAG("t")' }], conditions: [{ expr: 'temp + 1' }] });
    expect(validate(m).join('\n')).toMatch(/must be true or false, but this is a number/);
    expect(validate(wrap({ conditions: [{ expr: '"open"' }] })).join('\n')).toMatch(/is a string/);
    // A bare TAG or an unknown-typed variable passes: it can be a boolean field.
    expect(validate(wrap({ conditions: [{ expr: 'TAG("AlarmActive")' }] }))).toEqual([]);
    const viaVar = wrap({ variables: [{ name: 'rate', formula: 'RATE(TAG("t"), 30min)' }], conditions: [{ expr: 'rate' }] });
    expect(validate(viaVar).join('\n')).toMatch(/is a number/);
  });

  it('flags a context name that does not exist', () => {
    const bad = wrap({ incident: { source: 's', severity: 'info', summary: '=condition.descripton & "."' } });
    expect(validate(bad).join('\n')).toMatch(/"condition.descripton" is not a known name. Did you mean condition.description/);
    expect(validate(wrap({ actions: [{ topic: '=rule.name' }] })).join('\n')).toMatch(/"rule.name" is not a known name/);
  });

  it('flags condition.description outside a Then field', () => {
    expect(validate(wrap({ conditions: [{ expr: 'condition.description = "x"' }] })).join('\n')).toMatch(/only be used in a Then field/);
    expect(validate(wrap({ variables: [{ name: 'd', formula: 'condition.description' }] })).join('\n')).toMatch(/only be used in a Then field/);
    const ok = wrap({ incident: { source: 's', severity: 'info', summary: '=condition.description' } });
    expect(validate(ok)).toEqual([]);
  });

  it('flags bad variable names, reserved words, and duplicates', () => {
    const v = (name: string) => validate(wrap({ variables: [{ name, formula: '1' }] })).join('\n');
    expect(v('1st')).toMatch(/letters, digits and underscores/);
    expect(v('milk temp')).toMatch(/letters, digits and underscores/);
    expect(v('TAG')).toMatch(/reserved word/);
    expect(v('true')).toMatch(/reserved word/);
    expect(v('')).toMatch(/has no name/);
    const dup = wrap({ variables: [{ name: 'a', formula: '1' }, { name: 'a', formula: '2' }] });
    expect(validate(dup).join('\n')).toMatch(/variable "a" is defined twice/);
    expect(validate(wrap({ variables: [{ name: 'a', formula: '' }] })).join('\n')).toMatch(/has no formula/);
  });

  it('flags too many variables', () => {
    const many = Array.from({ length: 65 }, (_, i) => ({ name: `v${i}`, formula: '1' }));
    expect(validate(wrap({ variables: many })).join('\n')).toMatch(/this rule has 65 variables\. The most is 64/);
  });

  it('flags a variable cycle once, on its first variable', () => {
    const m = wrap({
      variables: [
        { name: 'a', formula: 'b + 1' },
        { name: 'b', formula: 'c + 1' },
        { name: 'c', formula: 'a + 1' },
        { name: 'd', formula: 'a' },
      ],
    });
    const errs = validate(m).filter((e) => /refers to itself/.test(e));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/variable "a" refers to itself: a → b → c → a/);
    expect(validate(wrap({ variables: [{ name: 'x', formula: 'x' }] })).join('\n')).toMatch(/x → x/);
  });

  it('flags a Then field formula that does not parse or references an unknown variable', () => {
    expect(validate(wrap({ actions: [{ topic: '=', payload: '=x' }] })).join('\n')).toMatch(/topic: .*incomplete/);
    expect(validate(wrap({ actions: [{ topic: '=', payload: '=x' }] })).join('\n')).toMatch(/payload: "x" is not a variable/);
    expect(validate(wrap({ incident: { source: 's', severity: 'info', summary: 'ok', cause: '=condition.description &' } })).join('\n')).toMatch(/cause: /);
    // Plain text is never checked as a formula.
    expect(validate(wrap({ actions: [{ topic: 'a & b (c', payload: 'x' }] }))).toEqual([]);
  });

  it('flags a title over 120 characters, and text fields over 240', () => {
    const inc = (over: object) => validate(wrap({ incident: { source: 's', severity: 'info', summary: 'x', ...over } })).join('\n');
    expect(inc({ summary: 'x'.repeat(121) })).toMatch(/120/);
    expect(inc({ firstStep: 'x'.repeat(241) })).toMatch(/the first step is longer than 240/);
    expect(inc({ cause: 'x'.repeat(241) })).toMatch(/the cause is longer than 240/);
    expect(inc({ cause: 'x'.repeat(240) })).toBe('');
    expect(validate(wrap({ conditions: [{ expr: 'a = 1', description: 'x'.repeat(241) }] })).join('\n')).toMatch(/condition 1: the description is longer than 240/);
    expect(validate(wrap({ variables: [{ name: 'a', formula: '1', description: 'x'.repeat(241) }] })).join('\n')).toMatch(/variable "a": the description is longer than 240/);
  });

  it('flags a cooldown that is not a Go duration', () => {
    expect(validate(wrap({ cooldown: '5d' })).join('\n')).toMatch(/cooldown/i);
    expect(validate(wrap({ cooldown: 'soon' })).join('\n')).toMatch(/cooldown/i);
    expect(validate(wrap({ cooldown: '1m 30s' })).join('\n')).toMatch(/cooldown/i);
    expect(validate(wrap({ cooldown: '-30s' })).join('\n')).toMatch(/cooldown/i);
  });

  it('accepts every Go duration form the reference shows', () => {
    for (const cd of ['30s', '1m', '1m30s', '500ms', '0', '1.5s', '2h', '1h0m0s', '.5s', '1us', '1µs', '1ns']) {
      expect(validate(wrap({ cooldown: cd })), cd).toEqual([]);
    }
  });

  it('counts the title limit in code points, not UTF-16 units', () => {
    // 120 astral characters are 240 UTF-16 units but 120 characters.
    const emoji = '\u{1F600}'.repeat(120);
    expect(validate(wrap({ incident: { source: 's', severity: 'info', summary: emoji } }))).toEqual([]);
    const tooMany = '\u{1F600}'.repeat(121);
    expect(validate(wrap({ incident: { source: 's', severity: 'info', summary: tooMany } })).join('\n')).toMatch(/120/);
  });
});

describe('validateIssues', () => {
  const find = (m: RulesModel, field: string) => validateIssues(m).find((i) => i.field === field);

  it('returns the same messages, in the same order, as validate()', () => {
    const m: RulesModel = {
      rules: [
        rule({ name: '', cooldown: 'nope', conditions: [], actions: [{ topic: '' }], incident: { source: '', severity: 'info', summary: '' } }),
        rule({ name: 'dup', variables: [{ name: '1', formula: 'x(' }], conditions: [{ expr: 'a >' }], actions: [], incident: null }),
        rule({ name: 'dup', conditions: [{ expr: '' }], actions: [] }),
      ],
    };
    expect(validateIssues(m).map((i) => i.message)).toEqual(validate(m));
    expect(validate(m).length).toBeGreaterThan(8);
  });

  it('points a rule-level issue at its rule and field', () => {
    expect(find(wrap({ cooldown: '5d' }), 'cooldown')).toMatchObject({ rule: 0, field: 'cooldown' });
    expect(find(wrap({ name: '' }), 'name')).toMatchObject({ rule: 0, field: 'name' });
    expect(find(wrap({ conditions: [] }), 'condition')).toMatchObject({ rule: 0, field: 'condition' });
  });

  it('points a variable issue at its index', () => {
    const m = wrap({ variables: [{ name: 'a', formula: '1' }, { name: '2b', formula: 'nope(' }] });
    expect(find(m, 'variable')).toMatchObject({ rule: 0, field: 'variable', variable: 1 });
    expect(find(m, 'formula')).toMatchObject({ rule: 0, field: 'formula', variable: 1 });
  });

  it('points a condition issue at its index', () => {
    const m = wrap({ conditions: [{ expr: 'TAG("a") = 1' }, { expr: 'TAG("b") >' }, { expr: 'TAG("c") = 1', description: 'x'.repeat(241) }] });
    expect(find(m, 'expr')).toMatchObject({ rule: 0, field: 'expr', condition: 1 });
    expect(find(m, 'description')).toMatchObject({ rule: 0, field: 'description', condition: 2 });
  });

  it('points an incident issue at the incident field', () => {
    const m = wrap({ incident: { source: '', severity: 'info', summary: 'x'.repeat(121), cause: '=' } });
    expect(find(m, 'source')).toMatchObject({ rule: 0, field: 'source' });
    expect(find(m, 'summary')).toMatchObject({ rule: 0, field: 'summary' });
    expect(find(m, 'cause')).toMatchObject({ rule: 0, field: 'cause' });
  });

  it('points a publish issue at its action index', () => {
    const m = wrap({ actions: [{ topic: 'ok' }, { topic: '' }, { topic: 'ok', payload: '=(' }] });
    expect(find(m, 'topic')).toMatchObject({ rule: 0, field: 'topic', action: 1 });
    expect(find(m, 'payload')).toMatchObject({ rule: 0, field: 'payload', action: 2 });
  });

  it('leaves a model-wide issue without a rule', () => {
    const many: RulesModel = { rules: Array.from({ length: 1001 }, (_, i) => rule({ name: `r${i}` })) };
    expect(validateIssues(many)[0].message).toMatch(/Too many rules/);
    expect(validateIssues(many)[0]).not.toHaveProperty('rule');
  });
});
