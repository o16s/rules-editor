/** Canonical comparison operators of the v0.2 leaf form, still read by parse(). */
export declare const OPERATORS: readonly ["eq", "neq", "lt", "leq", "gt", "geq", "changed"];
export type Op = (typeof OPERATORS)[number];
/** XML operator aliases → canonical op. */
export declare const OP_ALIASES: Record<string, Op>;
/** Operators that take no `value`. */
export declare const VALUELESS_OPS: readonly Op[];
/**
 * A non-negative Go duration, as accepted by time.ParseDuration: either a
 * bare `0`, or one or more number+unit pairs (`30s`, `1m30s`, `500ms`).
 * A sign is rejected on purpose: a negative cooldown is meaningless.
 *
 * This must stay identical to the `goDuration` pattern in schema/rules.xsd;
 * src/xsd.test.ts fails when the two drift apart.
 */
export declare const COOLDOWN_PATTERN = "0|(([0-9]+(\\.[0-9]*)?|\\.[0-9]+)(ns|us|\u00B5s|\u03BCs|ms|s|m|h))+";
/** `COOLDOWN_PATTERN` anchored, for use in JS. */
export declare const COOLDOWN_RE: RegExp;
/**
 * A variable name: a letter or underscore, then letters, digits, underscores.
 * Must stay identical to the `identifier` pattern in schema/rules.xsd.
 */
export declare const VARIABLE_NAME_PATTERN = "[A-Za-z_][A-Za-z0-9_]*";
export declare const VARIABLE_NAME_RE: RegExp;
export declare const SEVERITIES: readonly ["critical", "error", "warning", "info"];
export type Severity = (typeof SEVERITIES)[number];
export declare const EDGES: readonly ["none", "rising"];
export type Edge = (typeof EDGES)[number];
/** How the condition rows combine: any → <or>, all → <and>. */
export declare const MATCHES: readonly ["any", "all"];
export type Match = (typeof MATCHES)[number];
/** A named formula, defined once per rule and used by name in conditions. */
export interface Variable {
    name: string;
    /** Formula text without a leading `=`. */
    formula: string;
    description?: string;
}
/** One condition row: a formula that must be true. */
export interface Cond {
    /** Formula text without a leading `=`. */
    expr: string;
    /** Operator-facing meaning of the row; a Then field can quote it. */
    description?: string;
}
export interface Publish {
    /** Literal topic, or a formula when it starts with `=`. */
    topic: string;
    /** Literal payload, or a formula when it starts with `=`; omitted → '{}' at runtime. */
    payload?: string;
}
export interface Incident {
    source: string;
    severity: Severity;
    /** The alarm title, at most LIMITS.maxSummary characters. */
    summary: string;
    /** What the operator does first. */
    firstStep?: string;
    /** Why it fired and where the boundary of what we read sits. */
    cause?: string;
}
export interface Rule {
    name: string;
    cooldown?: string;
    edge?: Edge;
    variables: Variable[];
    match: Match;
    conditions: Cond[];
    actions: Publish[];
    incident: Incident | null;
}
export interface RulesModel {
    rules: Rule[];
}
export declare const LIMITS: {
    readonly maxRules: 1000;
    /** v0.2 group nesting, still enforced when reading old files. */
    readonly maxDepth: 4;
    /** Condition rows per rule, and children per v0.2 group. */
    readonly maxChildren: 16;
    readonly maxSummary: 120;
    readonly maxVariables: 64;
    /** description, first_step, cause. */
    readonly maxText: 240;
};
/** Resolve an operator token (possibly an alias) to its canonical form, or null. */
export declare function canonicalOp(token: string): Op | null;
//# sourceMappingURL=model.d.ts.map