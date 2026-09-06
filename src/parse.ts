import type { Cond, Edge, Incident, Match, Publish, Rule, RulesModel, Severity, Variable } from './model.js';
import { canonicalOp, COOLDOWN_RE, EDGES, LIMITS, SEVERITIES, VALUELESS_OPS, VARIABLE_NAME_RE } from './model.js';
import {
  FormulaError,
  RESERVED_NAMES,
  checkFunctions,
  formulaBody,
  formulaRefs,
  inferType,
  isFormula,
  legacyCondToFormula,
  parseFormula,
  type Ast,
  type FormulaType,
} from './formula.js';

export class RulesParseError extends Error {}

// ---- parsing -------------------------------------------------------------

/** Parse rules.xml text into a model. Throws RulesParseError on invalid input. */
export function parse(xml: string): RulesModel {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new RulesParseError(`Malformed XML: ${err.textContent?.trim() ?? 'parse error'}`);

  const root = doc.documentElement;
  if (!root || root.nodeName !== 'rules') {
    throw new RulesParseError(`Root element must be <rules>, got <${root?.nodeName ?? 'nothing'}>`);
  }

  const rules = elementChildren(root).map(parseRule);
  return { rules };
}

function parseRule(el: Element): Rule {
  if (el.nodeName !== 'rule') {
    throw new RulesParseError(`Expected <rule>, got <${el.nodeName}>`);
  }
  const name = el.getAttribute('name');
  if (!name) throw new RulesParseError('<rule> is missing the required name attribute');

  const edgeAttr = el.getAttribute('edge') ?? undefined;
  if (edgeAttr && !(EDGES as readonly string[]).includes(edgeAttr)) {
    throw new RulesParseError(`Rule "${name}": invalid edge "${edgeAttr}" (expected rising or none)`);
  }

  const children = elementChildren(el);
  let variables: Variable[] = [];
  let seenCondition = false;
  let match: Match = 'any';
  let conditions: Cond[] = [];
  let actions: Publish[] = [];
  let incident: Incident | null = null;

  for (const child of children) {
    switch (child.nodeName) {
      case 'variables':
        variables = elementChildren(child).map((v) => parseVariable(v, name));
        break;
      case 'cond':
      case 'and':
      case 'or': {
        if (seenCondition) throw new RulesParseError(`Rule "${name}": more than one top-level condition`);
        seenCondition = true;
        const parsed = parseConditions(child, name);
        match = parsed.match;
        conditions = parsed.conditions;
        break;
      }
      case 'actions':
        actions = elementChildren(child).map((p) => parsePublish(p, name));
        break;
      case 'incident':
        incident = parseIncident(child, name);
        break;
      default:
        throw new RulesParseError(`Rule "${name}": unexpected element <${child.nodeName}>`);
    }
  }

  const rule: Rule = { name, variables, match, conditions, actions, incident };
  const cooldown = el.getAttribute('cooldown');
  if (cooldown) rule.cooldown = cooldown;
  if (edgeAttr) rule.edge = edgeAttr as Edge;
  return rule;
}

function parseVariable(el: Element, ruleName: string): Variable {
  if (el.nodeName !== 'var') {
    throw new RulesParseError(`Rule "${ruleName}": <variables> may only contain <var>, got <${el.nodeName}>`);
  }
  const name = el.getAttribute('name');
  const formula = el.getAttribute('formula');
  if (!name) throw new RulesParseError(`Rule "${ruleName}": <var> is missing name`);
  if (!formula) throw new RulesParseError(`Rule "${ruleName}": <var name="${name}"> is missing formula`);
  const v: Variable = { name, formula: formulaBody(formula) };
  const description = el.getAttribute('description');
  if (description) v.description = description;
  return v;
}

/**
 * The rule's top-level condition as rows. A bare <cond> is one row. A level-1
 * group gives the match mode and one row per child; a nested group becomes
 * one row whose formula is AND(...)/OR(...) over its children.
 */
function parseConditions(el: Element, ruleName: string): { match: Match; conditions: Cond[] } {
  if (el.nodeName === 'cond') return { match: 'any', conditions: [condRow(el, ruleName)] };
  const match: Match = el.nodeName === 'or' ? 'any' : 'all';
  const conditions = elementChildren(el).map((child) => {
    if (child.nodeName === 'cond') return condRow(child, ruleName);
    const row: Cond = { expr: foldGroup(child, ruleName, 2) };
    const description = child.getAttribute('description');
    if (description) row.description = description;
    return row;
  });
  return { match, conditions };
}

/** A nested v0.2 group as one formula. `depth` is the group's level below <rule>. */
function foldGroup(el: Element, ruleName: string, depth: number): string {
  if (el.nodeName !== 'and' && el.nodeName !== 'or') {
    throw new RulesParseError(`Rule "${ruleName}": unexpected condition element <${el.nodeName}>`);
  }
  if (depth > LIMITS.maxDepth - 1) {
    throw new RulesParseError(`Rule "${ruleName}": condition nesting exceeds max depth of ${LIMITS.maxDepth}`);
  }
  const children = elementChildren(el);
  if (children.length === 0) throw new RulesParseError(`Rule "${ruleName}": <${el.nodeName}> group is empty`);
  if (children.length > LIMITS.maxChildren) {
    throw new RulesParseError(`Rule "${ruleName}": <${el.nodeName}> has ${children.length} children (max ${LIMITS.maxChildren})`);
  }
  const parts = children.map((c) => (c.nodeName === 'cond' ? condRow(c, ruleName).expr : foldGroup(c, ruleName, depth + 1)));
  if (parts.length === 1) return parts[0];
  return `${el.nodeName.toUpperCase()}(${parts.join(', ')})`;
}

/** One <cond> as a row: its expr, or the v0.2 tag/op/value form as a formula. */
function condRow(el: Element, ruleName: string): Cond {
  const expr = el.getAttribute('expr');
  const tag = el.getAttribute('tag');
  const opRaw = el.getAttribute('op');
  const row: Cond = { expr: '' };
  if (expr) {
    if (tag || opRaw) throw new RulesParseError(`Rule "${ruleName}": <cond> has both expr and tag/op; use one form`);
    row.expr = formulaBody(expr);
  } else {
    if (!tag) throw new RulesParseError(`Rule "${ruleName}": <cond> is missing expr (or tag and op)`);
    if (!opRaw) throw new RulesParseError(`Rule "${ruleName}": <cond tag="${tag}"> is missing op`);
    const op = canonicalOp(opRaw);
    if (!op) throw new RulesParseError(`Rule "${ruleName}": unknown operator "${opRaw}"`);
    const value = el.getAttribute('value');
    if (!VALUELESS_OPS.includes(op) && !value) {
      throw new RulesParseError(`Rule "${ruleName}": operator "${op}" on tag "${tag}" needs a value`);
    }
    const device = el.getAttribute('device') || undefined;
    row.expr = legacyCondToFormula({ device, tag, op, value: value ?? undefined });
  }
  const description = el.getAttribute('description');
  if (description) row.description = description;
  return row;
}

function parsePublish(el: Element, ruleName: string): Publish {
  if (el.nodeName !== 'publish') {
    throw new RulesParseError(`Rule "${ruleName}": <actions> may only contain <publish>, got <${el.nodeName}>`);
  }
  const topic = el.getAttribute('topic');
  if (!topic) throw new RulesParseError(`Rule "${ruleName}": <publish> is missing topic`);
  const pub: Publish = { topic };
  const payload = el.getAttribute('payload');
  if (payload !== null) pub.payload = payload;
  return pub;
}

function parseIncident(el: Element, ruleName: string): Incident {
  const source = el.getAttribute('source');
  const severity = el.getAttribute('severity');
  const summary = el.getAttribute('summary');
  if (!source) throw new RulesParseError(`Rule "${ruleName}": <incident> is missing source`);
  if (!severity || !(SEVERITIES as readonly string[]).includes(severity)) {
    throw new RulesParseError(`Rule "${ruleName}": <incident> has invalid severity "${severity ?? ''}"`);
  }
  if (summary === null) throw new RulesParseError(`Rule "${ruleName}": <incident> is missing summary`);
  const inc: Incident = { source, severity: severity as Severity, summary };
  const firstStep = el.getAttribute('first_step');
  if (firstStep) inc.firstStep = firstStep;
  const cause = el.getAttribute('cause');
  if (cause) inc.cause = cause;
  return inc;
}

/** Element (not text/comment) children of a node. */
function elementChildren(el: Element): Element[] {
  return Array.from(el.children);
}

// ---- validation ----------------------------------------------------------

/**
 * A validation message plus where it belongs, so an editor can point at the
 * input that needs fixing. `rule` is an index into `model.rules`; `variable`,
 * `condition` and `action` are indexes into the rule's lists.
 */
export interface ValidationIssue {
  /** Human-readable message — the text `validate()` returns. */
  message: string;
  /** Index in `model.rules`, absent for a whole-file issue. */
  rule?: number;
  /** The input at fault, absent when the issue is about the rule as a whole. */
  field?:
    | 'name'
    | 'cooldown'
    | 'variable'
    | 'formula'
    | 'condition'
    | 'expr'
    | 'description'
    | 'topic'
    | 'payload'
    | 'source'
    | 'summary'
    | 'first_step'
    | 'cause';
  /** Index in `rule.variables`, for a variable issue. */
  variable?: number;
  /** Index in `rule.conditions`, for a condition row issue. */
  condition?: number;
  /** Index in `rule.actions`, for a publish issue. */
  action?: number;
}

/** Semantic checks beyond well-formedness. Returns human-readable messages. */
export function validate(model: RulesModel): string[] {
  return validateIssues(model).map((i) => i.message);
}

/** The same checks as `validate()`, each with the location of the problem. */
export function validateIssues(model: RulesModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (model.rules.length > LIMITS.maxRules) {
    issues.push({ message: `Too many rules: ${model.rules.length} (max ${LIMITS.maxRules}).` });
  }

  const seen = new Set<string>();
  model.rules.forEach((rule, index) => {
    const where = rule.name ? `Rule "${rule.name}"` : 'Unnamed rule';
    const at = (message: string, rest: Omit<ValidationIssue, 'message' | 'rule'> = {}) =>
      issues.push({ message, rule: index, ...rest });

    if (!rule.name) at('A rule is missing a name.', { field: 'name' });
    else if (seen.has(rule.name)) at(`Duplicate rule name "${rule.name}".`, { field: 'name' });
    else seen.add(rule.name);

    if (rule.cooldown !== undefined && !COOLDOWN_RE.test(rule.cooldown)) {
      at(`${where}: cooldown "${rule.cooldown}" is not a Go duration (e.g. 30s, 1m30s, 500ms).`, { field: 'cooldown' });
    }

    const scope = new RuleScope(rule);
    validateVariables(rule, where, scope, at);
    validateConditions(rule, where, scope, at);

    if (rule.actions.length === 0 && !rule.incident) {
      at(`${where}: must have <actions>, an <incident>, or both.`);
    }
    rule.actions.forEach((a, action) => {
      if (!a.topic) at(`${where}: a publish action is missing a topic.`, { field: 'topic', action });
      else checkThenField(a.topic, `${where}: topic`, scope, (m) => at(m, { field: 'topic', action }));
      if (a.payload) checkThenField(a.payload, `${where}: payload`, scope, (m) => at(m, { field: 'payload', action }));
    });
    if (rule.incident) {
      const inc = rule.incident;
      if (!inc.source) at(`${where}: incident is missing a source.`, { field: 'source' });
      else checkThenField(inc.source, `${where}: source`, scope, (m) => at(m, { field: 'source' }));
      if (!inc.summary) at(`${where}: incident is missing a title.`, { field: 'summary' });
      else checkThenField(inc.summary, `${where}: title`, scope, (m) => at(m, { field: 'summary' }));
      // Count characters, not UTF-16 units, to match the XSD's maxLength.
      if (chars(inc.summary) > LIMITS.maxSummary) {
        at(`${where}: incident title exceeds ${LIMITS.maxSummary} characters.`, { field: 'summary' });
      }
      if (inc.firstStep) {
        checkThenField(inc.firstStep, `${where}: first step`, scope, (m) => at(m, { field: 'first_step' }));
        if (chars(inc.firstStep) > LIMITS.maxText) at(`${where}: first step exceeds ${LIMITS.maxText} characters.`, { field: 'first_step' });
      }
      if (inc.cause) {
        checkThenField(inc.cause, `${where}: cause`, scope, (m) => at(m, { field: 'cause' }));
        if (chars(inc.cause) > LIMITS.maxText) at(`${where}: cause exceeds ${LIMITS.maxText} characters.`, { field: 'cause' });
      }
    }
  });
  return issues;
}

const chars = (s: string): number => [...s].length;

type At = (message: string, rest?: Omit<ValidationIssue, 'message' | 'rule'>) => void;

/** The variables of one rule: parsed once, with types and cycle detection. */
class RuleScope {
  private readonly byName = new Map<string, Variable>();
  private readonly asts = new Map<string, Ast | null>();
  private readonly types = new Map<string, FormulaType>();
  private readonly visiting = new Set<string>();

  constructor(rule: Rule) {
    for (const v of rule.variables) if (v.name && !this.byName.has(v.name)) this.byName.set(v.name, v);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** The variable's AST, or null when it does not parse. */
  ast(name: string): Ast | null {
    if (this.asts.has(name)) return this.asts.get(name)!;
    let ast: Ast | null = null;
    try {
      const v = this.byName.get(name);
      ast = v ? parseFormula(v.formula) : null;
    } catch {
      ast = null;
    }
    this.asts.set(name, ast);
    return ast;
  }

  /** The variable's static type; `any` while it is being resolved (a cycle). */
  typeOf = (name: string): FormulaType => {
    if (this.types.has(name)) return this.types.get(name)!;
    if (this.visiting.has(name)) return 'any';
    const ast = this.ast(name);
    if (!ast) return 'any';
    this.visiting.add(name);
    const t = inferType(ast, this.typeOf);
    this.visiting.delete(name);
    this.types.set(name, t);
    return t;
  };

  /** The names on a reference cycle that starts at `name`, or null. */
  cycleFrom(name: string): string[] | null {
    const stack: string[] = [];
    const onStack = new Set<string>();
    const done = new Set<string>();
    const walk = (n: string): string[] | null => {
      if (onStack.has(n)) return [...stack.slice(stack.indexOf(n)), n];
      if (done.has(n)) return null;
      const ast = this.ast(n);
      if (!ast) return null;
      stack.push(n);
      onStack.add(n);
      for (const ref of formulaRefs(ast).variables) {
        if (!this.has(ref)) continue;
        const found = walk(ref);
        if (found) return found;
      }
      stack.pop();
      onStack.delete(n);
      done.add(n);
      return null;
    };
    return walk(name);
  }
}

/** Parse and check one formula; report through `report`. Returns the AST or null. */
function checkFormula(
  text: string,
  label: string,
  scope: RuleScope,
  report: (message: string) => void,
  o: { allowContext: boolean }
): Ast | null {
  let ast: Ast;
  try {
    ast = parseFormula(text);
  } catch (e) {
    const col = e instanceof FormulaError ? ` (column ${e.column + 1})` : '';
    report(`${label}: ${(e as Error).message}${col}`);
    return null;
  }
  for (const m of checkFunctions(ast)) report(`${label}: ${m}`);
  const refs = formulaRefs(ast);
  for (const v of refs.variables) {
    if (!scope.has(v)) report(`${label}: "${v}" is not a variable of this rule.`);
  }
  if (!o.allowContext && refs.context.length) {
    report(`${label}: ${refs.context[0]} can only be used in a Then field.`);
  }
  return ast;
}

function validateVariables(rule: Rule, where: string, scope: RuleScope, at: At): void {
  if (rule.variables.length > LIMITS.maxVariables) {
    at(`${where}: too many variables: ${rule.variables.length} (max ${LIMITS.maxVariables}).`, { field: 'variable' });
  }
  const names = new Set<string>();
  /** Members of a cycle already reported, so a cycle is reported once. */
  const onReportedCycle = new Set<string>();
  rule.variables.forEach((v, variable) => {
    const label = v.name ? `${where}: variable "${v.name}"` : `${where}: variable ${variable + 1}`;
    if (!v.name) at(`${where}: variable ${variable + 1} has no name.`, { field: 'variable', variable });
    else if (!VARIABLE_NAME_RE.test(v.name)) {
      at(`${label}: a name is letters, digits and underscores, and does not start with a digit.`, { field: 'variable', variable });
    } else if (RESERVED_NAMES.includes(v.name.toUpperCase())) {
      at(`${label}: "${v.name}" is a reserved word.`, { field: 'variable', variable });
    } else if (names.has(v.name)) at(`${label}: duplicate variable name.`, { field: 'variable', variable });
    else names.add(v.name);

    if (!v.formula) at(`${label}: has no formula.`, { field: 'formula', variable });
    else {
      checkFormula(v.formula, label, scope, (m) => at(m, { field: 'formula', variable }), { allowContext: false });
      const cycle = v.name && names.has(v.name) && !onReportedCycle.has(v.name) ? scope.cycleFrom(v.name) : null;
      // Only the variable the cycle starts at reports it; one that merely
      // points into the cycle is fine once the cycle is fixed.
      if (cycle && cycle[0] === v.name) {
        at(`${label}: refers to itself through ${cycle.join(' → ')}.`, { field: 'formula', variable });
        cycle.forEach((n) => onReportedCycle.add(n));
      }
    }
    if (v.description && chars(v.description) > LIMITS.maxText) {
      at(`${label}: description exceeds ${LIMITS.maxText} characters.`, { field: 'description', variable });
    }
  });
}

function validateConditions(rule: Rule, where: string, scope: RuleScope, at: At): void {
  if (rule.conditions.length === 0) at(`${where}: needs at least one condition.`, { field: 'condition' });
  if (rule.conditions.length > LIMITS.maxChildren) {
    at(`${where}: has ${rule.conditions.length} conditions (max ${LIMITS.maxChildren}).`, { field: 'condition' });
  }
  rule.conditions.forEach((c, condition) => {
    const label = `${where}: condition ${condition + 1}`;
    if (!c.expr) {
      at(`${label} is empty.`, { field: 'expr', condition });
    } else {
      const ast = checkFormula(c.expr, label, scope, (m) => at(m, { field: 'expr', condition }), { allowContext: false });
      if (ast) {
        const t = inferType(ast, scope.typeOf);
        if (t === 'number' || t === 'string' || t === 'duration') {
          at(`${label}: must be true or false, but is a ${t}. Compare it, for example "${c.expr} > 0".`, { field: 'expr', condition });
        }
      }
    }
    if (c.description && chars(c.description) > LIMITS.maxText) {
      at(`${label}: description exceeds ${LIMITS.maxText} characters.`, { field: 'description', condition });
    }
  });
}

/** A Then field is text unless it starts with "="; then it must be a valid formula. */
function checkThenField(text: string, label: string, scope: RuleScope, report: (message: string) => void): void {
  if (!isFormula(text)) return;
  checkFormula(text, label, scope, report, { allowContext: true });
}
