// The tag catalog a host can supply, and the pure logic behind the formula
// autocomplete: where the caret is (inside a TAG call, or in a bare name),
// which choices fit, and what the text becomes when one is picked. No DOM
// here; gui.ts draws the menu.
import { isIdentChar, isIdentStart, quoteString as quote } from './formula.js';
/** True when `caret` sits inside a string literal of `text` (`""` is an escaped quote). */
export function insideString(text, caret) {
    let inString = false;
    for (let i = 0; i < caret; i++) {
        if (text[i] !== '"')
            continue;
        if (inString && text[i + 1] === '"' && i + 1 < caret) {
            i++;
            continue;
        }
        inString = !inString;
    }
    return inString;
}
/** Index just past the closing quote of the string open at `from`, or null when it never closes. */
function closingQuote(text, from) {
    for (let i = from; i < text.length; i++) {
        if (text[i] !== '"')
            continue;
        if (text[i + 1] === '"') {
            i++;
            continue;
        }
        return i + 1;
    }
    return null;
}
/**
 * Where the caret is, when it is inside a string argument of TAG(...).
 * Scans `text` up to `caret`, tracking strings and the stack of open calls.
 */
export function tagContext(text, caret) {
    const stack = [];
    let inString = false;
    let stringStart = -1;
    let i = 0;
    while (i < caret) {
        const c = text[i];
        if (inString) {
            if (c === '"') {
                if (text[i + 1] === '"' && i + 1 < caret) {
                    i += 2;
                    continue;
                }
                inString = false;
            }
            i++;
            continue;
        }
        if (c === '"') {
            inString = true;
            stringStart = i;
            i++;
            continue;
        }
        if (isIdentStart(c)) {
            const s = i;
            while (i < text.length && isIdentChar(text[i]))
                i++;
            let j = i;
            while (j < text.length && /\s/.test(text[j]))
                j++;
            if (text[j] === '(' && j < caret) {
                stack.push({ name: text.slice(s, i).toUpperCase(), argIndex: 0, open: j });
                i = j + 1;
            }
            continue;
        }
        if (c === '(')
            stack.push({ name: '', argIndex: 0, open: i });
        else if (c === ')')
            stack.pop();
        else if (c === ',') {
            const top = stack[stack.length - 1];
            if (top)
                top.argIndex++;
        }
        i++;
    }
    if (!inString)
        return null;
    const top = stack[stack.length - 1];
    if (!top || top.name !== 'TAG' || top.argIndex > 1)
        return null;
    // The literal may continue past the caret: take it up to its closing quote
    // (a doubled quote is a quote inside the string). Unterminated: stop at the caret.
    const end = closingQuote(text, caret) ?? caret;
    const ctx = { arg: top.argIndex, prefix: text.slice(stringStart + 1, caret), start: stringStart, end };
    if (top.argIndex === 1) {
        const first = /^\s*"((?:[^"]|"")*)"\s*$/.exec(text.slice(top.open + 1, text.lastIndexOf(',', stringStart)));
        if (!first)
            return null;
        ctx.device = first[1].replace(/""/g, '"');
    }
    return ctx;
}
/** The catalog entries that fit the context, best matches first. */
export function tagChoices(catalog, ctx) {
    const p = ctx.prefix.toLowerCase();
    const rank = (name) => {
        const n = name.toLowerCase();
        return n.startsWith(p) ? 0 : n.includes(p) ? 1 : -1;
    };
    const out = [];
    if (ctx.arg === 0) {
        for (const entry of catalog.devices) {
            if (entry.device) {
                const r = rank(entry.device);
                if (r >= 0)
                    out.push({ rank: r, choice: { kind: 'device', device: entry.device, entry } });
            }
            else {
                for (const tag of entry.tags) {
                    const r = rank(tag.tag);
                    if (r >= 0)
                        out.push({ rank: r, choice: { kind: 'tag', entry: tag } });
                }
            }
        }
    }
    else {
        const entry = catalog.devices.find((d) => d.device === ctx.device);
        for (const tag of entry?.tags ?? []) {
            const r = rank(tag.tag);
            if (r >= 0)
                out.push({ rank: r, choice: { kind: 'tag', device: ctx.device, entry: tag } });
        }
    }
    return out.sort((a, b) => a.rank - b.rank).map((o) => o.choice);
}
/** Where the caret is, when it is inside a bare name (a variable or function being typed). */
export function nameContext(text, caret) {
    if (insideString(text, caret))
        return null;
    let start = caret;
    while (start > 0 && isIdentChar(text[start - 1]))
        start--;
    if (start === caret || !isIdentStart(text[start]))
        return null;
    if (start > 0 && text[start - 1] === '.')
        return null; // condition.description
    let end = caret;
    while (end < text.length && isIdentChar(text[end]))
        end++;
    return { prefix: text.slice(start, caret), start, end };
}
/**
 * Variables and functions that fit the typed prefix, variables first, best
 * matches first. Nothing when the only match is what is already typed.
 */
export function nameChoices(ctx, variables, functions) {
    const p = ctx.prefix.toLowerCase();
    const rank = (name) => {
        const n = name.toLowerCase();
        return n.startsWith(p) ? 0 : n.includes(p) ? 1 : -1;
    };
    const out = [];
    for (const v of variables) {
        if (!v.name)
            continue;
        const r = rank(v.name);
        if (r >= 0)
            out.push({ rank: r, choice: { kind: 'variable', name: v.name, description: v.description, value: v.value } });
    }
    // Functions match by prefix only: a substring match ("te" in RATE) is noise.
    for (const f of functions) {
        if (f.name.toLowerCase().startsWith(p))
            out.push({ rank: 2, choice: { kind: 'function', entry: f } });
    }
    const choices = out.sort((a, b) => a.rank - b.rank).map((o) => o.choice);
    if (choices.length === 1) {
        const only = choices[0];
        const typed = ctx.prefix;
        if ((only.kind === 'variable' && only.name === typed) || (only.kind === 'function' && only.entry.name === typed.toUpperCase()))
            return [];
    }
    return choices;
}
/**
 * The text after picking a name. A variable replaces the word. A function
 * replaces it with `NAME(`; TAG opens its first string too, so the device
 * list can follow (`more`).
 */
export function applyNameChoice(text, ctx, choice) {
    const before = text.slice(0, ctx.start);
    const after = text.slice(ctx.end);
    if (choice.kind === 'variable') {
        return { text: before + choice.name + after, caret: before.length + choice.name.length, more: false };
    }
    const name = choice.entry.name;
    const opens = /^\s*\(/.test(after);
    const inserted = opens ? name : name === 'TAG' ? `${name}("` : `${name}(`;
    const caret = before.length + inserted.length + (opens ? (/^\s*\(/.exec(after)?.[0].length ?? 0) : 0);
    return { text: before + inserted + after, caret, more: name === 'TAG' && !opens };
}
/**
 * The text after picking a choice: a device becomes `"device", "` with the
 * caret ready for the tag; a tag becomes `"tag"` and closes the call when
 * nothing does. `more` is true when the menu has a next step.
 */
export function applyTagChoice(text, ctx, choice) {
    const before = text.slice(0, ctx.start);
    const after = text.slice(ctx.end);
    if (choice.kind === 'device') {
        const inserted = `${quote(choice.device)}, "`;
        // Reuse a second argument that already follows, else open a fresh string.
        const next = /^\s*,\s*"/.exec(after);
        if (next)
            return { text: before + quote(choice.device) + after, caret: before.length + quote(choice.device).length + next[0].length, more: true };
        return { text: before + inserted + after, caret: before.length + inserted.length, more: true };
    }
    const literal = quote(choice.entry.tag);
    const closes = /^\s*\)/.test(after);
    const inserted = closes ? literal : `${literal})`;
    return { text: before + inserted + after, caret: before.length + inserted.length + (closes ? (/^\s*\)/.exec(after)?.[0].length ?? 0) : 0), more: false };
}
//# sourceMappingURL=catalog.js.map