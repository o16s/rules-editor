// Data model for the Edge Hub rules.xml schema (shared by tsend2mqtt and
// iolinkmaster2mqtt). This is the single source of truth the serializer,
// parser, validator, and GUI all operate on.

export const OPERATORS = ['eq', 'neq', 'lt', 'leq', 'gt', 'geq', 'changed'] as const;
export type Op = (typeof OPERATORS)[number];

/** XML operator aliases → canonical op. */
export const OP_ALIASES: Record<string, Op> = {
  '=': 'eq',
  '==': 'eq',
  '!=': 'neq',
  '<': 'lt',
  '<=': 'leq',
  '>': 'gt',
  '>=': 'geq',
};

/** Operators that take no `value`. */
export const VALUELESS_OPS: readonly Op[] = ['changed'];

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

export const SEVERITIES = ['critical', 'error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const EDGES = ['none', 'rising'] as const;
export type Edge = (typeof EDGES)[number];

/** A leaf condition: one field compared against a value. */
export interface Cond {
  kind: 'cond';
  device?: string; // IO-Link only; omitted for tsend2mqtt (single PLC source)
  tag: string;
  op: Op;
  value?: string; // omitted when op === 'changed'
}

/** An AND/OR logic group. */
export interface Group {
  kind: 'and' | 'or';
  children: Condition[];
}

export type Condition = Cond | Group;

export interface Publish {
  topic: string;
  payload?: string; // omitted → '{}' at runtime
}

export interface Incident {
  source: string;
  severity: Severity;
  summary: string;
}

export interface Rule {
  name: string;
  cooldown?: string; // Go duration, e.g. '30s'
  edge?: Edge; // default 'none'
  condition: Condition | null;
  actions: Publish[];
  incident: Incident | null;
}

export interface RulesModel {
  rules: Rule[];
}

export const LIMITS = {
  maxRules: 1000,
  maxDepth: 4,
  maxChildren: 16,
  maxSummary: 120,
} as const;

export function isGroup(c: Condition): c is Group {
  return c.kind === 'and' || c.kind === 'or';
}

/** Resolve an operator token (possibly an alias) to its canonical form, or null. */
export function canonicalOp(token: string): Op | null {
  const t = token.trim();
  if ((OPERATORS as readonly string[]).includes(t)) return t as Op;
  return OP_ALIASES[t] ?? null;
}
