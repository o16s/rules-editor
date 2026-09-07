// The simulator core: signal generators for tags, a formula evaluator that
// runs the rule's variables and conditions over a clock, and the rule's
// firing with its edge and cooldown. Pure functions; the page in
// gui/simulator.ts draws the result. Nothing here reaches a gateway.

import { formulaRefs, parseFormula, type Ast, type TagRef } from './formula.js';
import type { Rule } from './model.js';

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

// ---- evaluation ------------------------------------------------------------

/** What a formula reads while it runs. Indices are sample steps, `step` seconds apart. */
export interface Env {
  step: number;
  tag(ref: TagRef, i: number): Value;
  variable(name: string, i: number): Value;
  context?(name: string): Value;
}

/** The key a tag is stored under: "device/tag", or "tag" without a device. */
export const tagKey = (ref: TagRef): string => (ref.device ? `${ref.device}/${ref.tag}` : ref.tag);

const asBool = (v: Value): boolean | null => (typeof v === 'boolean' ? v : null);
const asNum = (v: Value): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const equal = (a: Value, b: Value): boolean => (typeof a === 'number' && typeof b === 'number' ? a === b : String(a) === String(b));

/** Evaluate `ast` at sample `i`. Time functions look back through `env` at earlier samples. */
export function evaluateAt(ast: Ast, i: number, env: Env): Value {
  switch (ast.kind) {
    case 'number': case 'string': case 'bool': return ast.value;
    case 'duration': return ast.seconds;
    case 'ref': return env.variable(ast.name, i);
    case 'context': return env.context?.(ast.name) ?? null;
    case 'unary': { const v = asNum(evaluateAt(ast.arg, i, env)); return v === null ? null : -v; }
    case 'binary': {
      const l = evaluateAt(ast.left, i, env);
      const r = evaluateAt(ast.right, i, env);
      if (l === null || r === null) return null;
      switch (ast.op) {
        case '&': return `${l}${r}`;
        case '=': return equal(l, r);
        case '!=': return !equal(l, r);
        default: {
          const a = asNum(l), b = asNum(r);
          if (a === null || b === null) return null;
          switch (ast.op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return b === 0 ? null : a / b;
            case '<': return a < b;
            case '<=': return a <= b;
            case '>': return a > b;
            case '>=': return a >= b;
          }
          return null;
        }
      }
    }
    case 'call': return call(ast, i, env);
  }
}

function call(ast: Ast & { kind: 'call' }, i: number, env: Env): Value {
  const args = ast.args;
  const at = (n: number, j: number = i): Value => (args[n] ? evaluateAt(args[n], j, env) : null);
  /** Samples back for a duration argument (at least one). */
  const back = (n: number): number | null => {
    const w = asNum(at(n));
    return w === null || w <= 0 ? null : Math.max(1, Math.round(w / env.step));
  };
  switch (ast.name) {
    case 'TAG': {
      const dev = args.length === 2 ? args[0] : null;
      const tag = args[args.length - 1];
      if (!tag || tag.kind !== 'string' || (dev && dev.kind !== 'string')) return null;
      return env.tag({ device: dev && dev.kind === 'string' ? dev.value : undefined, tag: tag.value }, i);
    }
    case 'AND': {
      let out: boolean | null = true;
      for (let n = 0; n < args.length; n++) { const b = asBool(at(n)); if (b === false) return false; if (b === null) out = null; }
      return out;
    }
    case 'OR': {
      let out: boolean | null = false;
      for (let n = 0; n < args.length; n++) { const b = asBool(at(n)); if (b === true) return true; if (b === null) out = null; }
      return out;
    }
    case 'NOT': { const b = asBool(at(0)); return b === null ? null : !b; }
    case 'CHANGED': {
      if (i === 0) return false;
      const now = at(0), before = at(0, i - 1);
      if (now === null || before === null) return null;
      return !equal(now, before);
    }
    case 'STALE': {
      const n = args.length === 2 ? back(1) : back(-1);
      const samples = n ?? Math.round(4 * 3600 / env.step); // the default window is 4h
      if (i < samples) return false;
      const now = at(0);
      if (now === null) return null;
      for (let j = i - samples; j < i; j++) if (!equal(at(0, j), now)) return false;
      return true;
    }
    case 'RATE': {
      const n = back(1);
      if (n === null || i < n) return null;
      const now = asNum(at(0)), before = asNum(at(0, i - n));
      if (now === null || before === null) return null;
      return ((now - before) / (n * env.step)) * 3600;
    }
    case 'AVG': {
      const n = back(1);
      if (n === null) return null;
      const from = Math.max(0, i - n);
      let sum = 0, count = 0;
      for (let j = from; j <= i; j++) { const v = asNum(at(0, j)); if (v !== null) { sum += v; count++; } }
      return count ? sum / count : null;
    }
    case 'BITAND': case 'BITOR': case 'BITXOR': {
      const a = asNum(at(0)), b = asNum(at(1));
      if (a === null || b === null) return null;
      const x = Math.trunc(a), y = Math.trunc(b);
      return ast.name === 'BITAND' ? (x & y) : ast.name === 'BITOR' ? (x | y) : (x ^ y);
    }
    case 'HEX2DEC': {
      const s = at(0);
      if (typeof s !== 'string' || !/^[0-9a-fA-F]+$/.test(s)) return null;
      return parseInt(s, 16);
    }
    default: return null;
  }
}

// ---- the run ---------------------------------------------------------------

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

const safeParse = (text: string): Ast | null => { try { return parseFormula(text); } catch { return null; } };

/** Run the rule against the signals. Never throws: a formula that does not parse reads null. */
export function simulate(rule: Rule, opts: SimulationOptions): Simulation {
  const step = opts.step > 0 ? opts.step : 1;
  const count = Math.max(1, Math.floor(opts.stop / step) + 1);
  const times = Array.from({ length: count }, (_, i) => i * step);

  // Tags: one series each, from its signal.
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
  const tagByKey = new Map(tags.map((s) => [s.key, s]));

  // Variables: evaluated on demand and memoized, so a variable read by many
  // formulas and time functions is computed once per sample.
  const varAst = new Map(rule.variables.map((v) => [v.name, safeParse(v.formula)]));
  const memo = new Map<string, Value[]>();
  const visiting = new Set<string>();
  const env: Env = {
    step,
    tag: (ref, i) => tagByKey.get(tagKey(ref))?.values[i] ?? null,
    variable: (name, i) => {
      const ast = varAst.get(name);
      if (!ast) return null;
      let series = memo.get(name);
      if (!series) { series = new Array<Value>(count).fill(undefined as unknown as Value); memo.set(name, series); }
      if (series[i] !== undefined) return series[i];
      const mark = `${name}@${i}`;
      if (visiting.has(mark)) return null; // a cycle: validation reports it
      visiting.add(mark);
      const v = evaluateAt(ast, i, env);
      visiting.delete(mark);
      series[i] = v;
      return v;
    },
  };
  const variables: NamedSeries[] = rule.variables.map((v) => ({ name: v.name, values: times.map((_, i) => env.variable(v.name, i)) }));

  const condAst = rule.conditions.map((c) => safeParse(c.expr));
  const conditions: NamedSeries[] = rule.conditions.map((c, k) => ({
    name: c.expr,
    values: times.map((_, i) => (condAst[k] ? asBool(evaluateAt(condAst[k]!, i, env)) : null)),
  }));

  // The rule: match, edge, cooldown.
  const result: Array<boolean | null> = times.map((_, i) => {
    if (conditions.length === 0) return null;
    const vals = conditions.map((c) => c.values[i]);
    if (rule.match === 'all') return vals.every((v) => v === true) ? true : vals.some((v) => v === false) ? false : null;
    return vals.some((v) => v === true) ? true : vals.every((v) => v === false) ? false : null;
  });
  const cooldown = rule.cooldown ? parseGoDuration(rule.cooldown) ?? 0 : 0;
  const rising = rule.edge === 'rising';
  const fires: number[] = [];
  const log: LogEntry[] = [];
  const LOG_MAX = 200;
  let hidden = 0;
  const say = (entry: LogEntry): void => { if (log.length < LOG_MAX) log.push(entry); else hidden++; };
  let allowedFrom = 0;
  for (let i = 0; i < count; i++) {
    const t = times[i];
    // Which conditions the log already named at this time, so a fire does not repeat one.
    const announced = new Set<number>();
    if (i > 0) {
      conditions.forEach((c, k) => {
        const now = c.values[i], before = c.values[i - 1];
        if (now === before || now === null) return;
        say({ t, text: `Condition ${k + 1} became ${now}.` });
        announced.add(k);
      });
    }
    const on = result[i] === true;
    const wasOn = i > 0 && result[i - 1] === true;
    const trigger = rising ? on && !wasOn : on;
    if (!trigger || t < allowedFrom) continue;
    fires.push(t);
    const firing = conditions.findIndex((c) => c.values[i] === true);
    const description = rule.conditions[firing]?.description ?? '';
    const thenEnv: Env = { ...env, context: (name) => (name === 'condition.description' ? description : null) };
    const text = (field: string | undefined): string => {
      if (!field) return '';
      if (!field.startsWith('=')) return field;
      const ast = safeParse(field);
      const v = ast ? evaluateAt(ast, i, thenEnv) : null;
      return v === null ? '—' : String(v);
    };
    const actions = [
      ...rule.actions.map((a) => `Publish to ${text(a.topic)}${a.payload ? ` ${text(a.payload)}` : ''}`),
      ...(rule.incident ? [`Raise ${rule.incident.severity} incident “${text(rule.incident.summary)}”`] : []),
    ];
    // The line above already names a condition that just changed; do not repeat it.
    const why = firing >= 0 && !announced.has(firing) ? `Condition ${firing + 1} is true.` : '';
    say({ t, text: [`Fired.`, why, actions.join(' · ')].filter(Boolean).join(' '), fired: true });
    if (cooldown > 0) {
      allowedFrom = t + cooldown;
      say({ t, text: `Cooldown: the rule cannot fire again before ${formatSeconds(allowedFrom)}.` });
    }
  }
  if (hidden) log.push({ t: times[count - 1], text: `${hidden} more events are not shown.` });
  return { times, tags, variables, conditions, result, fires, log };
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
