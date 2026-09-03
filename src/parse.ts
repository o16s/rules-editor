import type { Condition, Cond, Group, Incident, Publish, Rule, RulesModel, Severity, Edge } from './model.js';
import {
  canonicalOp,
  COOLDOWN_RE,
  isGroup,
  LIMITS,
  SEVERITIES,
  EDGES,
  VALUELESS_OPS,
} from './model.js';

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
  let condition: Condition | null = null;
  let actions: Publish[] = [];
  let incident: Incident | null = null;

  for (const child of children) {
    switch (child.nodeName) {
      case 'cond':
      case 'and':
      case 'or':
        if (condition) throw new RulesParseError(`Rule "${name}": more than one top-level condition`);
        condition = parseCondition(child, name);
        break;
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

  const rule: Rule = { name, condition, actions, incident };
  const cooldown = el.getAttribute('cooldown');
  if (cooldown) rule.cooldown = cooldown;
  if (edgeAttr) rule.edge = edgeAttr as Edge;
  return rule;
}

function parseCondition(el: Element, ruleName: string): Condition {
  if (el.nodeName === 'and' || el.nodeName === 'or') {
    const group: Group = {
      kind: el.nodeName,
      children: elementChildren(el).map((c) => parseCondition(c, ruleName)),
    };
    return group;
  }
  if (el.nodeName !== 'cond') {
    throw new RulesParseError(`Rule "${ruleName}": unexpected condition element <${el.nodeName}>`);
  }
  const tag = el.getAttribute('tag');
  const opRaw = el.getAttribute('op');
  if (!tag) throw new RulesParseError(`Rule "${ruleName}": <cond> is missing tag`);
  if (!opRaw) throw new RulesParseError(`Rule "${ruleName}": <cond tag="${tag}"> is missing op`);
  const op = canonicalOp(opRaw);
  if (!op) throw new RulesParseError(`Rule "${ruleName}": unknown operator "${opRaw}"`);

  const cond: Cond = { kind: 'cond', tag, op };
  const device = el.getAttribute('device');
  if (device) cond.device = device;
  if (!VALUELESS_OPS.includes(op)) {
    const value = el.getAttribute('value');
    if (value !== null) cond.value = value;
  }
  return cond;
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
  return { source, severity: severity as Severity, summary };
}

/** Element (not text/comment) children of a node. */
function elementChildren(el: Element): Element[] {
  return Array.from(el.children);
}

// ---- validation ----------------------------------------------------------

/**
 * A validation message plus where it belongs, so an editor can point at the
 * input that needs fixing. `rule` is an index into `model.rules`; `path` is
 * the chain of child indexes from that rule's top-level condition down to the
 * element at fault (`[]` is the top-level condition itself).
 */
export interface ValidationIssue {
  /** Human-readable message — the text `validate()` returns. */
  message: string;
  /** Index in `model.rules`, absent for a whole-file issue. */
  rule?: number;
  /** The input at fault, absent when the issue is about the rule as a whole. */
  field?: 'name' | 'cooldown' | 'condition' | 'tag' | 'value' | 'topic' | 'source' | 'summary';
  /** Child indexes from the rule's top-level condition, for a condition issue. */
  path?: number[];
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

    if (!rule.condition) at(`${where}: needs exactly one condition.`, { field: 'condition' });
    else validateCondition(rule.condition, where, 1, [], index, issues);

    if (rule.actions.length === 0 && !rule.incident) {
      at(`${where}: must have <actions>, an <incident>, or both.`);
    }
    rule.actions.forEach((a, action) => {
      if (!a.topic) at(`${where}: a publish action is missing a topic.`, { field: 'topic', action });
    });
    if (rule.incident) {
      if (!rule.incident.source) at(`${where}: incident is missing a source.`, { field: 'source' });
      if (!rule.incident.summary) at(`${where}: incident is missing a summary.`, { field: 'summary' });
      // Count characters, not UTF-16 units, to match the XSD's maxLength.
      if ([...rule.incident.summary].length > LIMITS.maxSummary) {
        at(`${where}: incident summary exceeds ${LIMITS.maxSummary} characters.`, { field: 'summary' });
      }
    }
  });
  return issues;
}

function validateCondition(
  c: Condition,
  where: string,
  depth: number,
  path: number[],
  rule: number,
  issues: ValidationIssue[]
): void {
  // A group issue carries the group's own path; a leaf issue the leaf's.
  const at = (message: string, field: ValidationIssue['field']) =>
    issues.push({ message, rule, field, path: [...path] });

  if (depth > LIMITS.maxDepth) {
    at(`${where}: condition nesting exceeds max depth of ${LIMITS.maxDepth}.`, 'condition');
    return;
  }
  if (isGroup(c)) {
    if (c.children.length === 0) at(`${where}: <${c.kind}> group is empty.`, 'condition');
    if (c.children.length > LIMITS.maxChildren) {
      at(`${where}: <${c.kind}> has ${c.children.length} children (max ${LIMITS.maxChildren}).`, 'condition');
    }
    c.children.forEach((child, i) => validateCondition(child, where, depth + 1, [...path, i], rule, issues));
    return;
  }
  if (!c.tag) at(`${where}: a condition is missing a tag.`, 'tag');
  if (!VALUELESS_OPS.includes(c.op) && (c.value === undefined || c.value === '')) {
    at(`${where}: operator "${c.op}" on tag "${c.tag}" needs a value.`, 'value');
  }
}
