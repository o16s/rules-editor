import type { Cond, Publish, Rule, RulesModel, Variable } from './model.js';

// Serialize a rules model to the Edge Hub rules.xml schema. Output mirrors the
// documented style: double-quoted attributes, single-quoted when the value
// contains a double quote (e.g. JSON payloads and formulas), always XML-safe.

const INDENT = '  ';

/** Escape for a double-quoted attribute value. */
function escDouble(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape for a single-quoted attribute value (quotes kept literal). */
function escSingle(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render `name="value"`, preferring single quotes when the value contains a
 * double quote but no single quote (keeps JSON payloads readable, as in docs).
 */
function attr(name: string, value: string): string {
  if (value.includes('"') && !value.includes("'")) {
    return `${name}='${escSingle(value)}'`;
  }
  return `${name}="${escDouble(value)}"`;
}

function variableLine(v: Variable, depth: number): string {
  const parts = [attr('name', v.name), attr('formula', v.formula)];
  if (v.description) parts.push(attr('description', v.description));
  return `${INDENT.repeat(depth)}<var ${parts.join(' ')}/>`;
}

function condLine(c: Cond, depth: number): string {
  const parts = [attr('expr', c.expr)];
  if (c.description) parts.push(attr('description', c.description));
  return `${INDENT.repeat(depth)}<cond ${parts.join(' ')}/>`;
}

function publishLine(p: Publish, depth: number): string {
  const pad = INDENT.repeat(depth);
  const parts = [attr('topic', p.topic)];
  if (p.payload !== undefined && p.payload !== '') parts.push(attr('payload', p.payload));
  return `${pad}<publish ${parts.join(' ')}/>`;
}

function ruleBlock(rule: Rule): string {
  const head = [attr('name', rule.name)];
  if (rule.cooldown) head.push(attr('cooldown', rule.cooldown));
  if (rule.edge && rule.edge !== 'none') head.push(attr('edge', rule.edge));

  const pad2 = INDENT.repeat(2);
  const body: string[] = [];
  if (rule.variables.length) {
    const vars = rule.variables.map((v) => variableLine(v, 3)).join('\n');
    body.push(`${pad2}<variables>\n${vars}\n${pad2}</variables>`);
  }
  if (rule.conditions.length === 1) {
    body.push(condLine(rule.conditions[0], 2));
  } else if (rule.conditions.length > 1) {
    const kind = rule.match === 'all' ? 'and' : 'or';
    const rows = rule.conditions.map((c) => condLine(c, 3)).join('\n');
    body.push(`${pad2}<${kind}>\n${rows}\n${pad2}</${kind}>`);
  }
  if (rule.actions.length) {
    const pubs = rule.actions.map((p) => publishLine(p, 3)).join('\n');
    body.push(`${pad2}<actions>\n${pubs}\n${pad2}</actions>`);
  }
  if (rule.incident) {
    const i = rule.incident;
    const parts = [attr('source', i.source), attr('severity', i.severity), attr('summary', i.summary)];
    if (i.firstStep) parts.push(attr('first_step', i.firstStep));
    if (i.cause) parts.push(attr('cause', i.cause));
    body.push(`${pad2}<incident ${parts.join(' ')}/>`);
  }

  const open = `${INDENT}<rule ${head.join(' ')}>`;
  return `${open}\n${body.join('\n')}\n${INDENT}</rule>`;
}

export function serialize(model: RulesModel): string {
  const rules = model.rules.map(ruleBlock).join('\n\n');
  const inner = rules ? `\n${rules}\n` : '\n';
  return `<rules>${inner}</rules>\n`;
}
