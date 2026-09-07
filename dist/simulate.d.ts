import { type Ast, type TagRef } from './formula.js';
import type { Rule } from './model.js';
/** A value on the wire: what a tag reads, or what a formula gives. Null is "no value". */
export type Value = number | string | boolean | null;
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
export declare const SIGNALS: readonly SignalSpec[];
/** A signal formula, parsed and checked. Throws an Error with a message for the row. */
export declare function parseSignal(text: string): Ast;
/** The value of a parsed signal at time `t` (seconds). */
export declare function signalAt(signal: Ast, t: number): Value;
/** Seconds in a Go duration ("45s", "1m30s", "500ms"); null when it is not one. */
export declare function parseGoDuration(text: string): number | null;
/** What a formula reads while it runs. Indices are sample steps, `step` seconds apart. */
export interface Env {
    step: number;
    tag(ref: TagRef, i: number): Value;
    variable(name: string, i: number): Value;
    context?(name: string): Value;
}
/** The key a tag is stored under: "device/tag", or "tag" without a device. */
export declare const tagKey: (ref: TagRef) => string;
/** Evaluate `ast` at sample `i`. Time functions look back through `env` at earlier samples. */
export declare function evaluateAt(ast: Ast, i: number, env: Env): Value;
export interface SimulationOptions {
    /** Length of the run in seconds. */
    stop: number;
    /** Seconds between samples. */
    step: number;
    /** Signal formula per tag key; a tag without one reads null. */
    signals: Record<string, string>;
}
export interface TagSeries {
    key: string;
    ref: TagRef;
    values: Value[]; /** Why the signal did not parse. */
    error?: string;
}
export interface NamedSeries {
    name: string;
    values: Value[];
}
export interface LogEntry {
    t: number;
    text: string;
    fired?: boolean;
}
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
export declare function ruleTags(rule: Rule): TagRef[];
/** Run the rule against the signals. Never throws: a formula that does not parse reads null. */
export declare function simulate(rule: Rule, opts: SimulationOptions): Simulation;
/** Seconds for display: "180 s"; fractions keep one decimal. */
export declare function formatSeconds(t: number): string;
/** A value for display, with an optional unit; null is a dash. */
export declare function formatValue(v: Value, unit?: string): string;
//# sourceMappingURL=simulate.d.ts.map