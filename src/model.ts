// Data model for the Edge Hub rules.xml schema (shared by tsend2mqtt and
// iolinkmaster2mqtt). This is the single source of truth the serializer,
// parser, validator, and GUI all operate on.
//
// v0.3: a rule holds named variables, a flat list of condition rows written
// as formulas (see formula.ts), and the Then fields. The v0.2 leaf form
// <cond tag op value> and nested <and>/<or> groups are still read by parse()
// and turned into formula rows; serialize() always writes formula rows.

/** Canonical comparison operators of the v0.2 leaf form, still read by parse(). */
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
export const COOLDOWN_PATTERN = '0|(([0-9]+(\\.[0-9]*)?|\\.[0-9]+)(ns|us|µs|μs|ms|s|m|h))+';

/** `COOLDOWN_PATTERN` anchored, for use in JS. */
export const COOLDOWN_RE = new RegExp(`^(?:${COOLDOWN_PATTERN})$`);

/**
 * A variable name: a letter or underscore, then letters, digits, underscores.
 * Must stay identical to the `identifier` pattern in schema/rules.xsd.
 */
export const VARIABLE_NAME_PATTERN = '[A-Za-z_][A-Za-z0-9_]*';
export const VARIABLE_NAME_RE = new RegExp(`^(?:${VARIABLE_NAME_PATTERN})$`);

export const SEVERITIES = ['critical', 'error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const EDGES = ['none', 'rising'] as const;
export type Edge = (typeof EDGES)[number];

/** How the condition rows combine: any → <or>, all → <and>. */
export const MATCHES = ['any', 'all'] as const;
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
  cooldown?: string; // Go duration, e.g. '30s'
  edge?: Edge; // default 'none'
  variables: Variable[];
  match: Match;
  conditions: Cond[];
  actions: Publish[];
  incident: Incident | null;
}

export interface RulesModel {
  rules: Rule[];
}

export const LIMITS = {
  maxRules: 1000,
  /** v0.2 group nesting, still enforced when reading old files. */
  maxDepth: 4,
  /** Condition rows per rule, and children per v0.2 group. */
  maxChildren: 16,
  maxSummary: 120,
  maxVariables: 64,
  /** description, first_step, cause. */
  maxText: 240,
} as const;

/** Resolve an operator token (possibly an alias) to its canonical form, or null. */
export function canonicalOp(token: string): Op | null {
  const t = token.trim();
  if ((OPERATORS as readonly string[]).includes(t)) return t as Op;
  return OP_ALIASES[t] ?? null;
}
