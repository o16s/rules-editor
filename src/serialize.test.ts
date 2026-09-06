import { describe, it, expect } from 'vitest';
import { serialize } from './serialize.js';
import type { RulesModel, Rule } from './model.js';

const wrap = (rule: Partial<Rule>): RulesModel => ({
  rules: [{ name: 'r', variables: [], match: 'any', conditions: [], actions: [], incident: null, ...rule }],
});

describe('serialize', () => {
  it('emits an empty <rules/> document for no rules', () => {
    expect(serialize({ rules: [] })).toBe('<rules>\n</rules>\n');
  });

  it('serializes one condition row as a bare <cond expr>', () => {
    const xml = serialize(wrap({ name: 'alarm', conditions: [{ expr: 'alarm_active', description: 'PLC alarm' }] }));
    expect(xml).toContain('<rule name="alarm">');
    expect(xml).toContain('    <cond expr="alarm_active" description="PLC alarm"/>');
    expect(xml).not.toContain('<or>');
  });

  it('wraps several rows in <or> for any and <and> for all', () => {
    const rows = [{ expr: 'a' }, { expr: 'b' }];
    expect(serialize(wrap({ match: 'any', conditions: rows }))).toContain('    <or>\n      <cond expr="a"/>\n      <cond expr="b"/>\n    </or>');
    expect(serialize(wrap({ match: 'all', conditions: rows }))).toContain('    <and>\n      <cond expr="a"/>\n      <cond expr="b"/>\n    </and>');
  });

  it('omits the condition element when there are no rows', () => {
    const xml = serialize(wrap({ actions: [{ topic: 't' }] }));
    expect(xml).not.toContain('<cond');
    expect(xml).not.toContain('<or>');
  });

  it('serializes a <variables> block before the condition', () => {
    const xml = serialize(
      wrap({
        variables: [
          { name: 'temp', formula: 'TAG("vibration1", "temperature")', description: 'Housing' },
          { name: 'hot', formula: 'temp > 50' },
        ],
        conditions: [{ expr: 'hot' }],
      })
    );
    expect(xml).toContain(
      `    <variables>\n      <var name="temp" formula='TAG("vibration1", "temperature")' description="Housing"/>\n      <var name="hot" formula="temp &gt; 50"/>\n    </variables>\n    <cond expr="hot"/>`
    );
  });

  it('single-quotes a formula that contains double quotes', () => {
    const xml = serialize(wrap({ conditions: [{ expr: 'TAG("a") = "open"' }] }));
    expect(xml).toContain(`<cond expr='TAG("a") = "open"'/>`);
  });

  it('emits cooldown and edge attributes when set, omits edge="none"', () => {
    const withEdge = serialize(wrap({ cooldown: '45s', edge: 'rising', conditions: [{ expr: 'a' }] }));
    expect(withEdge).toContain('<rule name="r" cooldown="45s" edge="rising">');
    const noEdge = serialize(wrap({ edge: 'none', conditions: [{ expr: 'a' }] }));
    expect(noEdge).toContain('<rule name="r">');
    expect(noEdge).not.toContain('edge=');
  });

  it('serializes an <actions> block with multiple publishes', () => {
    const xml = serialize(
      wrap({
        conditions: [{ expr: 'a' }],
        actions: [
          { topic: 'camera/record', payload: '{"duration":40}' },
          { topic: 'iolink/x/param/reset', payload: '{}' },
        ],
      })
    );
    expect(xml).toContain('<actions>');
    expect(xml).toContain('</actions>');
    // Payload contains double quotes → single-quoted attribute, matching the docs.
    expect(xml).toContain(`<publish topic="camera/record" payload='{"duration":40}'/>`);
  });

  it('omits payload attribute when not provided', () => {
    const xml = serialize(wrap({ conditions: [{ expr: 'a' }], actions: [{ topic: 't' }] }));
    expect(xml).toContain('<publish topic="t"/>');
  });

  it('serializes an <incident> element, with first_step and cause when set', () => {
    const base = { source: 'plc1', severity: 'critical' as const, summary: 'Machine alarm active' };
    expect(serialize(wrap({ conditions: [{ expr: 'a' }], incident: base }))).toContain(
      '<incident source="plc1" severity="critical" summary="Machine alarm active"/>'
    );
    const full = serialize(wrap({ conditions: [{ expr: 'a' }], incident: { ...base, firstStep: 'Look.', cause: '=condition.description & "."' } }));
    expect(full).toContain(`<incident source="plc1" severity="critical" summary="Machine alarm active" first_step="Look." cause='=condition.description &amp; "."'/>`);
  });

  it('escapes XML metacharacters in attribute values', () => {
    const xml = serialize(wrap({ conditions: [{ expr: 'x & y < z' }] }));
    expect(xml).toContain('expr="x &amp; y &lt; z"');
  });
});
