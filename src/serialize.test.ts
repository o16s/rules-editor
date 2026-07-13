import { describe, it, expect } from 'vitest';
import { serialize } from './serialize.js';
import type { RulesModel, Rule } from './model.js';

const wrap = (rule: Partial<Rule>): RulesModel => ({
  rules: [{ name: 'r', condition: null, actions: [], incident: null, ...rule }],
});

describe('serialize', () => {
  it('emits an empty <rules/> document for no rules', () => {
    expect(serialize({ rules: [] })).toBe('<rules>\n</rules>\n');
  });

  it('serializes a leaf condition with tag/op/value (no device)', () => {
    const xml = serialize(
      wrap({
        name: 'alarm',
        condition: { kind: 'cond', tag: 'AlarmActive', op: 'eq', value: 'true' },
      })
    );
    expect(xml).toContain('<rule name="alarm">');
    expect(xml).toContain('<cond tag="AlarmActive" op="eq" value="true"/>');
  });

  it('includes device when present (IO-Link)', () => {
    const xml = serialize(
      wrap({ condition: { kind: 'cond', device: 'vibration1', tag: 'temperature', op: 'gt', value: '50.0' } })
    );
    expect(xml).toContain('<cond device="vibration1" tag="temperature" op="gt" value="50.0"/>');
  });

  it('omits value for the changed operator', () => {
    const xml = serialize(wrap({ condition: { kind: 'cond', tag: 'AlarmCode', op: 'changed' } }));
    expect(xml).toContain('<cond tag="AlarmCode" op="changed"/>');
    expect(xml).not.toContain('value=');
  });

  it('emits cooldown and edge attributes when set, omits edge="none"', () => {
    const withEdge = serialize(wrap({ cooldown: '45s', edge: 'rising', condition: { kind: 'cond', tag: 'a', op: 'eq', value: '1' } }));
    expect(withEdge).toContain('<rule name="r" cooldown="45s" edge="rising">');
    const noEdge = serialize(wrap({ edge: 'none', condition: { kind: 'cond', tag: 'a', op: 'eq', value: '1' } }));
    expect(noEdge).toContain('<rule name="r">');
    expect(noEdge).not.toContain('edge=');
  });

  it('nests and/or groups with indentation', () => {
    const xml = serialize(
      wrap({
        condition: {
          kind: 'and',
          children: [
            { kind: 'cond', tag: 'a', op: 'eq', value: 'true' },
            { kind: 'cond', tag: 'b', op: 'geq', value: '10' },
          ],
        },
      })
    );
    expect(xml).toContain('<and>');
    expect(xml).toContain('</and>');
    expect(xml).toContain('<cond tag="a" op="eq" value="true"/>');
    expect(xml).toContain('<cond tag="b" op="geq" value="10"/>');
  });

  it('serializes an <actions> block with multiple publishes', () => {
    const xml = serialize(
      wrap({
        condition: { kind: 'cond', tag: 'a', op: 'eq', value: 'true' },
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
    const xml = serialize(wrap({ condition: { kind: 'cond', tag: 'a', op: 'eq', value: '1' }, actions: [{ topic: 't' }] }));
    expect(xml).toContain('<publish topic="t"/>');
  });

  it('serializes an <incident> element', () => {
    const xml = serialize(
      wrap({
        condition: { kind: 'cond', tag: 'a', op: 'eq', value: 'true' },
        incident: { source: 'plc1', severity: 'critical', summary: 'Machine alarm active' },
      })
    );
    expect(xml).toContain('<incident source="plc1" severity="critical" summary="Machine alarm active"/>');
  });

  it('escapes XML metacharacters in attribute values', () => {
    const xml = serialize(
      wrap({ condition: { kind: 'cond', tag: 'a', op: 'eq', value: 'x & y < z' } })
    );
    expect(xml).toContain('value="x &amp; y &lt; z"');
  });
});
