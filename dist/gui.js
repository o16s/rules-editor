// Drop-in rules.xml editor component (browser). Self-contained: it injects its
// own scoped, prefixed styles (`re-*` under `.re-root`) and depends only on the
// tested core (model/formula/serialize/parse/validate) — no external stylesheet.
//
//   import { initRulesEditor } from '@octanis/rules-editor';
//   const editor = initRulesEditor(document.getElementById('app'), {
//     initialModel,                       // optional; defaults to an example
//     onChange: ({ model, xml, errors }) => save(xml),
//     monitor: (ref) => liveValues[ref.kind === 'variable' ? ref.name : ref.index],
//   });
//   editor.getXml(); editor.getModel(); editor.setModel(m); editor.destroy();
//
// Layout: a rule rail on the left, and for the selected rule three sheets —
// Variables (name / formula / result / description), When (condition / result
// / description) and Then (action / field / formula) — in the
// spreadsheet style of the design handoff. Colours and fonts read the host's
// design tokens (--accent, --ink, --font-body, …) with fallbacks.
//
// This file owns the public API, the shared state, validation and the render
// cycle. The parts live in `gui/`: the rail, the sheets, the cells, the
// formula bar of the phone layout, the autocomplete menu, the XML panel, the
// styles, and the example file.
import { serialize } from './serialize.js';
import { parse, validateIssues, RulesParseError } from './parse.js';
import { clone, el } from './gui/dom.js';
import { exampleModel } from './gui/example.js';
import { injectStyles, WIDTH_CLASSES } from './gui/styles.js';
import { locKey } from './gui/state.js';
import { createMenu } from './gui/menu.js';
import { createBar } from './gui/bar.js';
import { createCells } from './gui/cells.js';
import { createRail } from './gui/rail.js';
import { createSheets } from './gui/sheets.js';
import { createXmlPanel } from './gui/xml-panel.js';
/** Editors mounted so far, for unique ids (tabs and their panels). */
let instances = 0;
/**
 * A message shown on its own field: the rule it names is the one on screen,
 * so the `Rule "x": ` prefix goes and the rest starts with a capital.
 */
export function shortMessage(message) {
    const rest = message.replace(/^(Rule "[^"]*"|Unnamed rule): /, '');
    return rest.charAt(0).toUpperCase() + rest.slice(1);
}
const parseErrorText = (e) => (e instanceof RulesParseError ? e.message : 'Could not parse XML.');
export function initRulesEditor(root, opts = {}) {
    injectStyles();
    root.classList.add('re-root');
    // A malformed initialXml is reported through `errors`, never thrown.
    let parseError = null;
    let model;
    if (opts.initialXml !== undefined) {
        try {
            model = parse(opts.initialXml);
        }
        catch (e) {
            model = { rules: [] };
            parseError = parseErrorText(e);
        }
    }
    else {
        model = opts.initialModel ? clone(opts.initialModel) : exampleModel();
    }
    const state = {
        model,
        parseError,
        selected: 0,
        filter: '',
        focusNext: null,
        narrow: false,
        activeSheet: 'vars',
        batching: false,
        monitor: opts.monitor,
        catalog: opts.catalog,
    };
    const uid = ++instances;
    /** Validation messages, with any initial parse error surfaced first. */
    const computeErrors = (issues = validateIssues(state.model)) => {
        const errs = issues.map((i) => i.message);
        return state.parseError ? [state.parseError, ...errs] : errs;
    };
    /** The xml and issues last given to onChange, so a selection change does not repeat them. */
    let lastNotified = null;
    const status = el('div', { class: 're-status', role: 'alert' });
    const pane = el('section', { class: 're-pane' });
    const xmlPanel = createXmlPanel({
        xml: () => serialize(state.model),
        onImport: (next) => replaceModel(next, true),
    });
    const menu = createMenu({
        root,
        state,
        inline: (input) => (input === bar.input ? { container: bar.element, before: bar.line } : null),
        cellInputOf: (input) => (input === bar.input ? bar.selectedInput() : input),
    });
    const bar = createBar({ state, pane, menu, messageFor });
    const cells = createCells({ state, menu, bar, refresh });
    const rail = createRail({ state, pane, render, renderSelected });
    const sheets = createSheets({ state, pane, uid, cells, bar, rail, render, refresh });
    // ---- validation + change notification (runs once per committed change) ----
    function refresh() {
        if (state.batching)
            return;
        const issues = validateIssues(state.model);
        const errs = computeErrors(issues);
        status.replaceChildren();
        const fileLevel = issues.filter((i) => i.rule === undefined).map((i) => i.message);
        if (state.parseError)
            fileLevel.unshift(state.parseError);
        status.className = fileLevel.length ? 're-status is-error' : 're-status';
        status.textContent = fileLevel.join(' ');
        markFields(issues);
        rail.mark(issues);
        sheets.updatePreviews();
        const xml = serialize(state.model);
        xmlPanel.sync(xml);
        xmlPanel.gate(errs.length);
        // onChange still carries the xml while invalid, so a host can autosave a draft.
        const notified = `${xml}\u0000${errs.join('\n')}`;
        if (notified === lastNotified)
            return;
        lastNotified = notified;
        opts.onChange?.({ model: clone(state.model), xml, errors: errs });
    }
    /**
     * Put each issue on the input it belongs to. Runs on every refresh, not only
     * on a re-render, so a mark clears as soon as the field is fixed.
     */
    function markFields(issues) {
        const byLoc = new Map();
        for (const issue of issues) {
            if (issue.rule === undefined)
                continue; // whole-file issue: status line only
            const key = locKey(issue);
            const found = byLoc.get(key);
            if (found)
                found.push(issue.message);
            else
                byLoc.set(key, [issue.message]);
        }
        for (const node of Array.from(pane.querySelectorAll('[data-loc]'))) {
            const loc = node.dataset.loc ?? '';
            const messages = byLoc.get(loc);
            node.classList.toggle('is-invalid', messages !== undefined);
            // The message is text on the page, not a tooltip: touch has no hover.
            // A cell's message goes inside the cell, under its value, like a hint
            // under a form field; the row grows with it and the grid stays whole.
            const shown = messageFor(node);
            if (messages) {
                node.title = messages.join(' ');
                const p = shown ?? node.appendChild(el('p', { class: 're-msg', 'data-for': loc }));
                p.textContent = messages.map(shortMessage).join(' ');
            }
            else {
                node.removeAttribute('title');
                shown?.remove();
            }
        }
    }
    /** The message element shown for a marked node, or null. */
    function messageFor(node) {
        const loc = node.dataset.loc ?? '';
        const found = Array.from(node.children).find((c) => c.classList.contains('re-msg') && c.dataset.for === loc);
        return found ?? null;
    }
    // ---- width: the phone model below 560px ----
    /**
     * In narrow mode the in-cell inputs are display only: read-only and out of
     * the tab order, so neither a tap nor Safari's form-navigation arrows can
     * focus one (a focused 13px field makes iOS zoom the page). The bar edits.
     */
    function lockCells() {
        for (const input of Array.from(pane.querySelectorAll('.re-cell input'))) {
            input.readOnly = state.narrow;
            input.tabIndex = state.narrow ? -1 : 0;
        }
    }
    function setNarrow(v) {
        if (v === state.narrow)
            return;
        state.narrow = v;
        // A cell being typed into when the width crosses the line commits first,
        // so its draft is not stranded in an input that is about to be locked.
        const active = document.activeElement;
        if (v && active instanceof HTMLInputElement && active.closest('.re-cell') && pane.contains(active))
            active.blur();
        lockCells();
        sheets.applyVisibility();
        if (v)
            bar.update();
        else
            bar.clear();
    }
    /** Read the container width and set the width classes; 0 (not in the DOM yet) changes nothing. */
    const measure = () => {
        const width = root.clientWidth;
        if (width <= 0)
            return;
        for (const [cls, max] of WIDTH_CLASSES)
            root.classList.toggle(cls, width <= max);
        setNarrow(width <= 560);
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resizeObserver?.observe(root);
    // ---- render ----
    /** Rebuild everything: the rail and the pane. For structural changes. */
    function render() {
        beginRender();
        rail.render();
        endRender();
    }
    /** Rebuild the pane only; the rail keeps its rows. For a change of selection. */
    function renderSelected() {
        beginRender();
        endRender();
    }
    function beginRender() {
        // A draft in the bar survives a structural change (Add, Delete) by being
        // committed first. Its own refresh is skipped: endRender runs one. The
        // width check is inside the batch too: crossing 560px also commits.
        state.batching = true;
        measure();
        bar.commit();
        state.batching = false;
        bar.reset();
    }
    function endRender() {
        sheets.render();
        lockCells();
        refresh();
        if (!state.focusNext)
            return;
        const target = pane.querySelector(`[data-loc="${state.focusNext}"]`);
        state.focusNext = null;
        if (!target)
            return;
        if (state.narrow && target.classList.contains('re-cell')) {
            const sheet = target.closest('.re-sheet-block')?.dataset.sheet;
            if (sheet) {
                state.activeSheet = sheet;
                sheets.applyVisibility();
            }
            bar.select(target);
            // The row came from a tap on Add, so the keyboard may open right away.
            bar.input.focus();
        }
        else {
            target.querySelector('input')?.focus();
        }
    }
    /** Swap in a new file; `first` shows its first rule, else the selection is kept when it still exists. */
    function replaceModel(next, first = false) {
        state.parseError = null;
        state.model = next;
        if (first || state.selected >= next.rules.length)
            state.selected = 0;
        render();
    }
    // ---- top bar + layout ----
    const top = el('div', { class: 're-top' }, [
        el('span', { class: 're-title' }, ['Rules']),
        el('div', { class: 're-top-actions' }, [
            el('button', { class: 're-btn', type: 'button', onclick: () => xmlPanel.toggle() }, ['XML']),
            ...(opts.onSimulate ? [el('button', { class: 're-btn', type: 'button', onclick: () => opts.onSimulate?.(state.selected) }, ['Simulator'])] : []),
            el('button', { class: 're-btn-primary', type: 'button', onclick: () => {
                    state.parseError = null;
                    state.model.rules.push({ name: 'new-rule', variables: [], match: 'any', conditions: [{ expr: '' }], actions: [], incident: null });
                    state.selected = state.model.rules.length - 1;
                    state.focusNext = locKey({ rule: state.selected, field: 'name' });
                    render();
                } }, ['Add rule']),
        ]),
    ]);
    root.replaceChildren(top, status, xmlPanel.element, el('div', { class: 're-body' }, [rail.element, pane]), bar.element, menu.element);
    render();
    return {
        getModel: () => clone(state.model),
        getXml: () => serialize(state.model),
        getErrors: () => computeErrors(),
        setModel: (m) => replaceModel(clone(m)),
        refreshValues: cells.refreshValues,
        setMonitor: (m) => { state.monitor = m; cells.refreshValues(); },
        setCatalog: (c) => { state.catalog = c; menu.close(); },
        setXml: (xml) => {
            try {
                replaceModel(parse(xml));
                return computeErrors();
            }
            catch (e) {
                return [parseErrorText(e)];
            }
        },
        destroy: () => {
            resizeObserver?.disconnect();
            bar.destroy();
            menu.destroy();
            root.replaceChildren();
            root.classList.remove('re-root', ...WIDTH_CLASSES.map(([cls]) => cls));
        },
    };
}
// ---- the Simulator page and its core ----
export { initSimulator, parseSeconds } from './gui/simulator.js';
export { simulate, ruleTags, tagKey, parseSignal, signalAt, evaluateAt, parseGoDuration, formatValue, formatSeconds, SIGNALS } from './simulate.js';
// ---- re-exports: one entry for the editor + the core ---------------------
export { serialize } from './serialize.js';
export { parse, validate, validateIssues, RulesParseError } from './parse.js';
export { FUNCTIONS, RESERVED_NAMES, CONTEXT_NAMES, FormulaError, parseFormula, printFormula, formulaTokens, formulaRefs, inferType, checkFunctions, functionSpec, legacyCondToFormula, isFormula, formulaBody, quoteString, } from './formula.js';
export { tagContext, tagChoices, applyTagChoice, nameContext, nameChoices, applyNameChoice } from './catalog.js';
export { OPERATORS, SEVERITIES, EDGES, MATCHES, VALUELESS_OPS, OP_ALIASES, LIMITS, COOLDOWN_PATTERN, COOLDOWN_RE, VARIABLE_NAME_PATTERN, VARIABLE_NAME_RE, canonicalOp, } from './model.js';
//# sourceMappingURL=gui.js.map