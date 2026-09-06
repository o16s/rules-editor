import type { RulesModel } from './model.js';
import type { Token } from './formula.js';
import type { TagCatalog } from './catalog.js';
import { type MonitorRef } from './gui/state.js';
export type { MonitorRef };
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
    /**
     * Called once on mount and after every committed edit: a text cell commits
     * on Enter, Tab, or when it loses focus; choices, Add, Delete and Import
     * commit at once. Keystrokes inside a cell do not fire it.
     */
    onChange?: (state: {
        model: RulesModel;
        xml: string;
        errors: string[];
    }) => void;
    /**
     * Live values for the "Formula result" and "Condition result" cells. Called
     * when a rule is rendered and on `refreshValues()`. Return undefined for a
     * cell with no value; it shows "—".
     */
    monitor?: (ref: MonitorRef) => string | undefined;
    /**
     * The devices and tags the gateway knows, for the TAG("…") autocomplete.
     * Typing `TAG("` lists devices (and the tags of a device-less source);
     * after the device, the tags of that device. A function is read each time
     * the menu opens, so it can return live values. Update later with
     * `setCatalog()`. Without a catalog the editor works as before.
     */
    catalog?: TagCatalog | (() => TagCatalog);
}
export interface RulesEditorHandle {
    /** Deep copy of the current model. */
    getModel(): RulesModel;
    /** Current model serialized to rules.xml. */
    getXml(): string;
    /** Validation messages for the current model (empty = valid). */
    getErrors(): string[];
    /** Replace the model and re-render. The selected rule is kept when it still exists. */
    setModel(model: RulesModel): void;
    /** Re-read `monitor` for every result cell, without a re-render. Call it when live values change. */
    refreshValues(): void;
    /** Replace the `monitor` callback and re-read every result cell. */
    setMonitor(monitor: ((ref: MonitorRef) => string | undefined) | undefined): void;
    /** Replace the tag catalog. Takes effect the next time the TAG("…") menu opens. */
    setCatalog(catalog: TagCatalog | (() => TagCatalog) | undefined): void;
    /**
     * Replace the file from rules.xml text. Returns the validation messages; a
     * malformed file is reported there and leaves the editor unchanged.
     */
    setXml(xml: string): string[];
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
export { tagContext, tagChoices, applyTagChoice, nameContext, nameChoices, applyNameChoice } from './catalog.js';
export type { TagCatalog, DeviceEntry, TagEntry, TagContext, TagChoice, NameContext, NameChoice } from './catalog.js';
export { OPERATORS, SEVERITIES, EDGES, MATCHES, VALUELESS_OPS, OP_ALIASES, LIMITS, COOLDOWN_PATTERN, COOLDOWN_RE, VARIABLE_NAME_PATTERN, VARIABLE_NAME_RE, canonicalOp, } from './model.js';
export type { Op, Severity, Edge, Match, Variable, Cond, Publish, Incident, Rule, RulesModel, } from './model.js';
//# sourceMappingURL=gui.d.ts.map