// Data model for the Edge Hub rules.xml schema (shared by tsend2mqtt and
// iolinkmaster2mqtt). This is the single source of truth the serializer,
// parser, validator, and GUI all operate on.
export const OPERATORS = ['eq', 'neq', 'lt', 'leq', 'gt', 'geq', 'changed'];
/** XML operator aliases → canonical op. */
export const OP_ALIASES = {
    '=': 'eq',
    '==': 'eq',
    '!=': 'neq',
    '<': 'lt',
    '<=': 'leq',
    '>': 'gt',
    '>=': 'geq',
};
/** Operators that take no `value`. */
export const VALUELESS_OPS = ['changed'];
export const SEVERITIES = ['critical', 'error', 'warning', 'info'];
export const EDGES = ['none', 'rising'];
export const LIMITS = {
    maxRules: 1000,
    maxDepth: 4,
    maxChildren: 16,
    maxSummary: 120,
};
export function isGroup(c) {
    return c.kind === 'and' || c.kind === 'or';
}
/** Resolve an operator token (possibly an alias) to its canonical form, or null. */
export function canonicalOp(token) {
    const t = token.trim();
    if (OPERATORS.includes(t))
        return t;
    return OP_ALIASES[t] ?? null;
}
//# sourceMappingURL=model.js.map