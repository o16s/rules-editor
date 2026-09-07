import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { Rule } from './model.js';
import { runEngine } from './engine.js';
import {
  formatSeconds,
  formatValue,
  parseGoDuration,
  parseSignal,
  ruleTags,
  signalAt,
  simulate,
  tagKey,
} from './simulate.js';

const rule = (r: Partial<Rule> = {}): Rule => ({
  name: 'alarm-camera',
  cooldown: '45s',
  edge: 'rising',
  variables: [
    { name: 'alarm_active', formula: 'TAG("plc1", "AlarmActive")' },
    { name: 'temp', formula: 'TAG("vibration1", "temperature")' },
    { name: 'temp_rate', formula: 'RATE(temp, 30min)' },
    { name: 'door_changed', formula: 'CHANGED(TAG("bulk1", "door_state"))' },
    { name: 'status_word', formula: 'TAG("plc1", "StatusWord")' },
    { name: 'guard_open', formula: 'BITAND(status_word, 4) != 0' },
  ],
  match: 'any',
  conditions: [
    { expr: 'alarm_active', description: 'Cell 3 PLC raised its own alarm' },
    { expr: 'temp > 50', description: 'Housing above 50 °C' },
    { expr: 'AND(temp_rate > 4, door_changed)' },
  ],
  actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
  incident: { source: 'Cell 3 press', severity: 'critical', summary: 'Press guard alarm on cell 3', cause: '=condition.description & "."' },
  ...r,
});

const SIGNALS = {
  'plc1/AlarmActive': 'STEP(false, true, 180s)',
  'vibration1/temperature': 'RAMP(42, 56, 600s)',
  'bulk1/door_state': 'PULSE("closed", "open", 150s, 30s)',
  'plc1/StatusWord': 'HOLD(20)',
};

describe('signals', () => {
  const at = (text: string, t: number) => signalAt(parseSignal(text), t);
  it('generates HOLD, STEP, RAMP, PULSE and SINE', () => {
    expect(at('HOLD(20)', 0)).toBe(20);
    expect(at('HOLD("closed")', 500)).toBe('closed');
    expect(at('STEP(false, true, 180s)', 179)).toBe(false);
    expect(at('STEP(false, true, 180s)', 180)).toBe(true);
    expect(at('STEP(1, 2, 60)', 61)).toBe(2);
    expect(at('RAMP(42, 56, 600s)', 0)).toBe(42);
    expect(at('RAMP(42, 56, 600s)', 300)).toBe(49);
    expect(at('RAMP(42, 56, 600s)', 900)).toBe(56);
    expect(at('PULSE("closed", "open", 150s, 30s)', 100)).toBe('closed');
    expect(at('PULSE("closed", "open", 150s, 30s)', 150)).toBe('open');
    expect(at('PULSE("closed", "open", 150s, 30s)', 179)).toBe('open');
    expect(at('PULSE("closed", "open", 150s, 30s)', 180)).toBe('closed');
    expect(at('PULSE("closed", "open", 150s, 30s)', 300)).toBe('open');
    expect(at('SINE(3.2, 0.6, 240s)', 0)).toBeCloseTo(3.2);
    expect(at('SINE(3.2, 0.6, 240s)', 60)).toBeCloseTo(3.8);
    expect(at('SINE(3.2, 0.6, 240s)', 180)).toBeCloseTo(2.6);
  });

  it('reads a bare value as HOLD and rejects other formulas', () => {
    expect(at('20', 10)).toBe(20);
    expect(at('"open"', 10)).toBe('open');
    expect(at('-5', 10)).toBe(-5);
    expect(() => parseSignal('TAG("a")')).toThrow(/not a signal/);
    expect(() => parseSignal('STEP(1, 2)')).toThrow('STEP takes 3 arguments: STEP(before, after, at).');
    expect(() => parseSignal('RAMP("a", 2, 10s)')).toThrow('RAMP: from is a number of seconds, or a duration such as 180s.');
    expect(() => parseSignal('STEP(a, b, 10s)')).toThrow('STEP: every argument is a fixed value. A signal cannot read a tag or a variable.');
    expect(() => parseSignal('WOBBLE(1)')).toThrow('"WOBBLE" is not a signal. Use HOLD, STEP, RAMP, PULSE or SINE.');
    expect(() => parseSignal('temp >')).toThrow();
  });
});

describe('parseGoDuration', () => {
  it('reads the cooldown forms', () => {
    expect(parseGoDuration('45s')).toBe(45);
    expect(parseGoDuration('1m30s')).toBe(90);
    expect(parseGoDuration('500ms')).toBe(0.5);
    expect(parseGoDuration('2h')).toBe(7200);
    expect(parseGoDuration('0')).toBe(0);
    expect(parseGoDuration('30 seconds')).toBeNull();
    expect(parseGoDuration('')).toBeNull();
  });
});

describe('simulate', () => {
  it('lists the tags a rule reads once each, variables first', () => {
    expect(ruleTags(rule()).map(tagKey)).toEqual(['plc1/AlarmActive', 'vibration1/temperature', 'bulk1/door_state', 'plc1/StatusWord']);
  });

  it('runs variables and conditions over the clock and fires on the rising edge with a cooldown', async () => {
    const sim = await simulate(rule(), { stop: 600, step: 1, signals: SIGNALS });
    expect(sim.times).toHaveLength(601);
    const at = (name: string, t: number) => sim.variables.find((v) => v.name === name)!.values[t];
    expect(at('alarm_active', 179)).toBe(false);
    expect(at('alarm_active', 180)).toBe(true);
    expect(at('temp', 300)).toBe(49);
    expect(at('door_changed', 150)).toBe(true);
    expect(at('door_changed', 151)).toBe(false);
    expect(at('guard_open', 0)).toBe(true);
    // RATE measures the span it holds, so it answers as soon as two buckets
    // carry a reading. The ramp climbs 14 over 600 s, which is 84 an hour.
    // The span is measured between bucket starts, so it reads one bucket
    // short: a thirty minute window has 28 s buckets, and 14/(572/3600) is
    // about 88. Anything near 84 is the ramp; the old answer was nothing.
    expect(at('temp_rate', 600) as number).toBeGreaterThan(80);
    expect(at('temp_rate', 600) as number).toBeLessThan(92);
    expect(sim.conditions[0].values[250]).toBe(true);
    expect(sim.conditions[1].values[250]).toBe(false);
    expect(sim.conditions[1].values[400]).toBe(true); // 42 + 14 * 400/600 = 51.3
    // AND(temp_rate > 4, door_changed) is true while the door moves, because
    // the ramp climbs faster than 4 an hour.
    expect(sim.conditions[2].values[150]).toBe(true);
    expect(sim.conditions[2].values[250]).toBe(false);
    expect(sim.result[100]).toBe(false);
    expect(sim.result[250]).toBe(true);
    // The run opens with the startup resolve of the incident the engine
    // assumes open. The door pulse then fires the rule at 150 s, and the
    // alarm rising at 180 s falls inside the 45 s cooldown, which consumes it.
    expect(sim.fires).toEqual([0, 150]);
    const fired = sim.log.filter((e) => e.fired)[1];
    expect(fired.t).toBe(150);
    expect(sim.log.map((e) => e.text)).toContain('Cooldown: the rule cannot fire again before 195 s.');
    expect(sim.log.map((e) => e.text)).toContain('Condition 1 became true.');
    expect(sim.log.map((e) => e.text)).toContain('Condition 2 became true.');
  });

  it('fires every sample while true without an edge, honouring the cooldown', async () => {
    const sim = await simulate(rule({ edge: undefined, cooldown: '100s', conditions: [{ expr: 'alarm_active' }] }), { stop: 600, step: 1, signals: SIGNALS });
    // The engine assumes every incident is open when it starts and lets the
    // first evaluation decide, so the run opens with a resolve at 0 s. After
    // that the rule fires every 100 s while the alarm stands.
    expect(sim.fires).toEqual([0, 180, 280, 380, 480, 580]);
    const none = await simulate(rule({ edge: undefined, cooldown: undefined, conditions: [{ expr: 'alarm_active' }] }), { stop: 600, step: 10, signals: SIGNALS });
    expect(none.fires).toHaveLength(44); // the startup resolve, then 180, 190, … 600
  });

  it('evaluates Then formulas with the firing condition\'s description', async () => {
    // The row that fires is the one whose description the Then field reads.
    const r = rule({
      conditions: [{ expr: 'alarm_active', description: 'Cell 3 PLC raised its own alarm' }],
      actions: [{ topic: 'alarm/text', payload: '=condition.description & "!"' }],
      incident: null,
    });
    const sim = await simulate(r, { stop: 200, step: 1, signals: SIGNALS });
    const fired = sim.log.filter((e) => e.fired);
    expect(fired).toHaveLength(1);
    expect(fired[0].t).toBe(180);
    expect(fired[0].text).toContain('Publish to alarm/text Cell 3 PLC raised its own alarm!');
  });

  it('reports a signal that does not parse and reads null for it', async () => {
    const sim = await simulate(rule(), { stop: 10, step: 1, signals: { ...SIGNALS, 'plc1/StatusWord': 'RAMP(1)' } });
    const status = sim.tags.find((t) => t.key === 'plc1/StatusWord')!;
    expect(status.error).toMatch(/takes 3 arguments/);
    expect(status.values[0]).toBeNull();
    expect(sim.variables.find((v) => v.name === 'guard_open')!.values[0]).toBeNull();
    // a tag with no signal at all reads null too, without an error
    const bare = await simulate(rule(), { stop: 10, step: 1, signals: {} });
    expect(bare.tags[0].error).toBeUndefined();
    expect(bare.result[5]).toBeNull();
  });

  it('matches all when asked, and does not throw on a formula that does not parse', async () => {
    const all = await simulate(rule({ match: 'all', conditions: [{ expr: 'alarm_active' }, { expr: 'temp > 40' }] }), { stop: 300, step: 1, signals: SIGNALS });
    expect(all.result[100]).toBe(false);
    expect(all.result[200]).toBe(true);
    const broken = await simulate(rule({ conditions: [{ expr: 'temp >' }], variables: [{ name: 'temp', formula: 'TAG(' }] }), { stop: 10, step: 1, signals: SIGNALS });
    expect(broken.conditions[0].values[0]).toBeNull();
    expect(broken.fires).toEqual([]);
  });

  it('caps the log', async () => {
    const sim = await simulate(rule({ edge: undefined, cooldown: undefined, conditions: [{ expr: 'true' }] }), { stop: 600, step: 1, signals: SIGNALS });
    expect(sim.log).toHaveLength(201);
    expect(sim.log[200].text).toBe('401 more events are not shown.');
  });
});

describe('formatting', () => {
  it('formats values and seconds for the page', () => {
    expect(formatValue(47.83, '°C')).toBe('47.8 °C');
    expect(formatValue(20)).toBe('20');
    expect(formatValue(3.0, '°C')).toBe('3 °C');
    expect(formatValue(123.4)).toBe('123');
    expect(formatValue(true)).toBe('true');
    expect(formatValue('closed')).toBe('closed');
    expect(formatValue(null)).toBe('—');
    expect(formatSeconds(180)).toBe('180 s');
    expect(formatSeconds(2.5)).toBe('2.5 s');
  });
});

// ---- parity with the gateway ----------------------------------------------
//
// schema/eval-cases.json is read by this suite and by
// rules-engine/formula/eval_cases_test.go in Go. The editor no longer has an
// evaluator of its own: it runs the engine. The cases stay, because they are
// the written answer both the engine and its Go suite must give, and running
// them here proves the module in the page is the module the Go suite tested.

interface EvalStep {
  values: Record<string, number | string | boolean | null>;
  want: number | string | boolean | null;
}

interface EvalCase {
  name: string;
  formula: string;
  types: Record<string, string>;
  step_seconds?: number;
  steps: EvalStep[];
}

const EVAL_CASES = JSON.parse(
  readFileSync(resolve(fileURLToPath(import.meta.url), '..', '..', 'schema', 'eval-cases.json'), 'utf8')
) as EvalCase[];

describe('schema/eval-cases.json', () => {
  it('holds the cases both implementations answer', async () => {
    expect(EVAL_CASES.length).toBeGreaterThan(30);
  });

  for (const c of EVAL_CASES) {
    it(c.name, async () => {
      const tags = Object.keys(c.types);
      const stepSeconds = c.step_seconds ?? 1;
      // A tag keeps its last reading until the case gives a new one, the way a
      // slot does between two polls.
      const last: Record<string, number | string | boolean | null> = {};
      const steps = c.steps.map((step, i) => {
        Object.assign(last, step.values);
        return {
          tMs: Math.round(i * stepSeconds * 1000),
          values: tags.map((t) => last[t] ?? null),
        };
      });

      const out = await runEngine({
        periodMs: Math.round(stepSeconds * 1000),
        fields: tags.map((t) => ({ device: '', tag: t, type: c.types[t] })),
        steps,
        // A case is any expression, not only a condition, so it goes in as a
        // variable: a condition row has to answer true or false.
        variables: [{ name: c.formula, text: c.formula }],
        rows: [],
        sources: [],
        match: 'all',
        ruleXml: '',
      });
      expect(out.error, 'the engine must run the case').toBeUndefined();
      expect(out.variables[0].problem, 'the formula must compile').toBeFalsy();
      c.steps.forEach((step, i) => {
        expect(out.variables[0].values[i], `step ${i + 1}`).toEqual(step.want);
      });
    });
  }
});
