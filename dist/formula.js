// The formula language of rules.xml v0.3: an Excel-style expression used in
// variable formulas, condition rows (`expr`), and Then fields that start with
// `=`. This module is the tokenizer, the parser, the printer, and the static
// checks. There is no evaluator here: the gateway evaluates, and a simulator
// can evaluate the same AST later.
//
//   =TAG("vibration1", "temperature") > 50
//   =AND(milk_temp > 3.6, door_changed)
//   =BITAND(status_word, HEX2DEC("10")) != 0
//   =condition.description & ". The press PLC set its own alarm bit."
/** A formula that does not parse. `column` is the 0-based offset in the text. */
export class FormulaError extends Error {
    column;
    constructor(message, column) {
        super(message);
        this.column = column;
        this.name = 'FormulaError';
    }
}
/**
 * Every function the language knows. Adding a function is one line here; the
 * gateway must implement it before it does anything at runtime.
 */
export const FUNCTIONS = [
    { name: 'TAG', minArgs: 1, maxArgs: 2, returns: 'any', signature: 'TAG("tag") or TAG("device", "tag")', doc: 'The current value of a decoded field.' },
    { name: 'AND', minArgs: 2, maxArgs: 16, returns: 'bool', signature: 'AND(a, b, …)', doc: 'True when every argument is true.' },
    { name: 'OR', minArgs: 2, maxArgs: 16, returns: 'bool', signature: 'OR(a, b, …)', doc: 'True when any argument is true.' },
    { name: 'NOT', minArgs: 1, maxArgs: 1, returns: 'bool', signature: 'NOT(a)', doc: 'The opposite of a.' },
    { name: 'CHANGED', minArgs: 1, maxArgs: 1, returns: 'bool', signature: 'CHANGED(x)', doc: 'True in the cycle where x changed.' },
    { name: 'STALE', minArgs: 1, maxArgs: 2, returns: 'bool', signature: 'STALE(x, 4h)', doc: 'True when x did not update within the duration.' },
    { name: 'RATE', minArgs: 2, maxArgs: 2, returns: 'number', signature: 'RATE(x, 30min)', doc: 'Change of x per hour, over the window.' },
    { name: 'AVG', minArgs: 2, maxArgs: 2, returns: 'number', signature: 'AVG(x, 10min)', doc: 'Mean of x over the window.' },
    { name: 'BITAND', minArgs: 2, maxArgs: 2, returns: 'number', signature: 'BITAND(x, mask)', doc: 'Bitwise AND of two integers.' },
    { name: 'BITOR', minArgs: 2, maxArgs: 2, returns: 'number', signature: 'BITOR(x, mask)', doc: 'Bitwise OR of two integers.' },
    { name: 'BITXOR', minArgs: 2, maxArgs: 2, returns: 'number', signature: 'BITXOR(x, mask)', doc: 'Bitwise XOR of two integers.' },
    { name: 'HEX2DEC', minArgs: 1, maxArgs: 1, returns: 'number', signature: 'HEX2DEC("FF")', doc: 'The integer value of a hex string.' },
];
const FUNCTION_BY_NAME = new Map(FUNCTIONS.map((f) => [f.name, f]));
export function functionSpec(name) {
    return FUNCTION_BY_NAME.get(name.toUpperCase());
}
/** Names a variable must not take: functions, literals, and the context object. */
export const RESERVED_NAMES = [...FUNCTIONS.map((f) => f.name), 'TRUE', 'FALSE', 'CONDITION'];
/** The names a Then field can read from the firing condition. */
export const CONTEXT_NAMES = ['condition.description'];
const DURATION_UNITS = { ms: 0.001, s: 1, m: 60, min: 60, h: 3600 };
const isIdentStart = (c) => /[A-Za-z_]/.test(c);
const isIdentChar = (c) => /[A-Za-z0-9_]/.test(c);
const isDigit = (c) => /[0-9]/.test(c);
/**
 * Tokenize `text`. With `lenient` the tokenizer never throws: an unreadable
 * span becomes one `error` token so a display can still colour the rest.
 */
function tokenize(text, lenient) {
    const out = [];
    let i = 0;
    const fail = (message, at) => {
        if (!lenient)
            throw new FormulaError(message, at);
        out.push({ kind: 'error', text: text.slice(at), start: at });
        i = text.length;
    };
    while (i < text.length) {
        const c = text[i];
        const start = i;
        if (/\s/.test(c)) {
            while (i < text.length && /\s/.test(text[i]))
                i++;
            out.push({ kind: 'space', text: text.slice(start, i), start });
            continue;
        }
        if (c === '"') {
            i++;
            let closed = false;
            while (i < text.length) {
                if (text[i] === '"') {
                    if (text[i + 1] === '"') {
                        i += 2;
                        continue;
                    }
                    i++;
                    closed = true;
                    break;
                }
                i++;
            }
            if (!closed) {
                fail('Missing closing quote.', start);
                continue;
            }
            out.push({ kind: 'string', text: text.slice(start, i), start });
            continue;
        }
        if (isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''))) {
            while (i < text.length && isDigit(text[i]))
                i++;
            if (text[i] === '.') {
                i++;
                while (i < text.length && isDigit(text[i]))
                    i++;
            }
            if (i < text.length && isIdentStart(text[i])) {
                const unitStart = i;
                while (i < text.length && isIdentChar(text[i]))
                    i++;
                const unit = text.slice(unitStart, i);
                if (!(unit in DURATION_UNITS)) {
                    fail(`Unknown unit "${unit}". Use ms, s, m, min, or h.`, unitStart);
                    continue;
                }
                out.push({ kind: 'duration', text: text.slice(start, i), start });
                continue;
            }
            out.push({ kind: 'number', text: text.slice(start, i), start });
            continue;
        }
        if (isIdentStart(c)) {
            while (i < text.length && isIdentChar(text[i]))
                i++;
            if (text[i] === '.' && isIdentStart(text[i + 1] ?? '')) {
                i++;
                while (i < text.length && isIdentChar(text[i]))
                    i++;
                out.push({ kind: 'context', text: text.slice(start, i), start });
                continue;
            }
            const word = text.slice(start, i);
            const upper = word.toUpperCase();
            let j = i;
            while (j < text.length && /\s/.test(text[j]))
                j++;
            const kind = upper === 'TRUE' || upper === 'FALSE' ? 'bool' : text[j] === '(' ? 'function' : 'ident';
            out.push({ kind, text: word, start });
            continue;
        }
        const two = text.slice(i, i + 2);
        if (two === '<=' || two === '>=' || two === '!=' || two === '<>' || two === '==') {
            out.push({ kind: 'op', text: two, start });
            i += 2;
            continue;
        }
        if ('&=<>+-*/'.includes(c)) {
            out.push({ kind: 'op', text: c, start });
            i++;
            continue;
        }
        if (c === '(') {
            out.push({ kind: 'lparen', text: c, start });
            i++;
            continue;
        }
        if (c === ')') {
            out.push({ kind: 'rparen', text: c, start });
            i++;
            continue;
        }
        if (c === ',') {
            out.push({ kind: 'comma', text: c, start });
            i++;
            continue;
        }
        fail(`Unexpected character "${c}".`, start);
    }
    out.push({ kind: 'eof', text: '', start: text.length });
    return out;
}
/** Tokens for display, spaces included, never throws. A leading `=` is skipped. */
export function formulaTokens(text) {
    const body = text.startsWith('=') ? text.slice(1) : text;
    return tokenize(body, true).filter((t) => t.kind !== 'eof');
}
// ---- parser (Pratt) --------------------------------------------------------
const BINARY_PRECEDENCE = {
    '&': 1,
    '=': 2, '==': 2, '!=': 2, '<>': 2, '<': 2, '<=': 2, '>': 2, '>=': 2,
    '+': 3, '-': 3,
    '*': 4, '/': 4,
};
const UNARY_PRECEDENCE = 5;
const normalizeOp = (op) => (op === '==' ? '=' : op === '<>' ? '!=' : op);
/** Parse a formula. A leading `=` is accepted and ignored. Throws FormulaError. */
export function parseFormula(text) {
    const offset = text.startsWith('=') ? 1 : 0;
    const tokens = tokenize(text.slice(offset), false).filter((t) => t.kind !== 'space');
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const err = (message, tok) => { throw new FormulaError(message, tok.start + offset); };
    const expect = (kind, what) => {
        const t = next();
        if (t.kind !== kind)
            err(t.kind === 'eof' ? `Expected ${what} at the end.` : `Expected ${what}, got "${t.text}".`, t);
        return t;
    };
    function primary() {
        const t = next();
        switch (t.kind) {
            case 'number': {
                const value = Number(t.text);
                if (!Number.isFinite(value))
                    err(`Bad number "${t.text}".`, t);
                return { kind: 'number', value, raw: t.text };
            }
            case 'duration': {
                const m = /^([0-9.]+)([a-z]+)$/i.exec(t.text);
                return { kind: 'duration', raw: t.text, seconds: Number(m[1]) * DURATION_UNITS[m[2]] };
            }
            case 'string':
                return { kind: 'string', value: t.text.slice(1, -1).replace(/""/g, '"') };
            case 'bool':
                return { kind: 'bool', value: t.text.toUpperCase() === 'TRUE' };
            case 'context':
                return { kind: 'context', name: t.text };
            case 'ident':
                return { kind: 'ref', name: t.text };
            case 'function': {
                expect('lparen', '"("');
                const args = [];
                if (peek().kind !== 'rparen') {
                    for (;;) {
                        args.push(expression(0));
                        if (peek().kind === 'comma') {
                            next();
                            continue;
                        }
                        break;
                    }
                }
                expect('rparen', '")"');
                return { kind: 'call', name: t.text.toUpperCase(), args };
            }
            case 'lparen': {
                const inner = expression(0);
                expect('rparen', '")"');
                return inner;
            }
            case 'op':
                if (t.text === '-')
                    return { kind: 'unary', op: '-', arg: expression(UNARY_PRECEDENCE) };
                return err(`Unexpected "${t.text}".`, t);
            case 'eof':
                return err('The formula is incomplete.', t);
            default:
                return err(`Unexpected "${t.text}".`, t);
        }
    }
    function expression(minPrecedence) {
        let left = primary();
        for (;;) {
            const t = peek();
            if (t.kind !== 'op')
                break;
            const prec = BINARY_PRECEDENCE[t.text];
            if (prec === undefined || prec < minPrecedence)
                break;
            next();
            const right = expression(prec + 1);
            left = { kind: 'binary', op: normalizeOp(t.text), left, right };
        }
        return left;
    }
    const ast = expression(0);
    const rest = peek();
    if (rest.kind !== 'eof')
        err(`Unexpected "${rest.text}".`, rest);
    return ast;
}
// ---- printer ---------------------------------------------------------------
function precedenceOf(ast) {
    if (ast.kind === 'binary')
        return BINARY_PRECEDENCE[ast.op];
    if (ast.kind === 'unary')
        return UNARY_PRECEDENCE;
    return 10;
}
/** Quote a string literal the way the tokenizer reads it back. */
export function quoteString(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
/** Canonical text of an AST: one space around operators, upper-case functions. */
export function printFormula(ast) {
    switch (ast.kind) {
        case 'number': return ast.raw;
        case 'duration': return ast.raw;
        case 'string': return quoteString(ast.value);
        case 'bool': return ast.value ? 'true' : 'false';
        case 'ref': return ast.name;
        case 'context': return ast.name;
        case 'call': return `${ast.name}(${ast.args.map(printFormula).join(', ')})`;
        case 'unary': {
            const inner = printFormula(ast.arg);
            return precedenceOf(ast.arg) < UNARY_PRECEDENCE ? `-(${inner})` : `-${inner}`;
        }
        case 'binary': {
            const prec = BINARY_PRECEDENCE[ast.op];
            const wrap = (side, strict) => {
                const s = printFormula(side);
                const p = precedenceOf(side);
                return p < prec || (strict && p === prec) ? `(${s})` : s;
            };
            return `${wrap(ast.left, false)} ${ast.op} ${wrap(ast.right, true)}`;
        }
    }
}
// ---- function checks -------------------------------------------------------
/** Unknown functions and wrong argument counts, as messages; empty when fine. */
export function checkFunctions(ast) {
    const out = [];
    const walk = (n) => {
        switch (n.kind) {
            case 'call': {
                const spec = functionSpec(n.name);
                if (!spec)
                    out.push(`Unknown function ${n.name}().`);
                else if (n.args.length < spec.minArgs || n.args.length > spec.maxArgs) {
                    const want = spec.minArgs === spec.maxArgs ? `${spec.minArgs}` : `${spec.minArgs} to ${spec.maxArgs}`;
                    out.push(`${spec.name}() takes ${want} argument${spec.maxArgs === 1 ? '' : 's'}, got ${n.args.length}: ${spec.signature}.`);
                }
                n.args.forEach(walk);
                break;
            }
            case 'unary':
                walk(n.arg);
                break;
            case 'binary':
                walk(n.left);
                walk(n.right);
                break;
            default: break;
        }
    };
    walk(ast);
    return out;
}
/** Everything a formula reads, each list without duplicates, in order of first use. */
export function formulaRefs(ast) {
    const refs = { variables: [], tags: [], context: [] };
    const push = (list, v) => { if (!list.includes(v))
        list.push(v); };
    const walk = (n) => {
        switch (n.kind) {
            case 'ref':
                push(refs.variables, n.name);
                break;
            case 'context':
                push(refs.context, n.name);
                break;
            case 'call':
                if (n.name === 'TAG' && n.args.every((a) => a.kind === 'string')) {
                    const strings = n.args.map((a) => a.value);
                    const ref = strings.length === 2 ? { device: strings[0], tag: strings[1] } : { tag: strings[0] };
                    if (!refs.tags.some((t) => t.tag === ref.tag && t.device === ref.device))
                        refs.tags.push(ref);
                }
                n.args.forEach(walk);
                break;
            case 'unary':
                walk(n.arg);
                break;
            case 'binary':
                walk(n.left);
                walk(n.right);
                break;
            default: break;
        }
    };
    walk(ast);
    return refs;
}
/**
 * The static type of a formula. `lookup` gives a variable's type, or `any`
 * when unknown. Comparisons and logic functions are bool, `&` is string,
 * arithmetic is number, TAG and unknown references are any.
 */
export function inferType(ast, lookup = () => 'any') {
    switch (ast.kind) {
        case 'number': return 'number';
        case 'duration': return 'duration';
        case 'string': return 'string';
        case 'bool': return 'bool';
        case 'ref': return lookup(ast.name);
        case 'context': return 'string';
        case 'call': return functionSpec(ast.name)?.returns ?? 'any';
        case 'unary': return 'number';
        case 'binary':
            if (ast.op === '&')
                return 'string';
            if (ast.op === '+' || ast.op === '-' || ast.op === '*' || ast.op === '/')
                return 'number';
            return 'bool';
    }
}
// ---- legacy leaf conditions ------------------------------------------------
const OP_SYMBOL = { eq: '=', neq: '!=', lt: '<', leq: '<=', gt: '>', geq: '>=' };
/** Render a value attribute as a literal: number, boolean, or quoted string. */
function literalOf(value) {
    if (/^-?(\d+\.?\d*|\.\d+)$/.test(value))
        return value;
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === 'false')
        return lower;
    return quoteString(value);
}
/**
 * The formula for a v0.2 `<cond tag op value>` leaf, so an old file opens as
 * formula rows: `TAG("dev", "tag") > 50`, or `CHANGED(TAG("tag"))`.
 */
export function legacyCondToFormula(leaf) {
    const tag = leaf.device ? `TAG(${quoteString(leaf.device)}, ${quoteString(leaf.tag)})` : `TAG(${quoteString(leaf.tag)})`;
    if (leaf.op === 'changed')
        return `CHANGED(${tag})`;
    const symbol = OP_SYMBOL[leaf.op] ?? '=';
    return `${tag} ${symbol} ${literalOf(leaf.value ?? '')}`;
}
// ---- Then fields -----------------------------------------------------------
/** A Then field holds a formula when it starts with `=`; anything else is text. */
export function isFormula(text) {
    return text !== undefined && text.startsWith('=');
}
/** The formula text without its leading `=`. */
export function formulaBody(text) {
    return text.startsWith('=') ? text.slice(1) : text;
}
//# sourceMappingURL=formula.js.map