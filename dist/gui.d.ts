import { type RulesModel } from './model.js';
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
export { serialize } from './serialize.js';
export { parse, validate, validateIssues, RulesParseError } from './parse.js';
export type { ValidationIssue } from './parse.js';
export { OPERATORS, SEVERITIES, EDGES, VALUELESS_OPS, OP_ALIASES, LIMITS, COOLDOWN_PATTERN, COOLDOWN_RE, isGroup, canonicalOp, } from './model.js';
export type { Op, Severity, Edge, Cond, Group, Condition, Publish, Incident, Rule, RulesModel, } from './model.js';
//# sourceMappingURL=gui.d.ts.map