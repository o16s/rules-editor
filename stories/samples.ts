import type { Rule, RulesModel } from '../src/model.js';
import type { MonitorRef, TagCatalog } from '../src/gui.js';

const rule = (r: Partial<Rule> & { name: string }): Rule => ({
  variables: [],
  match: 'any',
  conditions: [],
  actions: [],
  incident: null,
  ...r,
});

/** The rule set of the design handoff (slide 13a), plus five rail rules. */
export const EXAMPLE_MODEL: RulesModel = {
  rules: [
    rule({
      name: 'alarm-camera',
      cooldown: '45s',
      edge: 'rising',
      variables: [
        { name: 'alarm_active', formula: 'TAG("plc1", "AlarmActive")', description: 'Cell 3 PLC has set its own alarm bit' },
        { name: 'temp', formula: 'TAG("vibration1", "temperature")', description: 'Press motor housing temperature' },
        { name: 'temp_rate', formula: 'RATE(temp, 30min)', description: 'How fast the housing is heating, over 30 min' },
        { name: 'milk_temp', formula: 'TAG("bulk1", "milk_temperature")', description: 'Bulk tank 1 milk temperature' },
        { name: 'door_changed', formula: 'CHANGED(TAG("bulk1", "door_state"))', description: 'Bulk tank 1 door opened or closed' },
        { name: 'status_word', formula: 'TAG("plc1", "StatusWord")', description: 'Cell 3 PLC status register, 16 bits' },
        { name: 'guard_open', formula: 'BITAND(status_word, 4) != 0', description: 'Bit 2 of the status word: guard door open' },
        { name: 'in_manual', formula: 'BITAND(status_word, HEX2DEC("10")) != 0', description: 'Bit 4 of the status word: cell in manual mode' },
        { name: 'alarm_byte', formula: 'TAG("plc1", "AlarmFlags")', description: 'Cell 3 PLC alarm flags, one bit per alarm' },
        { name: 'any_plc_alarm', formula: 'BITAND(alarm_byte, HEX2DEC("FF")) != 0', description: 'At least one PLC alarm flag is raised' },
      ],
      conditions: [
        { expr: 'alarm_active', description: 'Cell 3 PLC raised its own alarm' },
        { expr: 'temp > 50', description: 'Housing above 50 °C' },
        { expr: 'temp_rate > 4', description: 'Housing heating faster than 4 °C/h' },
        { expr: 'AND(milk_temp > 3.6, door_changed)', description: 'Milk warm while the tank door moved' },
        { expr: 'any_plc_alarm', description: 'Cell 3 PLC reports an alarm' },
      ],
      actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
      incident: {
        source: 'Cell 3 press',
        severity: 'critical',
        summary: 'Press guard alarm on cell 3',
        firstStep: 'Watch the 40 s camera clip before you open the cell.',
        cause: '=condition.description & ". The press PLC set its own alarm bit. We read that bit and nothing upstream of it, so the reason sits in the PLC."',
      },
    }),
    rule({
      name: 'pump-overtemp',
      cooldown: '60s',
      edge: 'rising',
      variables: [
        { name: 'vrms_alert', formula: 'TAG("vibration1", "alert_vrms_max")', description: 'Sensor vibration alert bit' },
        { name: 'temp', formula: 'TAG("vibration1", "temperature")', description: 'Pump housing temperature' },
      ],
      match: 'all',
      conditions: [
        { expr: 'vrms_alert', description: 'Vibration above the sensor limit' },
        { expr: 'temp > 50.0', description: 'Housing above 50 °C' },
      ],
      incident: { source: 'vibration1', severity: 'error', summary: 'Pump 1 vibrates while hot', firstStep: 'Stop pump 1 and check the bearing.' },
    }),
    rule({
      name: 'wetwell-highlevel',
      cooldown: '5m',
      edge: 'rising',
      variables: [{ name: 'level', formula: 'TAG("wetwell", "level")', description: 'Wet well level' }],
      conditions: [{ expr: 'level > 3.6', description: 'Wet well above 3.6 m' }],
      actions: [{ topic: 'pumps/start', payload: '{"pump":2}' }],
      incident: { source: 'wetwell', severity: 'critical', summary: 'Wet well high level', firstStep: 'Check that pump 2 started.' },
    }),
    rule({
      name: 'weekly-flow-total',
      variables: [{ name: 'flow', formula: 'TAG("flowmeter1", "total")', description: 'Flow meter totaliser' }],
      conditions: [{ expr: 'CHANGED(flow)', description: 'Totaliser updated' }],
      actions: [{ topic: 'reports/flow', payload: '=flow' }],
    }),
    rule({
      name: 'firmware-updated',
      variables: [{ name: 'version', formula: 'TAG("plc1", "FirmwareVersion")', description: 'PLC firmware version string' }],
      conditions: [{ expr: 'CHANGED(version)', description: 'PLC reports a new firmware version' }],
      actions: [{ topic: 'events/firmware', payload: '=version' }],
    }),
    rule({
      name: 'bulk1-milk-temp',
      cooldown: '10m',
      edge: 'rising',
      variables: [{ name: 'milk_temp', formula: 'TAG("bulk1", "milk_temperature")', description: 'Bulk tank 1 milk temperature' }],
      conditions: [{ expr: 'milk_temp > 4', description: 'Milk above 4 °C' }],
      incident: { source: 'bulk1', severity: 'warning', summary: 'Bulk tank 1 milk too warm', firstStep: 'Check the cooling compressor.' },
    }),
  ],
};

/** Live values for the result columns, as a host would supply them. */
const LIVE_VARIABLES: Record<string, string> = {
  alarm_active: 'true',
  temp: '48.2 °C',
  temp_rate: '2.1 °C/h',
  milk_temp: '3.4 °C',
  door_changed: 'true',
  status_word: '20',
  guard_open: 'true',
  in_manual: 'true',
  alarm_byte: '0',
  any_plc_alarm: 'false',
  vrms_alert: 'false',
  level: '2.9 m',
  flow: '18 402 m³',
  version: 'V4.2.1',
};
const LIVE_CONDITIONS: Record<number, string[]> = {
  0: ['true', 'false', 'false', 'false', 'false'],
  1: ['false', 'false'],
  2: ['false'],
  5: ['false'],
};

export function liveValues(ref: MonitorRef): string | undefined {
  if (ref.kind === 'variable') return LIVE_VARIABLES[ref.name];
  return LIVE_CONDITIONS[ref.rule]?.[ref.index];
}

/** The devices and tags a gateway would report, with live readings, for the TAG("…") menu. */
export const CATALOG: TagCatalog = {
  devices: [
    {
      description: 'Cell 3 PLC (tsend2mqtt)',
      tags: [
        { tag: 'AlarmActive', value: 'true', description: 'The PLC has set its own alarm bit' },
        { tag: 'StatusWord', value: '20', description: 'Status register, 16 bits' },
        { tag: 'AlarmFlags', value: '0', description: 'One bit per alarm' },
        { tag: 'FirmwareVersion', value: 'V4.2.1' },
      ],
    },
    {
      device: 'vibration1',
      description: 'Press motor vibration sensor',
      tags: [
        { tag: 'temperature', unit: '°C', value: '48.2' },
        { tag: 'alert_vrms_max', value: 'false' },
        { tag: 'alert_acc_peak', value: 'false' },
        { tag: 'v_rms', unit: 'mm/s', value: '1.8' },
      ],
    },
    {
      device: 'bulk1',
      description: 'Bulk milk tank 1',
      tags: [
        { tag: 'milk_temperature', unit: '°C', value: '3.4' },
        { tag: 'door_state', value: 'closed' },
        { tag: 'agitator_running', value: 'true', stale: true },
      ],
    },
    { device: 'wetwell', description: 'Wet well level sensor', tags: [{ tag: 'level', unit: 'm', value: '2.9' }] },
    { device: 'flowmeter1', tags: [{ tag: 'total', unit: 'm³', value: '18 402' }, { tag: 'rate', unit: 'l/min', value: '312' }] },
  ],
};

/** A v0.2 file: leaf conditions and nested logic. Opens as formula rows. */
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

/** The same intent written in the v0.3 form the editor saves. */
export const SAMPLE_XML_V03 = `<?xml version="1.0" encoding="UTF-8"?>
<rules>
  <rule name="overheat" cooldown="30s" edge="rising">
    <variables>
      <var name="temp" formula='TAG("vibration1", "temperature")' description="Spindle housing temperature"/>
      <var name="fan" formula='TAG("FanRunning")' description="Fan contactor feedback"/>
      <var name="coolant" formula='TAG("CoolantFlow")' description="Coolant flow, l/min"/>
    </variables>
    <and>
      <cond expr="temp &gt; 50.0" description="Housing above 50 °C"/>
      <cond expr="OR(NOT(fan), coolant &lt; 2.5)" description="Fan stopped or coolant flow low"/>
    </and>
    <actions>
      <publish topic="line1/camera/record" payload='{"duration":40}'/>
      <publish topic="line1/hmi/alert"/>
    </actions>
    <incident source="plc1" severity="critical" summary="Spindle overheating on line 1"
              first_step="Stop the spindle and check the fan."
              cause='=condition.description &amp; ". We read the housing sensor and the fan feedback; the cause sits on the machine."'/>
  </rule>
</rules>`;

/** Root element closed in the wrong place — parse() rejects it. */
export const MALFORMED_XML = `<rules><rule name="r"></rules>`;

/** Parses fine, but every rule breaks a validation constraint. */
export const INVALID_MODEL: RulesModel = {
  rules: [
    // Empty name, bad cooldown, no condition, no action and no incident.
    rule({ name: '', cooldown: '30 seconds' }),
    // Duplicate name, bad variable name, reserved name, a cycle, a formula that
    // does not parse, an unknown reference, a condition that is a number, an
    // empty topic, a title over 120 characters.
    rule({
      name: 'dup',
      variables: [
        { name: '1st', formula: 'TAG("a")' },
        { name: 'TAG', formula: '1' },
        { name: 'a', formula: 'b + 1' },
        { name: 'b', formula: 'a + 1' },
        { name: 'temp', formula: 'RATE(TAG("t"),' },
      ],
      conditions: [{ expr: 'temp > 50' }, { expr: 'nope > 1' }, { expr: 'a + 1' }],
      actions: [{ topic: '' }],
      incident: { source: 'plc1', severity: 'error', summary: 'x'.repeat(121), cause: '=condition.description &' },
    }),
    rule({ name: 'dup', conditions: [{ expr: '' }], actions: [{ topic: 't' }] }),
  ],
};

/** `count` near-identical rules — for the rail, the filter, and render cost. */
export function manyRules(count: number): RulesModel {
  return {
    rules: Array.from({ length: count }, (_, i) =>
      rule({
        name: `rule-${String(i + 1).padStart(3, '0')}`,
        cooldown: '10s',
        edge: i % 3 === 0 ? 'rising' : undefined,
        variables: [{ name: 'temp', formula: `TAG("sensor${i % 8}", "temperature")`, description: `Sensor ${i % 8} temperature` }],
        conditions: [{ expr: `temp > ${40 + i}`, description: `Sensor ${i % 8} above ${40 + i} °C` }],
        actions: [{ topic: `line1/sensor${i % 8}/hot` }],
        incident: i % 2 === 0 ? { source: `sensor${i % 8}`, severity: (['critical', 'error', 'warning', 'info'] as const)[i % 4], summary: `Sensor ${i % 8} hot` } : null,
      })
    ),
  };
}

/** A v0.2 file nested to the maximum depth. parse() folds it into one formula row. */
export const NESTED_V02_XML = `<rules>
  <rule name="deep">
    <and>
      <cond tag="a" op="eq" value="1"/>
      <or>
        <cond tag="b" op="neq" value="2"/>
        <and>
          <cond tag="c" op="geq" value="3"/>
          <cond tag="d" op="changed"/>
        </and>
      </or>
    </and>
    <actions>
      <publish topic="deep/hit"/>
    </actions>
  </rule>
</rules>`;

/** The signals of design 14a, one per tag the alarm-camera rule reads, keyed "device/tag". */
export const DESIGN_SIGNALS: Record<string, string> = {
  'plc1/AlarmActive': 'STEP(false, true, 180s)',
  'vibration1/temperature': 'RAMP(42, 56, 600s)',
  'bulk1/milk_temperature': 'SINE(3.2, 0.6, 240s)',
  'bulk1/door_state': 'PULSE("closed", "open", 150s, 30s)',
  'plc1/StatusWord': 'HOLD(20)',
  'plc1/AlarmFlags': 'HOLD(0)',
};
