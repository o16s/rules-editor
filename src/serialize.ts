import type { Condition, Publish, Rule, RulesModel } from './model.js';
import { isGroup, VALUELESS_OPS } from './model.js';

// Serialize a rules model to the Edge Hub rules.xml schema. Output mirrors the
// documented style: double-quoted attributes, single-quoted when the value
// contains a double quote (e.g. JSON payloads), always XML-safe.

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

function condLine(c: Condition, depth: number): string {
  const pad = INDENT.repeat(depth);
  if (isGroup(c)) {
    const inner = c.children.map((child) => condLine(child, depth + 1)).join('\n');
    return `${pad}<${c.kind}>\n${inner}\n${pad}</${c.kind}>`;
  }
  const parts: string[] = [];
  if (c.device) parts.push(attr('device', c.device));
  parts.push(attr('tag', c.tag));
  parts.push(attr('op', c.op));
  if (!VALUELESS_OPS.includes(c.op) && c.value !== undefined) parts.push(attr('value', c.value));
  return `${pad}<cond ${parts.join(' ')}/>`;
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

  const body: string[] = [];
  if (rule.condition) body.push(condLine(rule.condition, 2));
  if (rule.actions.length) {
    const pubs = rule.actions.map((p) => publishLine(p, 3)).join('\n');
    body.push(`${INDENT.repeat(2)}<actions>\n${pubs}\n${INDENT.repeat(2)}</actions>`);
  }
  if (rule.incident) {
    const i = rule.incident;
    const inc = `${attr('source', i.source)} ${attr('severity', i.severity)} ${attr('summary', i.summary)}`;
    body.push(`${INDENT.repeat(2)}<incident ${inc}/>`);
  }

  const open = `${INDENT}<rule ${head.join(' ')}>`;
  return `${open}\n${body.join('\n')}\n${INDENT}</rule>`;
}

export function serialize(model: RulesModel): string {
  const rules = model.rules.map(ruleBlock).join('\n\n');
  const inner = rules ? `\n${rules}\n` : '\n';
  return `<rules>${inner}</rules>\n`;
}
