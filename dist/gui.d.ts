import { type RulesModel } from './model.js';
import { type Token } from './formula.js';
/** What a `monitor` callback is asked for: one result cell. */
export type MonitorRef = {
    rule: number;
} & ({
    kind: 'variable';
    name: string;
} | {
    kind: 'condition';
    index: number;
});
export interface RulesEditorOptions {
    /** Model to start from. Cloned on entry; the caller's object is not mutated. */
    initialModel?: RulesModel;
    /**
     * rules.xml to start from — parsed internally. A malformed file does NOT
     * throw: the editor opens empty and the parse error is surfaced through
     * `onChange`'s `errors` (and the status line). Takes precedence over
     * `initialModel`.
     */
    initialXml?: string;
    /** Called after every edit (and once on mount) with the current state. */
    onChange?: (state: {
        model: RulesModel;
        xml: string;
        errors: string[];
    }) => void;
    /**
     * Live values for the "Formula result" and "Condition result" cells. Called
     * on every render. Return undefined for a cell with no value; it shows "—".
     */
    monitor?: (ref: MonitorRef) => string | undefined;
}
export interface RulesEditorHandle {
    /** Deep copy of the current model. */
    getModel(): RulesModel;
    /** Current model serialized to rules.xml. */
    getXml(): string;
    /** Validation messages for the current model (empty = valid). */
    getErrors(): string[];
    /** Replace the model and re-render. */
    setModel(model: RulesModel): void;
    /** Tear down the editor (empties the container). */
    destroy(): void;
}
export declare function initRulesEditor(root: HTMLElement, opts?: RulesEditorOptions): RulesEditorHandle;
export type { Token };
export { serialize } from './serialize.js';
export { parse, validate, validateIssues, RulesParseError } from './parse.js';
export type { ValidationIssue } from './parse.js';
export { FUNCTIONS, RESERVED_NAMES, CONTEXT_NAMES, FormulaError, parseFormula, printFormula, formulaTokens, formulaRefs, inferType, checkFunctions, functionSpec, legacyCondToFormula, isFormula, formulaBody, quoteString, } from './formula.js';
export type { Ast, BinaryOp, FormulaType, FunctionSpec, FormulaRefs, TagRef, TokenKind } from './formula.js';
export { OPERATORS, SEVERITIES, EDGES, MATCHES, VALUELESS_OPS, OP_ALIASES, LIMITS, COOLDOWN_PATTERN, COOLDOWN_RE, VARIABLE_NAME_PATTERN, VARIABLE_NAME_RE, canonicalOp, } from './model.js';
export type { Op, Severity, Edge, Match, Variable, Cond, Publish, Incident, Rule, RulesModel, } from './model.js';
//# sourceMappingURL=gui.d.ts.map