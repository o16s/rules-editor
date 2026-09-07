import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseFormula } from './formula.js';
import type { Rule } from './model.js';
import {
  evaluateAt,
  formatSeconds,
  formatValue,
  parseGoDuration,
  parseSignal,
  ruleTags,
  signalAt,
  simulate,
  tagKey,
  type Env,
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

describe('evaluateAt', () => {
  const env: Env = {
    step: 1,
    tag: (ref, i) => (ref.tag === 'x' ? i * 2 : ref.tag === 'name' ? 'open' : null),
    variable: (name, i) => (name === 'v' ? i : name === 'flag' ? i > 2 : null),
    context: (name) => (name === 'condition.description' ? 'Housing hot' : null),
  };
  const ev = (text: string, i = 5) => evaluateAt(parseFormula(text), i, env);

  it('does arithmetic, comparison, text and logic', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('-v')).toBe(-5);
    expect(ev('v > 4')).toBe(true);
    expect(ev('v >= 6')).toBe(false);
    expect(ev('v = 5')).toBe(true);
    expect(ev('v <> 5')).toBe(false);
    expect(ev('TAG("name") = "open"')).toBe(true);
    expect(ev('TAG("name") != "open"')).toBe(false);
    expect(ev('AND(flag, v > 1)')).toBe(true);
    expect(ev('OR(NOT(flag), v > 10)')).toBe(false);
    expect(ev('condition.description & "."')).toBe('Housing hot.');
    expect(ev('"a" & 1')).toBe('a1');
    expect(ev('10 / 0')).toBeNull();
  });

  it('gives null for a missing value, and AND/OR short-circuit around it', () => {
    expect(ev('TAG("nope")')).toBeNull();
    expect(ev('TAG("nope") > 1')).toBeNull();
    expect(ev('AND(TAG("nope") > 1, false)')).toBe(false);
    expect(ev('AND(TAG("nope") > 1, true)')).toBeNull();
    expect(ev('OR(TAG("nope") > 1, true)')).toBe(true);
    expect(ev('unknown_var')).toBeNull();
  });

  it('does the bit and hex functions', () => {
    expect(ev('BITAND(20, 4)')).toBe(4);
    expect(ev('BITAND(20, 4) != 0')).toBe(true);
    expect(ev('BITOR(16, 4)')).toBe(20);
    expect(ev('BITXOR(20, 4)')).toBe(16);
    expect(ev('HEX2DEC("FF")')).toBe(255);
    expect(ev('BITAND(20, HEX2DEC("10")) != 0')).toBe(true);
    expect(ev('HEX2DEC("zz")')).toBeNull();
  });

  it('looks back for CHANGED, RATE, AVG and STALE', () => {
    // x = 2i, so it changes every sample and rises 2 per second = 7200 per hour
    expect(ev('CHANGED(TAG("x"))', 0)).toBe(false);
    expect(ev('CHANGED(TAG("x"))', 3)).toBe(true);
    expect(ev('CHANGED(TAG("name"))', 3)).toBe(false);
    expect(ev('RATE(TAG("x"), 2s)', 5)).toBe(7200);
    expect(ev('RATE(TAG("x"), 2s)', 1)).toBeNull(); // not enough history
    expect(ev('AVG(TAG("x"), 2s)', 5)).toBe(8); // mean of 6, 8, 10
    expect(ev('STALE(TAG("name"), 3s)', 5)).toBe(true);
    expect(ev('STALE(TAG("x"), 3s)', 5)).toBe(false);
    expect(ev('STALE(TAG("name"), 3s)', 2)).toBe(false); // not enough history yet
  });
});

describe('simulate', () => {
  it('lists the tags a rule reads once each, variables first', () => {
    expect(ruleTags(rule()).map(tagKey)).toEqual(['plc1/AlarmActive', 'vibration1/temperature', 'bulk1/door_state', 'plc1/StatusWord']);
  });

  it('runs variables and conditions over the clock and fires on the rising edge with a cooldown', () => {
    const sim = simulate(rule(), { stop: 600, step: 1, signals: SIGNALS });
    expect(sim.times).toHaveLength(601);
    const at = (name: string, t: number) => sim.variables.find((v) => v.name === name)!.values[t];
    expect(at('alarm_active', 179)).toBe(false);
    expect(at('alarm_active', 180)).toBe(true);
    expect(at('temp', 300)).toBe(49);
    expect(at('door_changed', 150)).toBe(true);
    expect(at('door_changed', 151)).toBe(false);
    expect(at('guard_open', 0)).toBe(true);
    // RATE(temp, 30min) needs 1800 s of history: null for the whole 600 s run
    expect(at('temp_rate', 600)).toBeNull();
    expect(sim.conditions[0].values[250]).toBe(true);
    expect(sim.conditions[1].values[250]).toBe(false);
    expect(sim.conditions[1].values[400]).toBe(true); // 42 + 14 * 400/600 = 51.3
    // AND(temp_rate > 4, door_changed): the rate is null, so the row is null while the door moves and false otherwise
    expect(sim.conditions[2].values[150]).toBeNull();
    expect(sim.conditions[2].values[250]).toBe(false);
    expect(sim.result[100]).toBe(false);
    expect(sim.result[250]).toBe(true);
    // one fire at 180 s; the rising edge does not fire again while true
    expect(sim.fires).toEqual([180]);
    const fired = sim.log.find((e) => e.fired)!;
    expect(fired.t).toBe(180);
    // the change line above already names condition 1, so the fire line does not repeat it
    expect(fired.text).toBe('Fired. Publish to camera/record {"duration":40} · Raise critical incident “Press guard alarm on cell 3”');
    expect(sim.log.map((e) => e.text)).toContain('Cooldown: the rule cannot fire again before 225 s.');
    expect(sim.log.map((e) => e.text)).toContain('Condition 1 became true.');
    expect(sim.log.map((e) => e.text)).toContain('Condition 2 became true.');
  });

  it('fires every sample while true without an edge, honouring the cooldown', () => {
    const sim = simulate(rule({ edge: undefined, cooldown: '100s', conditions: [{ expr: 'alarm_active' }] }), { stop: 600, step: 1, signals: SIGNALS });
    expect(sim.fires).toEqual([180, 280, 380, 480, 580]);
    const none = simulate(rule({ edge: undefined, cooldown: undefined, conditions: [{ expr: 'alarm_active' }] }), { stop: 600, step: 10, signals: SIGNALS });
    expect(none.fires).toHaveLength(43); // 180, 190, … 600
  });

  it('evaluates Then formulas with the firing condition\'s description', () => {
    const r = rule({ actions: [{ topic: 'alarm/text', payload: '=condition.description & "!"' }], incident: null });
    const sim = simulate(r, { stop: 200, step: 1, signals: SIGNALS });
    expect(sim.log.find((e) => e.fired)!.text).toContain('Publish to alarm/text Cell 3 PLC raised its own alarm!');
  });

  it('reports a signal that does not parse and reads null for it', () => {
    const sim = simulate(rule(), { stop: 10, step: 1, signals: { ...SIGNALS, 'plc1/StatusWord': 'RAMP(1)' } });
    const status = sim.tags.find((t) => t.key === 'plc1/StatusWord')!;
    expect(status.error).toMatch(/takes 3 arguments/);
    expect(status.values[0]).toBeNull();
    expect(sim.variables.find((v) => v.name === 'guard_open')!.values[0]).toBeNull();
    // a tag with no signal at all reads null too, without an error
    const bare = simulate(rule(), { stop: 10, step: 1, signals: {} });
    expect(bare.tags[0].error).toBeUndefined();
    expect(bare.result[5]).toBeNull();
  });

  it('matches all when asked, and does not throw on a formula that does not parse', () => {
    const all = simulate(rule({ match: 'all', conditions: [{ expr: 'alarm_active' }, { expr: 'temp > 40' }] }), { stop: 300, step: 1, signals: SIGNALS });
    expect(all.result[100]).toBe(false);
    expect(all.result[200]).toBe(true);
    const broken = simulate(rule({ conditions: [{ expr: 'temp >' }], variables: [{ name: 'temp', formula: 'TAG(' }] }), { stop: 10, step: 1, signals: SIGNALS });
    expect(broken.conditions[0].values[0]).toBeNull();
    expect(broken.fires).toEqual([]);
  });

  it('caps the log', () => {
    const sim = simulate(rule({ edge: undefined, cooldown: undefined, conditions: [{ expr: 'true' }] }), { stop: 600, step: 1, signals: SIGNALS });
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
// rules-engine/formula/eval_cases_test.go in Go. The simulator shows an
// operator what a rule will do, and the gateway then does it, so the two
// implementations must answer every case the same way.

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
  it('holds the cases both implementations answer', () => {
    expect(EVAL_CASES.length).toBeGreaterThan(30);
  });

  for (const c of EVAL_CASES) {
    it(c.name, () => {
      // The value of every tag at every step, so a time function can look back.
      const history: Record<string, Value>[] = [];
      for (const step of c.steps) {
        const last = history.length ? history[history.length - 1] : {};
        history.push({ ...last, ...step.values });
      }
      const env: Env = {
        step: c.step_seconds ?? 1,
        tag: (ref, i) => {
          const at = history[Math.max(0, Math.min(i, history.length - 1))];
          return ref.device ? null : (at[ref.tag] ?? null);
        },
        variable: () => null,
      };
      const ast = parseFormula(c.formula);
      c.steps.forEach((step, i) => {
        expect(evaluateAt(ast, i, env), `step ${i + 1}`).toEqual(step.want);
      });
    });
  }
});
