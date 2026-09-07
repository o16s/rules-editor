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

interface EngineGlobals {
  octaviewRulesSimulate?: SimulateFn;
  Go?: new () => { importObject: WebAssembly.Imports; run(i: WebAssembly.Instance): void };
}

let loading: Promise<SimulateFn> | null = null;

/**
 * Where the page finds the two files. A host that serves the package from
 * somewhere else sets both before the first call. Under Node a plain path
 * works as well as a URL.
 */
export const engineAssets = {
  wasm: new URL('../dist/rules-engine.wasm', import.meta.url).href,
  glue: new URL('../dist/wasm_exec.js', import.meta.url).href,
};

/** True in Node, including the test runner, and false in a browser. */
function inNode(): boolean {
  const p = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof p?.versions?.node === 'string';
}

/**
 * Turn one asset reference into a path Node can read. A file URL carries the
 * path; anything else falls back to the package layout, because a test runner
 * rewrites import.meta.url to its own dev-server address.
 */
async function nodePath(ref: string, fallback: string): Promise<string> {
  if (ref.startsWith('file:')) {
    const { fileURLToPath } = await import('node:url');
    return fileURLToPath(ref);
  }
  if (!ref.includes('://')) return ref;
  const { resolve } = await import('node:path');
  return resolve(process.cwd(), fallback);
}

/** Read the module and the glue, in the browser or in Node. */
async function readAssets(): Promise<{ bytes: ArrayBuffer; glue: string }> {
  if (inNode()) {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(await nodePath(engineAssets.wasm, 'dist/rules-engine.wasm'));
    const glue = await readFile(await nodePath(engineAssets.glue, 'dist/wasm_exec.js'), 'utf8');
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { bytes, glue };
  }
  const [wasmRes, glueRes] = await Promise.all([fetch(engineAssets.wasm), fetch(engineAssets.glue)]);
  if (!wasmRes.ok) throw new Error(`the rule engine did not load: ${wasmRes.status}`);
  if (!glueRes.ok) throw new Error(`the rule engine glue did not load: ${glueRes.status}`);
  return { bytes: await wasmRes.arrayBuffer(), glue: await glueRes.text() };
}

/**
 * Load the engine. The first call reads and starts the module; every call
 * after that returns the same one.
 */
export function loadEngine(): Promise<SimulateFn> {
  if (loading) return loading;
  loading = (async (): Promise<SimulateFn> => {
    const scope = globalThis as unknown as EngineGlobals;
    if (scope.octaviewRulesSimulate) return scope.octaviewRulesSimulate;

    const { bytes, glue } = await readAssets();
    if (!scope.Go) {
      // wasm_exec.js defines Go on the global object. It is Go's own file and
      // it is not a module, so it runs as a script.
      new Function(glue)();
    }
    if (!scope.Go) throw new Error('the rule engine glue did not define its loader');
    const go = new scope.Go();
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    go.run(instance);
    const fn = scope.octaviewRulesSimulate;
    if (!fn) throw new Error('the rule engine started without its entry point');
    return fn;
  })();
  return loading;
}

/** Run one simulation through the engine. */
export async function runEngine(request: EngineRequest): Promise<EngineResult> {
  const simulate = await loadEngine();
  return JSON.parse(simulate(JSON.stringify(request))) as EngineResult;
}

/** Forget the loaded module. Tests use it; a page does not. */
export function resetEngineForTests(): void {
  loading = null;
  delete (globalThis as unknown as EngineGlobals).octaviewRulesSimulate;
}
