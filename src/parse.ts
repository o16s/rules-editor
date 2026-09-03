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

/** Semantic checks beyond well-formedness. Returns human-readable messages. */
export function validate(model: RulesModel): string[] {
  const errors: string[] = [];
  if (model.rules.length > LIMITS.maxRules) {
    errors.push(`Too many rules: ${model.rules.length} (max ${LIMITS.maxRules}).`);
  }

  const seen = new Set<string>();
  for (const rule of model.rules) {
    const where = rule.name ? `Rule "${rule.name}"` : 'Unnamed rule';
    if (!rule.name) errors.push('A rule is missing a name.');
    else if (seen.has(rule.name)) errors.push(`Duplicate rule name "${rule.name}".`);
    else seen.add(rule.name);

    if (rule.cooldown !== undefined && !COOLDOWN_RE.test(rule.cooldown)) {
      errors.push(`${where}: cooldown "${rule.cooldown}" is not a Go duration (e.g. 30s, 1m30s, 500ms).`);
    }

    if (!rule.condition) errors.push(`${where}: needs exactly one condition.`);
    else validateCondition(rule.condition, where, 1, errors);

    if (rule.actions.length === 0 && !rule.incident) {
      errors.push(`${where}: must have <actions>, an <incident>, or both.`);
    }
    for (const a of rule.actions) {
      if (!a.topic) errors.push(`${where}: a publish action is missing a topic.`);
    }
    if (rule.incident) {
      if (!rule.incident.source) errors.push(`${where}: incident is missing a source.`);
      if (!rule.incident.summary) errors.push(`${where}: incident is missing a summary.`);
      // Count characters, not UTF-16 units, to match the XSD's maxLength.
      if ([...rule.incident.summary].length > LIMITS.maxSummary) {
        errors.push(`${where}: incident summary exceeds ${LIMITS.maxSummary} characters.`);
      }
    }
  }
  return errors;
}

function validateCondition(c: Condition, where: string, depth: number, errors: string[]): void {
  if (depth > LIMITS.maxDepth) {
    errors.push(`${where}: condition nesting exceeds max depth of ${LIMITS.maxDepth}.`);
    return;
  }
  if (isGroup(c)) {
    if (c.children.length === 0) errors.push(`${where}: <${c.kind}> group is empty.`);
    if (c.children.length > LIMITS.maxChildren) {
      errors.push(`${where}: <${c.kind}> has ${c.children.length} children (max ${LIMITS.maxChildren}).`);
    }
    for (const child of c.children) validateCondition(child, where, depth + 1, errors);
    return;
  }
  if (!c.tag) errors.push(`${where}: a condition is missing a tag.`);
  if (!VALUELESS_OPS.includes(c.op) && (c.value === undefined || c.value === '')) {
    errors.push(`${where}: operator "${c.op}" on tag "${c.tag}" needs a value.`);
  }
}
