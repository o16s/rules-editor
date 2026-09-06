export type FormulaType = 'bool' | 'number' | 'string' | 'duration' | 'any';
export type BinaryOp = '&' | '=' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/';
export type Ast = {
    kind: 'number';
    value: number;
    raw: string;
} | {
    kind: 'string';
    value: string;
} | {
    kind: 'bool';
    value: boolean;
} | {
    kind: 'duration';
    raw: string;
    seconds: number;
} | {
    kind: 'ref';
    name: string;
} | {
    kind: 'context';
    name: string;
} | {
    kind: 'call';
    name: string;
    args: Ast[];
} | {
    kind: 'unary';
    op: '-';
    arg: Ast;
} | {
    kind: 'binary';
    op: BinaryOp;
    left: Ast;
    right: Ast;
};
/** A formula that does not parse. `column` is the 0-based offset in the text. */
export declare class FormulaError extends Error {
    readonly column: number;
    constructor(message: string, column: number);
}
export interface FunctionSpec {
    name: string;
    minArgs: number;
    maxArgs: number;
    returns: FormulaType;
    /** Shown as a hint while typing. */
    signature: string;
    doc: string;
}
/**
 * Every function the language knows. Adding a function is one line here; the
 * gateway must implement it before it does anything at runtime.
 */
export declare const FUNCTIONS: readonly FunctionSpec[];
export declare function functionSpec(name: string): FunctionSpec | undefined;
/** Names a variable must not take: functions, literals, and the context object. */
export declare const RESERVED_NAMES: readonly string[];
/** The names a Then field can read from the firing condition. */
export declare const CONTEXT_NAMES: readonly string[];
export type TokenKind = 'number' | 'duration' | 'string' | 'ident' | 'context' | 'bool' | 'function' | 'op' | 'lparen' | 'rparen' | 'comma' | 'space' | 'error' | 'eof';
export interface Token {
    kind: TokenKind;
    text: string;
    start: number;
}
/** Tokens for display, spaces included, never throws. A leading `=` is skipped. */
export declare function formulaTokens(text: string): Token[];
/** Parse a formula. A leading `=` is accepted and ignored. Throws FormulaError. */
export declare function parseFormula(text: string): Ast;
/** Quote a string literal the way the tokenizer reads it back. */
export declare function quoteString(value: string): string;
/** Canonical text of an AST: one space around operators, upper-case functions. */
export declare function printFormula(ast: Ast): string;
/** Unknown functions and wrong argument counts, as messages; empty when fine. */
export declare function checkFunctions(ast: Ast): string[];
export interface TagRef {
    device?: string;
    tag: string;
}
export interface FormulaRefs {
    /** Variable names the formula reads. */
    variables: string[];
    /** TAG(...) calls with literal arguments. */
    tags: TagRef[];
    /** Context names such as condition.description. */
    context: string[];
}
/** Everything a formula reads, each list without duplicates, in order of first use. */
export declare function formulaRefs(ast: Ast): FormulaRefs;
/**
 * The static type of a formula. `lookup` gives a variable's type, or `any`
 * when unknown. Comparisons and logic functions are bool, `&` is string,
 * arithmetic is number, TAG and unknown references are any.
 */
export declare function inferType(ast: Ast, lookup?: (name: string) => FormulaType): FormulaType;
/**
 * The formula for a v0.2 `<cond tag op value>` leaf, so an old file opens as
 * formula rows: `TAG("dev", "tag") > 50`, or `CHANGED(TAG("tag"))`.
 */
export declare function legacyCondToFormula(leaf: {
    device?: string;
    tag: string;
    op: string;
    value?: string;
}): string;
/** A Then field holds a formula when it starts with `=`; anything else is text. */
export declare function isFormula(text: string | undefined): boolean;
/** The formula text without its leading `=`. */
export declare function formulaBody(text: string): string;
//# sourceMappingURL=formula.d.ts.map