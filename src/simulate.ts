// The simulator core: signal generators for the tags, and the run that turns
// a rule and its signals into the lines the page draws.
//
// The rule itself is evaluated by the gateway's own engine, loaded into the
// page from dist/rules-engine.wasm. Nothing here decides what a formula means
// or when a rule fires, so the Simulator page cannot disagree with the plant.
// What stays here is the signal generators, which exist only to make test
// data, and the wording of the log.

import { formulaRefs, parseFormula, type Ast, type TagRef } from './formula.js';
import { runEngine, type EngineFormula, type EngineResult } from './engine.js';
import type { Rule } from './model.js';
import { serialize } from './serialize.js';

/** A value on the wire: what a tag reads, or what a formula gives. Null is "no value". */
export type Value = number | string | boolean | null;

// ---- signal generators -----------------------------------------------------

export interface SignalSpec {
  name: string;
  minArgs: number;
  maxArgs: number;
  signature: string;
  doc: string;
}

/**
 * The formulas a tag row accepts. Times are durations of the formula
 * language (180s, 2min, 1h) or plain seconds.
 */
export const SIGNALS: readonly SignalSpec[] = [
  { name: 'HOLD', minArgs: 1, maxArgs: 1, signature: 'HOLD(value)', doc: 'The same value for the whole run.' },
  { name: 'STEP', minArgs: 3, maxArgs: 3, signature: 'STEP(before, after, at)', doc: 'The first value, then the second one from the given time.' },
  { name: 'RAMP', minArgs: 3, maxArgs: 3, signature: 'RAMP(from, to, over)', doc: 'A straight line from the first number to the second one. It is flat after that.' },
  { name: 'PULSE', minArgs: 4, maxArgs: 4, signature: 'PULSE(low, high, period, width)', doc: 'The low value, and the high value for the width at every period. The first pulse is at one period.' },
  { name: 'SINE', minArgs: 3, maxArgs: 3, signature: 'SINE(mean, amplitude, period)', doc: 'A sine wave around the mean.' },
];

const SIGNAL_BY_NAME = new Map(SIGNALS.map((s) => [s.name, s]));

/** Every value a rule formula can take as a literal; a duration folds to seconds. */
function literal(ast: Ast): Value {
  switch (ast.kind) {
    case 'number': return ast.value;
    case 'string': return ast.value;
    case 'bool': return ast.value;
    case 'duration': return ast.seconds;
    case 'unary': { const v = literal(ast.arg); return typeof v === 'number' ? -v : null; }
    default: return null;
  }
}

/** A signal formula, parsed and checked. Throws an Error with a message for the row. */
export function parseSignal(text: string): Ast {
  const ast = parseFormula(text);
  if (ast.kind !== 'call') {
    // A bare literal is a HOLD.
    if (literal(ast) === null) throw new Error('A signal is HOLD, STEP, RAMP, PULSE or SINE, or a single value such as 20.');
    return { kind: 'call', name: 'HOLD', args: [ast] };
  }
  const spec = SIGNAL_BY_NAME.get(ast.name);
  if (!spec) {
    const names = SIGNALS.map((s) => s.name);
    throw new Error(`"${ast.name}" is not a signal. Use ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}.`);
  }
  if (ast.args.length < spec.minArgs || ast.args.length > spec.maxArgs) throw new Error(`${spec.name} takes ${spec.minArgs} argument${spec.minArgs === 1 ? '' : 's'}: ${spec.signature}.`);
  for (const a of ast.args) if (literal(a) === null) throw new Error(`${spec.name}: every argument is a fixed value. A signal cannot read a tag or a variable.`);
  const num = (i: number, what: string): void => { if (typeof literal(ast.args[i]) !== 'number') throw new Error(`${spec.name}: ${what} is a number of seconds, or a duration such as 180s.`); };
  if (ast.name === 'STEP') num(2, 'the time');
  if (ast.name === 'RAMP') { num(0, 'from'); num(1, 'to'); num(2, 'the duration'); }
  if (ast.name === 'PULSE') { num(2, 'the period'); num(3, 'the width'); }
  if (ast.name === 'SINE') { num(0, 'the mean'); num(1, 'the amplitude'); num(2, 'the period'); }
  return ast;
}

/** The value of a parsed signal at time `t` (seconds). */
export function signalAt(signal: Ast, t: number): Value {
  if (signal.kind !== 'call') return literal(signal);
  const a = signal.args.map(literal);
  switch (signal.name) {
    case 'HOLD': return a[0];
    case 'STEP': return t < (a[2] as number) ? a[0] : a[1];
    case 'RAMP': {
      const from = a[0] as number, to = a[1] as number, over = a[2] as number;
      const k = over <= 0 ? 1 : Math.min(Math.max(t / over, 0), 1);
      return from + (to - from) * k;
    }
    case 'PULSE': {
      const period = a[2] as number, width = a[3] as number;
      if (period <= 0 || t < period) return a[0];
      return (t - period) % period < width ? a[1] : a[0];
    }
    case 'SINE': {
      const mean = a[0] as number, amp = a[1] as number, period = a[2] as number;
      if (period <= 0) return mean;
      return mean + amp * Math.sin((2 * Math.PI * t) / period);
    }
    default: return null;
  }
}

// ---- durations -----------------------------------------------------------

const GO_UNITS: Record<string, number> = { ns: 1e-9, us: 1e-6, 'µs': 1e-6, 'μs': 1e-6, ms: 1e-3, s: 1, m: 60, h: 3600 };

/** Seconds in a Go duration ("45s", "1m30s", "500ms"); null when it is not one. */
export function parseGoDuration(text: string): number | null {
  if (text === '0') return 0;
  const re = /([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(ns|us|µs|μs|ms|s|m|h)/g;
  let total = 0;
  let matched = '';
  for (const m of text.matchAll(re)) { total += Number(m[1]) * GO_UNITS[m[2]]; matched += m[0]; }
  return matched === text && matched !== '' ? total : null;
}

// ---- values ----------------------------------------------------------------

/** The key a tag is stored under: "device/tag", or "tag" without a device. */
export const tagKey = (ref: TagRef): string => (ref.device ? `${ref.device}/${ref.tag}` : ref.tag);

/** The JSON Schema name of a reading, so the engine binds the field's type. */
function typeOf(values: Value[]): string {
  for (const v of values) {
    if (v === null) continue;
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    return 'string';
  }
  return '';
}

export interface SimulationOptions {
  /** Length of the run in seconds. */
  stop: number;
  /** Seconds between samples. */
  step: number;
  /** Signal formula per tag key; a tag without one reads null. */
  signals: Record<string, string>;
}

export interface TagSeries { key: string; ref: TagRef; values: Value[]; /** Why the signal did not parse. */ error?: string }
export interface NamedSeries { name: string; values: Value[] }
export interface LogEntry { t: number; text: string; fired?: boolean }

export interface Simulation {
  /** Sample times, `step` apart, from 0 to `stop`. */
  times: number[];
  tags: TagSeries[];
  variables: NamedSeries[];
  /** One per condition, in rule order. */
  conditions: NamedSeries[];
  /** The rule's combined result per sample. */
  result: Array<boolean | null>;
  /** Sample times at which the rule fired. */
  fires: number[];
  log: LogEntry[];
}

/** Every tag the rule reads, in first-seen order: variables first, then conditions. */
export function ruleTags(rule: Rule): TagRef[] {
  const seen = new Map<string, TagRef>();
  const collect = (text: string): void => {
    try { for (const ref of formulaRefs(parseFormula(text)).tags) if (!seen.has(tagKey(ref))) seen.set(tagKey(ref), ref); } catch { /* not a formula yet */ }
  };
  for (const v of rule.variables) collect(v.formula);
  for (const c of rule.conditions) collect(c.expr);
  return [...seen.values()];
}

/**
 * An empty run: the shape of a Simulation with nothing in it. The page draws
 * this while the engine loads, so the layout does not jump when it arrives.
 */
export function emptySimulation(rule: Rule): Simulation {
  return {
    times: [0],
    tags: ruleTags(rule).map((ref) => ({ key: tagKey(ref), ref, values: [null] })),
    variables: rule.variables.map((v) => ({ name: v.name, values: [null] })),
    conditions: rule.conditions.map((c) => ({ name: c.expr, values: [null] })),
    result: [null],
    fires: [],
    log: [],
  };
}

/** Wrap one rule in a document, so the engine loads it the way a gateway does. */
function ruleDocument(rule: Rule): string {
  try {
    return serialize({ rules: [rule] });
  } catch {
    return '';
  }
}

/**
 * Run the rule against the signals.
 *
 * It never throws: a formula that does not compile keeps its place in the
 * timeline and carries its problem, so the page draws the rest while an
 * operator is still typing.
 */
export async function simulate(rule: Rule, opts: SimulationOptions): Promise<Simulation> {
  const step = opts.step > 0 ? opts.step : 1;
  const count = Math.max(1, Math.floor(opts.stop / step) + 1);
  const times = Array.from({ length: count }, (_, i) => i * step);

  // Tags: one series each, from its signal. This is the only thing the page
  // makes up; everything after it is the engine's answer.
  const tags: TagSeries[] = ruleTags(rule).map((ref) => {
    const key = tagKey(ref);
    const text = opts.signals[key];
    let signal: Ast | null = null;
    let error: string | undefined;
    if (text && text.trim()) {
      try { signal = parseSignal(text); } catch (e) { error = (e as Error).message; }
    }
    const values = times.map((t) => (signal ? signalAt(signal, t) : null));
    return error ? { key, ref, values, error } : { key, ref, values };
  });

  const variables: EngineFormula[] = rule.variables.map((v) => ({ name: v.name, text: v.formula }));
  const rows: EngineFormula[] = rule.conditions.map((c) => ({ name: c.expr, text: c.expr }));

  let out: EngineResult;
  try {
    out = await runEngine({
      periodMs: Math.round(step * 1000),
      fields: tags.map((t) => ({ device: t.ref.device ?? '', tag: t.ref.tag, type: typeOf(t.values) })),
      steps: times.map((t, i) => ({ tMs: Math.round(t * 1000), values: tags.map((s) => s.values[i]) })),
      variables,
      rows,
      sources: rule.incident?.source ? [rule.incident.source] : [],
      match: rule.match === 'any' ? 'any' : 'all',
      ruleXml: ruleDocument(rule),
    });
  } catch (e) {
    const blank = times.map(() => null);
    return {
      times,
      tags,
      variables: rule.variables.map((v) => ({ name: v.name, values: [...blank] })),
      conditions: rule.conditions.map((c) => ({ name: c.expr, values: [...blank] })),
      result: [...blank],
      fires: [],
      log: [{ t: 0, text: `The rule engine did not load: ${(e as Error).message}` }],
    };
  }

  const named = (s: EngineResult['variables'][number]): NamedSeries => ({ name: s.name, values: s.values });
  const conditions = out.rows.map(named);
  const result = out.result;
  const fires = out.firings.map((f) => times[f.index] ?? 0);

  return {
    times,
    tags,
    variables: out.variables.map(named),
    conditions,
    result,
    fires,
    log: writeLog(rule, times, conditions, out, step),
  };
}

/**
 * The log an operator reads: which condition moved, what the rule published,
 * and when the cooldown lets it fire again. The words are the page's; every
 * fact in them comes from the engine.
 */
function writeLog(
  rule: Rule,
  times: number[],
  conditions: NamedSeries[],
  out: EngineResult,
  step: number,
): LogEntry[] {
  const log: LogEntry[] = [];
  const LOG_MAX = 200;
  let hidden = 0;
  const say = (entry: LogEntry): void => { if (log.length < LOG_MAX) log.push(entry); else hidden++; };

  for (const p of out.problems) {
    say({ t: 0, text: p.message });
  }
  if (out.error) say({ t: 0, text: out.error });
  for (const line of [...out.variables, ...out.rows]) {
    if (line.problem) say({ t: 0, text: `${line.name}: ${line.problem}` });
  }

  const firingAt = new Map(out.firings.map((f) => [f.index, f]));
  const cooldown = rule.cooldown ? parseGoDuration(rule.cooldown) ?? 0 : 0;

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const announced = new Set<number>();
    if (i > 0) {
      conditions.forEach((c, k) => {
        const now = c.values[i], before = c.values[i - 1];
        if (now === before || now === null) return;
        say({ t, text: `Condition ${k + 1} became ${now}.` });
        announced.add(k);
      });
    }
    const fired = firingAt.get(i);
    if (!fired) continue;

    const actions = [
      ...(fired.actions ?? []).map((a) => `Publish to ${a.topic}${a.payload ? ` ${a.payload}` : ''}`),
      ...(fired.incidents ?? []).map((inc) => (inc.action === 'resolve'
        ? `Resolve incident ${inc.dedupKey}`
        : `Raise ${inc.severity} incident \u201c${inc.summary}\u201d`)),
    ];
    const firing = conditions.findIndex((c) => c.values[i] === true);
    const why = firing >= 0 && !announced.has(firing) ? `Condition ${firing + 1} is true.` : '';
    say({ t, text: ['Fired.', why, actions.join(' \u00b7 ')].filter(Boolean).join(' '), fired: true });
    if (cooldown > 0) {
      say({ t, text: `Cooldown: the rule cannot fire again before ${formatSeconds(t + cooldown)}.` });
    }
  }
  if (hidden) log.push({ t: times[times.length - 1] ?? 0, text: `${hidden} more events are not shown.` });
  void step;
  return log;
}

/** Seconds for display: "180 s"; fractions keep one decimal. */
export function formatSeconds(t: number): string {
  return `${Number.isInteger(t) ? t : Number(t.toFixed(1))} s`;
}

/** A value for display, with an optional unit; null is a dash. */
export function formatValue(v: Value, unit?: string): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    const text = Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '');
    return unit ? `${text} ${unit}` : text;
  }
  return v;
}
