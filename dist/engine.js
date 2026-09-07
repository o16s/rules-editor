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
let loading = null;
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
function inNode() {
    const p = globalThis.process;
    return typeof p?.versions?.node === 'string';
}
/**
 * Turn one asset reference into a path Node can read. A file URL carries the
 * path; anything else falls back to the package layout, because a test runner
 * rewrites import.meta.url to its own dev-server address.
 */
async function nodePath(ref, fallback) {
    if (ref.startsWith('file:')) {
        const { fileURLToPath } = await import('node:url');
        return fileURLToPath(ref);
    }
    if (!ref.includes('://'))
        return ref;
    const { resolve } = await import('node:path');
    return resolve(process.cwd(), fallback);
}
/** Read the module and the glue, in the browser or in Node. */
async function readAssets() {
    if (inNode()) {
        const { readFile } = await import('node:fs/promises');
        const buf = await readFile(await nodePath(engineAssets.wasm, 'dist/rules-engine.wasm'));
        const glue = await readFile(await nodePath(engineAssets.glue, 'dist/wasm_exec.js'), 'utf8');
        const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        return { bytes, glue };
    }
    const [wasmRes, glueRes] = await Promise.all([fetch(engineAssets.wasm), fetch(engineAssets.glue)]);
    if (!wasmRes.ok)
        throw new Error(`the rule engine did not load: ${wasmRes.status}`);
    if (!glueRes.ok)
        throw new Error(`the rule engine glue did not load: ${glueRes.status}`);
    return { bytes: await wasmRes.arrayBuffer(), glue: await glueRes.text() };
}
/**
 * Load the engine. The first call reads and starts the module; every call
 * after that returns the same one.
 */
export function loadEngine() {
    if (loading)
        return loading;
    loading = (async () => {
        const scope = globalThis;
        if (scope.octaviewRulesSimulate)
            return scope.octaviewRulesSimulate;
        const { bytes, glue } = await readAssets();
        if (!scope.Go) {
            // wasm_exec.js defines Go on the global object. It is Go's own file and
            // it is not a module, so it runs as a script.
            new Function(glue)();
        }
        if (!scope.Go)
            throw new Error('the rule engine glue did not define its loader');
        const go = new scope.Go();
        const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
        go.run(instance);
        const fn = scope.octaviewRulesSimulate;
        if (!fn)
            throw new Error('the rule engine started without its entry point');
        return fn;
    })();
    return loading;
}
/** Run one simulation through the engine. */
export async function runEngine(request) {
    const simulate = await loadEngine();
    return JSON.parse(simulate(JSON.stringify(request)));
}
/** Forget the loaded module. Tests use it; a page does not. */
export function resetEngineForTests() {
    loading = null;
    delete globalThis.octaviewRulesSimulate;
}
//# sourceMappingURL=engine.js.map