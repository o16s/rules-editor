/**
 * The rule engine, compiled for the browser.
 *
 * The Simulator page runs the gateway's own engine rather than a second
 * reading of the same rules, so a formula cannot mean one thing in the editor
 * and another on the plant. The module is `dist/rules-engine.wasm`, built from
 * `rules-engine/cmd/wasm` by `npm run build:engine`.
 *
 * Loading is asynchronous and happens once. Every call after that is a plain
 * function call.
 */
/** One value the service decodes. */
export interface EngineField {
    device: string;
    tag: string;
    /** A JSON Schema type name: boolean, integer, number or string. */
    type: string;
}
/** One moment of a run: the time, and one reading per field. */
export interface EngineStep {
    tMs: number;
    values: Array<number | string | boolean | null>;
}
/** One formula the page draws a line for. */
export interface EngineFormula {
    name: string;
    text: string;
}
export interface EngineRequest {
    /** Milliseconds between two evaluations. It sizes the time windows. */
    periodMs: number;
    fields: EngineField[];
    steps: EngineStep[];
    variables: EngineFormula[];
    rows: EngineFormula[];
    /**
     * The whole rules file, with this one rule in it. An empty document asks
     * only for the lines, not for what the rule fires.
     */
    ruleXml: string;
}
export interface EngineSeries {
    name: string;
    values: Array<number | string | boolean | null>;
    /** Why this line is empty, in the operator's words. */
    problem?: string;
}
export interface EngineFiring {
    /** The step at which the rule fired. */
    index: number;
    actions: string[] | null;
    incidents: string[] | null;
}
export interface EngineProblem {
    path: string;
    rule: string;
    message: string;
}
export interface EngineResult {
    variables: EngineSeries[];
    rows: EngineSeries[];
    result: Array<boolean | null>;
    firings: EngineFiring[];
    problems: EngineProblem[];
    /** Set when the engine could not run at all. */
    error?: string;
}
type SimulateFn = (request: string) => string;
/**
 * Where the page finds the two files. A host that serves the package from
 * somewhere else sets both before the first call. Under Node a plain path
 * works as well as a URL.
 */
export declare const engineAssets: {
    wasm: string;
    glue: string;
};
/**
 * Load the engine. The first call reads and starts the module; every call
 * after that returns the same one.
 */
export declare function loadEngine(): Promise<SimulateFn>;
/** Run one simulation through the engine. */
export declare function runEngine(request: EngineRequest): Promise<EngineResult>;
/** Forget the loaded module. Tests use it; a page does not. */
export declare function resetEngineForTests(): void;
export {};
//# sourceMappingURL=engine.d.ts.map