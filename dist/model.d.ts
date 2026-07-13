export declare const OPERATORS: readonly ["eq", "neq", "lt", "leq", "gt", "geq", "changed"];
export type Op = (typeof OPERATORS)[number];
/** XML operator aliases → canonical op. */
export declare const OP_ALIASES: Record<string, Op>;
/** Operators that take no `value`. */
export declare const VALUELESS_OPS: readonly Op[];
export declare const SEVERITIES: readonly ["critical", "error", "warning", "info"];
export type Severity = (typeof SEVERITIES)[number];
export declare const EDGES: readonly ["none", "rising"];
export type Edge = (typeof EDGES)[number];
/** A leaf condition: one field compared against a value. */
export interface Cond {
    kind: 'cond';
    device?: string;
    tag: string;
    op: Op;
    value?: string;
}
/** An AND/OR logic group. */
export interface Group {
    kind: 'and' | 'or';
    children: Condition[];
}
export type Condition = Cond | Group;
export interface Publish {
    topic: string;
    payload?: string;
}
export interface Incident {
    source: string;
    severity: Severity;
    summary: string;
}
export interface Rule {
    name: string;
    cooldown?: string;
    edge?: Edge;
    condition: Condition | null;
    actions: Publish[];
    incident: Incident | null;
}
export interface RulesModel {
    rules: Rule[];
}
export declare const LIMITS: {
    readonly maxRules: 1000;
    readonly maxDepth: 4;
    readonly maxChildren: 16;
    readonly maxSummary: 120;
};
export declare function isGroup(c: Condition): c is Group;
/** Resolve an operator token (possibly an alias) to its canonical form, or null. */
export declare function canonicalOp(token: string): Op | null;
//# sourceMappingURL=model.d.ts.map