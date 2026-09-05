import type { RulesModel } from '../src/model.js';

/** A realistic file: nested logic, actions, an incident, a cooldown, an edge. */
export const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rules>
  <rule name="overheat" cooldown="30s" edge="rising">
    <and>
      <cond device="vibration1" tag="temperature" op="gt" value="50.0"/>
      <or>
        <cond tag="FanRunning" op="eq" value="false"/>
        <cond tag="CoolantFlow" op="lt" value="2.5"/>
      </or>
    </and>
    <actions>
      <publish topic="line1/camera/record" payload='{"duration":40}'/>
      <publish topic="line1/hmi/alert"/>
    </actions>
    <incident source="plc1" severity="critical" summary="Spindle overheating on line 1"/>
  </rule>
  <rule name="alarm-code-changed">
    <cond tag="AlarmCode" op="changed"/>
    <actions>
      <publish topic="line1/alarms"/>
    </actions>
  </rule>
</rules>`;

/** Root element closed in the wrong place — parse() rejects it. */
export const MALFORMED_XML = `<rules><rule name="r"></rules>`;

/** Parses fine, but every rule breaks a validation constraint. */
export const INVALID_MODEL: RulesModel = {
  rules: [
    // Empty name, no condition, no action and no incident.
    { name: '', cooldown: '30 seconds', condition: null, actions: [], incident: null },
    // Duplicate name, a value on a valueless operator, an empty publish topic.
    {
      name: 'dup',
      condition: { kind: 'cond', tag: '', op: 'changed', value: 'nope' },
      actions: [{ topic: '' }],
      incident: { source: 'plc1', severity: 'error', summary: 'x'.repeat(200) },
    },
    { name: 'dup', condition: { kind: 'and', children: [] }, actions: [], incident: null },
  ],
};

/** `count` near-identical rules — for scrolling, layout and render cost. */
export function manyRules(count: number): RulesModel {
  return {
    rules: Array.from({ length: count }, (_, i) => ({
      name: `rule-${String(i + 1).padStart(3, '0')}`,
      cooldown: '10s',
      condition: {
        kind: 'cond' as const,
        device: `sensor${i % 8}`,
        tag: 'temperature',
        op: 'gt' as const,
        value: String(40 + i),
      },
      actions: [{ topic: `line1/sensor${i % 8}/hot` }],
      incident: null,
    })),
  };
}

/** Nested to the maximum allowed depth (LIMITS.maxDepth). */
export const DEEP_MODEL: RulesModel = {
  rules: [
    {
      name: 'deep',
      condition: {
        kind: 'and',
        children: [
          { kind: 'cond', tag: 'a', op: 'eq', value: '1' },
          {
            kind: 'or',
            children: [
              { kind: 'cond', tag: 'b', op: 'neq', value: '2' },
              {
                kind: 'and',
                children: [
                  { kind: 'cond', tag: 'c', op: 'geq', value: '3' },
                  { kind: 'cond', tag: 'd', op: 'changed' },
                ],
              },
            ],
          },
        ],
      },
      actions: [{ topic: 'deep/hit' }],
      incident: null,
    },
  ],
};
