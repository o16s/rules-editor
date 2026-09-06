// The tag catalog a host can supply, and the pure logic behind the TAG(...)
// autocomplete: where the caret is inside a TAG call, which choices fit, and
// what the text becomes when one is picked. No DOM here; gui.ts draws the menu.

/** One field a device exposes. `value` and `stale` are live data the host may bind. */
export interface TagEntry {
  tag: string;
  /** Engineering unit, shown beside the live value: "°C", "l/min". */
  unit?: string;
  description?: string;
  /** The current reading, as text, when the host has one. */
  value?: string;
  /** True when the host has not heard from this tag lately. */
  stale?: boolean;
}

/** A device and its tags. Omit `device` for a source with one implicit device (a PLC). */
export interface DeviceEntry {
  device?: string;
  description?: string;
  tags: TagEntry[];
}

export interface TagCatalog {
  devices: DeviceEntry[];
}

/** The caret sits inside a string argument of TAG(...). */
export interface TagContext {
  /** 0: the first argument (a device, or a tag of the implicit device); 1: the tag of `device`. */
  arg: 0 | 1;
  /** What is typed so far inside the quotes, before the caret. */
  prefix: string;
  /** The first argument's literal, when `arg` is 1. */
  device?: string;
  /** The string literal being typed, quotes included: `text.slice(start, end)`. */
  start: number;
  end: number;
}

export type TagChoice =
  | { kind: 'device'; device: string; entry: DeviceEntry }
  | { kind: 'tag'; device?: string; entry: TagEntry };

const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

/**
 * Where the caret is, when it is inside a string argument of TAG(...).
 * Scans `text` up to `caret`, tracking strings and the stack of open calls.
 */
export function tagContext(text: string, caret: number): TagContext | null {
  type Frame = { name: string; argIndex: number; open: number };
  const stack: Frame[] = [];
  let inString = false;
  let stringStart = -1;
  let i = 0;
  while (i < caret) {
    const c = text[i];
    if (inString) {
      if (c === '"') {
        if (text[i + 1] === '"' && i + 1 < caret) { i += 2; continue; }
        inString = false;
      }
      i++;
      continue;
    }
    if (c === '"') { inString = true; stringStart = i; i++; continue; }
    if (isIdentStart(c)) {
      const s = i;
      while (i < text.length && isIdentChar(text[i])) i++;
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '(' && j < caret) { stack.push({ name: text.slice(s, i).toUpperCase(), argIndex: 0, open: j }); i = j + 1; }
      continue;
    }
    if (c === '(') stack.push({ name: '', argIndex: 0, open: i });
    else if (c === ')') stack.pop();
    else if (c === ',') { const top = stack[stack.length - 1]; if (top) top.argIndex++; }
    i++;
  }
  if (!inString) return null;
  const top = stack[stack.length - 1];
  if (!top || top.name !== 'TAG' || top.argIndex > 1) return null;
  // The literal may continue past the caret: take it up to its closing quote.
  const rest = /^[^",)]*"/.exec(text.slice(caret));
  const end = caret + (rest ? rest[0].length : 0);
  const ctx: TagContext = { arg: top.argIndex as 0 | 1, prefix: text.slice(stringStart + 1, caret), start: stringStart, end };
  if (top.argIndex === 1) {
    const first = /^\s*"((?:[^"]|"")*)"\s*$/.exec(text.slice(top.open + 1, text.lastIndexOf(',', stringStart)));
    if (!first) return null;
    ctx.device = first[1].replace(/""/g, '"');
  }
  return ctx;
}

/** The catalog entries that fit the context, best matches first. */
export function tagChoices(catalog: TagCatalog, ctx: TagContext): TagChoice[] {
  const p = ctx.prefix.toLowerCase();
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    return n.startsWith(p) ? 0 : n.includes(p) ? 1 : -1;
  };
  const out: Array<{ rank: number; choice: TagChoice }> = [];
  if (ctx.arg === 0) {
    for (const entry of catalog.devices) {
      if (entry.device) {
        const r = rank(entry.device);
        if (r >= 0) out.push({ rank: r, choice: { kind: 'device', device: entry.device, entry } });
      } else {
        for (const tag of entry.tags) {
          const r = rank(tag.tag);
          if (r >= 0) out.push({ rank: r, choice: { kind: 'tag', entry: tag } });
        }
      }
    }
  } else {
    const entry = catalog.devices.find((d) => d.device === ctx.device);
    for (const tag of entry?.tags ?? []) {
      const r = rank(tag.tag);
      if (r >= 0) out.push({ rank: r, choice: { kind: 'tag', device: ctx.device, entry: tag } });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map((o) => o.choice);
}

const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/**
 * The text after picking a choice: a device becomes `"device", "` with the
 * caret ready for the tag; a tag becomes `"tag"` and closes the call when
 * nothing does. `more` is true when the menu has a next step.
 */
export function applyTagChoice(text: string, ctx: TagContext, choice: TagChoice): { text: string; caret: number; more: boolean } {
  const before = text.slice(0, ctx.start);
  const after = text.slice(ctx.end);
  if (choice.kind === 'device') {
    const inserted = `${quote(choice.device)}, "`;
    // Reuse a second argument that already follows, else open a fresh string.
    const next = /^\s*,\s*"/.exec(after);
    if (next) return { text: before + quote(choice.device) + after, caret: before.length + quote(choice.device).length + next[0].length, more: true };
    return { text: before + inserted + after, caret: before.length + inserted.length, more: true };
  }
  const literal = quote(choice.entry.tag);
  const closes = /^\s*\)/.test(after);
  const inserted = closes ? literal : `${literal})`;
  return { text: before + inserted + after, caret: before.length + inserted.length + (closes ? (/^\s*\)/.exec(after)?.[0].length ?? 0) : 0), more: false };
}
