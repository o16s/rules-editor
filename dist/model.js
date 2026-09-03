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
/**
 * A non-negative Go duration, as accepted by time.ParseDuration: either a
 * bare `0`, or one or more number+unit pairs (`30s`, `1m30s`, `500ms`).
 * A sign is rejected on purpose: a negative cooldown is meaningless.
 *
 * This must stay identical to the `goDuration` pattern in schema/rules.xsd;
 * src/xsd.test.ts fails when the two drift apart.
 */
export const COOLDOWN_PATTERN = '0|(([0-9]+(\\.[0-9]*)?|\\.[0-9]+)(ns|us|\u00b5s|\u03bcs|ms|s|m|h))+';
/** `COOLDOWN_PATTERN` anchored, for use in JS. */
export const COOLDOWN_RE = new RegExp(`^(?:${COOLDOWN_PATTERN})$`);
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