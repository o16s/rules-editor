// The Simulator page (design 14a). Every tag the rule reads gets a row with a
// signal formula (HOLD, STEP, RAMP, PULSE, SINE), so a fault can be staged
// without touching the plant. The timeline is a tree: each condition opens to
// the variables it reads, each variable to its tags, every level drawn against
// the same clock with its value at the cursor. A log lists what happened.
// Nothing here is written to the gateway.
import { formulaRefs, formulaTokens, parseFormula } from '../formula.js';
import { el, identifierAttrs } from './dom.js';
import { formatSeconds, formatValue, parseGoDuration, ruleTags, simulate, tagKey } from '../simulate.js';
const safeParse = (text) => { try {
    return parseFormula(text);
}
catch {
    return null;
} };
const COMPARISONS = new Set(['<', '<=', '>', '>=', '=', '!=']);
/** The constants each variable and tag is compared with, keyed by name or tag key. */
function thresholds(rule) {
    const out = new Map();
    const add = (key, n) => { const list = out.get(key) ?? []; if (!list.includes(n))
        list.push(n); out.set(key, list); };
    const keyOf = (n) => {
        if (n.kind === 'ref')
            return n.name;
        if (n.kind === 'call' && n.name === 'TAG' && n.args.every((a) => a.kind === 'string')) {
            const refs = formulaRefs(n).tags[0];
            return refs ? tagKey(refs) : null;
        }
        return null;
    };
    const walk = (n) => {
        if (n.kind === 'binary') {
            if (COMPARISONS.has(n.op)) {
                const l = keyOf(n.left), r = keyOf(n.right);
                if (l && n.right.kind === 'number')
                    add(l, n.right.value);
                if (r && n.left.kind === 'number')
                    add(r, n.left.value);
            }
            walk(n.left);
            walk(n.right);
        }
        else if (n.kind === 'call')
            n.args.forEach(walk);
        else if (n.kind === 'unary')
            walk(n.arg);
    };
    for (const c of rule.conditions) {
        const ast = safeParse(c.expr);
        if (ast)
            walk(ast);
    }
    for (const v of rule.variables) {
        const ast = safeParse(v.formula);
        if (ast)
            walk(ast);
    }
    return out;
}
const MAX_DEPTH = 8;
export function initSimulator(root, opts) {
    injectStyles();
    root.classList.add('rs-root');
    let rule = opts.rule;
    const state = {
        signals: { ...(opts.signals ?? {}) },
        stop: opts.stop ?? 600,
        step: opts.step ?? 1,
        cursor: opts.cursor ?? -1,
    };
    const catalog = () => (typeof opts.catalog === 'function' ? opts.catalog() : opts.catalog ?? null);
    /** The catalog entry for a tag, for its unit and its value. */
    const entryOf = (key) => {
        const cat = catalog();
        if (!cat)
            return null;
        for (const d of cat.devices)
            for (const t of d.tags)
                if (tagKey({ device: d.device, tag: t.tag }) === key)
                    return t;
        return null;
    };
    /** A tag with no signal yet holds what the catalog reads for it. */
    function defaultSignals() {
        for (const ref of ruleTags(rule)) {
            const key = tagKey(ref);
            if (state.signals[key] !== undefined)
                continue;
            const value = entryOf(key)?.value;
            if (value === undefined)
                continue;
            const n = Number(value.replace(/\s/g, ''));
            state.signals[key] = value === 'true' || value === 'false' ? `HOLD(${value})` : Number.isFinite(n) && value.trim() !== '' ? `HOLD(${n})` : `HOLD("${value.replace(/"/g, '""')}")`;
        }
    }
    let sim = simulate(rule, { stop: 0, step: 1, signals: {} });
    /** Which tree nodes are open. Everything starts open, so the dependency chain shows. */
    const closed = new Set();
    // ---- header ----
    const backBtn = el('button', { class: 'rs-back', type: 'button', onclick: () => opts.onBack?.() }, [`← ${rule.name || 'unnamed'}`]);
    backBtn.hidden = !opts.onBack;
    const stopInput = numberInput(() => formatSeconds(state.stop), (v) => { if (v > 0) {
        state.stop = v;
        run();
    } }, 'Stop time');
    const stepInput = numberInput(() => formatSeconds(state.step), (v) => { if (v > 0) {
        state.step = v;
        run();
    } }, 'Max step');
    const cursorOut = el('span', { class: 'rs-readout', 'aria-label': 'Cursor' });
    const runBtn = el('button', { class: 'rs-run', type: 'button', onclick: () => run() }, ['Run']);
    const top = el('div', { class: 'rs-top' }, [
        el('div', { class: 'rs-top-left' }, [backBtn, el('span', { class: 'rs-title' }, ['Simulator'])]),
        el('div', { class: 'rs-controls' }, [
            el('label', { class: 'rs-control' }, ['Stop time', stopInput]),
            el('label', { class: 'rs-control' }, ['Max step', stepInput]),
            el('span', { class: 'rs-control' }, ['Cursor', cursorOut]),
            runBtn,
        ]),
    ]);
    /** A seconds field: "600 s", "600", or a Go duration like "10m". Commits on Enter or blur; Escape restores. */
    function numberInput(read, commit, label) {
        const input = identifierAttrs(el('input', { type: 'text', class: 'rs-num', 'aria-label': label, autocomplete: 'off' }));
        input.value = read();
        const done = () => {
            const v = parseSeconds(input.value);
            if (v !== null)
                commit(v);
            input.value = read();
        };
        input.addEventListener('change', done);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                done();
                input.blur();
            }
            else if (e.key === 'Escape') {
                input.value = read();
                input.blur();
            }
        });
        return input;
    }
    // ---- tags sheet ----
    const tagsSheet = el('div', { class: 'rs-sheet rs-tags' });
    function renderTags() {
        tagsSheet.replaceChildren(el('div', { class: 'rs-head' }, [el('span'), el('span', {}, ['Tag formula']), el('span', {}, ['Signal formula'])]));
        sim.tags.forEach((series, i) => {
            const key = series.key;
            const text = state.signals[key] ?? '';
            let view = formulaView(text);
            const input = identifierAttrs(el('input', { type: 'text', value: text, 'aria-label': `Signal of ${key}`, placeholder: 'HOLD(0)', autocomplete: 'off' }));
            let committed = text;
            const commit = () => {
                const raw = input.value.startsWith('=') ? input.value.slice(1) : input.value;
                if (raw !== input.value)
                    input.value = raw;
                if (raw === committed)
                    return;
                committed = raw;
                state.signals[key] = raw;
                run();
            };
            input.addEventListener('input', () => { const next = formulaView(input.value); view.replaceWith(next); view = next; });
            input.addEventListener('change', commit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    commit();
                    input.blur();
                }
                else if (e.key === 'Escape') {
                    input.value = committed;
                    input.dispatchEvent(new Event('input'));
                    input.blur();
                }
            });
            const body = el('div', { class: 'rs-cell-body' }, [view, input]);
            const cell = el('div', { class: `rs-cell rs-cell-signal${series.error ? ' is-invalid' : ''}` }, [body]);
            if (series.error)
                cell.append(el('p', { class: 'rs-msg' }, [series.error]));
            tagsSheet.append(el('div', { class: 'rs-row' }, [
                el('span', { class: 'rs-gutter' }, [String(i + 1)]),
                el('div', { class: 'rs-cell rs-cell-formula' }, [formulaView(`TAG(${series.ref.device ? `"${series.ref.device}", ` : ''}"${series.ref.tag}")`)]),
                cell,
            ]));
        });
        if (sim.tags.length === 0)
            tagsSheet.append(el('div', { class: 'rs-row rs-row-empty' }, [el('span', { class: 'rs-gutter' }), el('span', { class: 'rs-empty' }, ['This rule reads no tags yet.'])]));
    }
    /** The coloured, read-only view of a formula with the = prefix. */
    function formulaView(text) {
        const view = el('span', { class: 'rs-formula-view', 'aria-hidden': 'true' });
        if (text === '')
            return view;
        view.append('=');
        for (const t of formulaTokens(text))
            view.append(el('span', { class: `re-tok-${t.kind}` }, [t.text]));
        return view;
    }
    // ---- timeline ----
    const treeHead = el('div', { class: 'rs-head rs-tl-head' });
    const tree = el('div', { class: 'rs-tree' });
    const cursorLine = el('div', { class: 'rs-cursor', 'aria-hidden': 'true' });
    const fireLayer = el('div', { class: 'rs-fires', 'aria-hidden': 'true' });
    const timeline = el('div', { class: 'rs-timeline' }, [treeHead, tree, fireLayer, cursorLine]);
    const atLabel = el('span', { class: 'rs-at' });
    /** The value cell of every lane, re-read when the cursor moves. */
    const valueCells = [];
    function buildTree() {
        const limits = thresholds(rule);
        const varSeries = new Map(sim.variables.map((v) => [v.name, v.values]));
        const tagSeries = new Map(sim.tags.map((t) => [t.key, t]));
        const varAst = new Map(rule.variables.map((v) => [v.name, safeParse(v.formula)]));
        const unitOf = (ast, seen = new Set()) => {
            if (!ast)
                return undefined;
            if (ast.kind === 'call' && ast.name === 'TAG') {
                const ref = formulaRefs(ast).tags[0];
                return ref ? entryOf(tagKey(ref))?.unit : undefined;
            }
            if (ast.kind === 'call' && ast.name === 'RATE' && ast.args[0]) {
                const u = unitOf(ast.args[0], seen);
                return u ? `${u}/h` : undefined;
            }
            if (ast.kind === 'call' && ast.name === 'AVG' && ast.args[0])
                return unitOf(ast.args[0], seen);
            if (ast.kind === 'ref' && !seen.has(ast.name)) {
                seen.add(ast.name);
                return unitOf(varAst.get(ast.name) ?? null, seen);
            }
            return undefined;
        };
        const children = (ast, parent, depth, path) => {
            if (!ast || depth > MAX_DEPTH)
                return [];
            const refs = formulaRefs(ast);
            const out = [];
            for (const name of refs.variables) {
                if (path.has(name))
                    continue; // a cycle: validation reports it
                const id = `${parent}/v:${name}`;
                const vAst = varAst.get(name) ?? null;
                out.push({
                    kind: 'variable', id, label: name, formula: false, depth,
                    series: varSeries.get(name) ?? sim.times.map(() => null),
                    unit: unitOf(vAst), thresholds: limits.get(name) ?? [],
                    children: children(vAst, id, depth + 1, new Set([...path, name])),
                });
            }
            for (const ref of refs.tags) {
                const key = tagKey(ref);
                out.push({
                    kind: 'tag', id: `${parent}/t:${key}`, depth, formula: true,
                    label: `TAG(${ref.device ? `"${ref.device}", ` : ''}"${ref.tag}")`,
                    series: tagSeries.get(key)?.values ?? sim.times.map(() => null),
                    unit: entryOf(key)?.unit, thresholds: limits.get(key) ?? [], children: [],
                });
            }
            return out;
        };
        return rule.conditions.map((c, k) => {
            const id = `c:${k}`;
            return {
                kind: 'condition', id, label: c.expr, formula: true, depth: 0,
                series: sim.conditions[k]?.values ?? [], thresholds: [],
                children: children(safeParse(c.expr), id, 1, new Set()),
            };
        });
    }
    /** Tick intervals on the clock: fewer on a phone, where the lanes are short. */
    const tickCount = () => (root.classList.contains('is-narrow') ? 2 : root.classList.contains('is-medium') ? 4 : 5);
    function renderTimeline() {
        const ticks = tickCount();
        const axis = el('div', { class: 'rs-ticks' });
        for (let k = 0; k <= ticks; k++) {
            const tick = el('span', { class: `rs-tick${k === 0 ? ' is-first' : k === ticks ? ' is-last' : ''}` }, [formatSeconds((state.stop * k) / ticks)]);
            tick.style.left = `${(100 * k) / ticks}%`;
            axis.append(tick);
        }
        atLabel.textContent = `At ${formatSeconds(state.cursor)}`;
        treeHead.replaceChildren(el('span', {}, ['Condition › variable › tag']), atLabel, el('span'), axis);
        ticksDrawn = ticks;
        tree.replaceChildren();
        valueCells.length = 0;
        const nodes = buildTree();
        if (nodes.length === 0)
            tree.append(el('div', { class: 'rs-lane rs-lane-empty' }, [el('span', { class: 'rs-empty' }, ['This rule has no condition yet.'])]));
        const draw = (node, first) => {
            const lane = el('div', { class: `rs-lane is-${node.kind}${first ? ' is-first' : ''}` });
            const caret = el('span', { class: 'rs-caret' }, [node.children.length ? (closed.has(node.id) ? '▸' : '▾') : '']);
            const label = el('button', { class: 'rs-label', type: 'button', 'aria-expanded': String(!closed.has(node.id)) }, [
                caret,
                node.formula ? formulaView(node.label) : el('span', { class: 'rs-name' }, [node.label]),
            ]);
            label.style.paddingLeft = `${9 + node.depth * 14}px`;
            if (node.children.length)
                label.addEventListener('click', () => { if (closed.has(node.id))
                    closed.delete(node.id);
                else
                    closed.add(node.id); renderTimeline(); });
            else
                label.disabled = true;
            const value = el('span', { class: 'rs-value' });
            valueCells.push({ cell: value, node });
            const numbers = node.series.filter((v) => typeof v === 'number');
            const analog = numbers.length > 0 && node.series.every((v) => typeof v === 'number' || v === null);
            const axisCol = el('span', { class: 'rs-axis' });
            const plot = el('div', { class: 'rs-plot' });
            plot.append(gridSvg(analog ? { numbers, node, axisCol } : null, node, ticks));
            if (!analog)
                for (const band of bands(node))
                    plot.append(band);
            lane.append(label, value, axisCol, plot);
            tree.append(lane);
            if (!closed.has(node.id))
                node.children.forEach((c) => draw(c, false));
        };
        nodes.forEach((n, i) => draw(n, i === 0));
        // Fire markers, dashed, across every lane.
        fireLayer.replaceChildren(...sim.fires.map((t) => { const m = el('div', { class: 'rs-fire' }); m.style.setProperty('--rs-frac', String(state.stop ? t / state.stop : 0)); return m; }));
        updateCursor();
    }
    const W = 1000, H = 36, PAD = 6;
    /** The lane's SVG: gridlines at the ticks, and for an analog lane the trace and its thresholds. */
    function gridSvg(analog, node, ticks) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        const line = (x1, y1, x2, y2, cls) => {
            const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            l.setAttribute('x1', String(x1));
            l.setAttribute('y1', String(y1));
            l.setAttribute('x2', String(x2));
            l.setAttribute('y2', String(y2));
            l.setAttribute('class', cls);
            l.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.append(l);
        };
        for (let k = 1; k < ticks; k++)
            line((W * k) / ticks, 0, (W * k) / ticks, H, 'rs-grid');
        if (!analog)
            return svg;
        let min = Math.min(...analog.numbers, ...node.thresholds);
        let max = Math.max(...analog.numbers, ...node.thresholds);
        if (max === min) {
            const pad = Math.abs(max) * 0.1 || 1;
            min -= pad;
            max += pad;
        }
        const y = (v) => PAD + ((max - v) / (max - min)) * (H - 2 * PAD);
        for (const t of node.thresholds)
            line(0, y(t), W, y(t), 'rs-threshold');
        const n = node.series.length;
        const stride = Math.max(1, Math.ceil(n / 2000));
        let d = '';
        let pen = false;
        for (let i = 0; i < n; i += stride) {
            const v = node.series[i];
            if (typeof v !== 'number') {
                pen = false;
                continue;
            }
            const x = n > 1 ? (W * i) / (n - 1) : 0;
            d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y(v).toFixed(2)} `;
            pen = true;
        }
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d.trim());
        path.setAttribute('class', 'rs-trace');
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(path);
        analog.axisCol.replaceChildren(el('span', {}, [formatValue(max, node.unit)]), el('span', {}, [formatValue(min, node.unit)]));
        return svg;
    }
    /** Foxglove-style state bands for a discrete lane: one labelled band per run of equal values. */
    function bands(node) {
        const n = node.series.length;
        if (n === 0)
            return [];
        const out = [];
        let start = 0;
        const label = (v) => formatValue(v, node.unit);
        for (let i = 1; i <= n; i++) {
            if (i < n && label(node.series[i]) === label(node.series[start]))
                continue;
            const v = node.series[start];
            const denom = Math.max(1, n - 1);
            // A short band has no room for its text; the title still carries it.
            const wide = (i - start) / denom >= 0.08;
            const band = el('span', { class: `rs-band${v === true ? ' is-on' : v === null ? ' is-null' : ''}`, title: label(v) }, wide ? [label(v)] : []);
            band.style.left = `${(100 * start) / denom}%`;
            band.style.width = `${(100 * (i - start)) / denom}%`;
            out.push(band);
            start = i;
        }
        return out;
    }
    function updateCursor() {
        const i = state.step > 0 ? Math.min(sim.times.length - 1, Math.max(0, Math.round(state.cursor / state.step))) : 0;
        cursorOut.textContent = formatSeconds(state.cursor);
        atLabel.textContent = `At ${formatSeconds(state.cursor)}`;
        timeline.style.setProperty('--rs-frac', String(state.stop ? state.cursor / state.stop : 0));
        for (const { cell, node } of valueCells)
            cell.textContent = formatValue(node.series[i] ?? null, node.unit);
    }
    function setCursor(seconds) {
        const snapped = Math.round(Math.min(Math.max(seconds, 0), state.stop) / state.step) * state.step;
        if (snapped === state.cursor)
            return;
        state.cursor = Number(snapped.toFixed(6));
        updateCursor();
        opts.onChange?.(getState(), sim);
    }
    // Click or drag on the lanes moves the cursor.
    let dragging = false;
    const cursorFromEvent = (e) => {
        const plot = tree.querySelector('.rs-plot');
        if (!plot)
            return;
        const r = plot.getBoundingClientRect();
        if (r.width <= 0)
            return;
        setCursor(((e.clientX - r.left) / r.width) * state.stop);
    };
    tree.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.rs-label'))
            return;
        // A drag moves the cursor; it must not start a text selection across the rows.
        if (e.pointerType === 'mouse')
            e.preventDefault();
        dragging = true;
        tree.setPointerCapture?.(e.pointerId);
        cursorFromEvent(e);
    });
    tree.addEventListener('pointermove', (e) => { if (dragging)
        cursorFromEvent(e); });
    const stopDrag = () => { dragging = false; };
    tree.addEventListener('pointerup', stopDrag);
    tree.addEventListener('pointercancel', stopDrag);
    // ---- log ----
    const logSheet = el('div', { class: 'rs-sheet rs-log' });
    function renderLog() {
        logSheet.replaceChildren(el('div', { class: 'rs-head' }, [el('span', {}, ['Time']), el('span', {}, ['Event'])]));
        if (sim.log.length === 0)
            logSheet.append(el('div', { class: 'rs-row' }, [el('span', { class: 'rs-time' }), el('span', { class: 'rs-event rs-empty' }, ['Nothing happened in this run.'])]));
        for (const entry of sim.log) {
            const row = el('div', { class: `rs-row${entry.fired ? ' is-fired' : ''}` }, [
                el('span', { class: 'rs-time' }, [formatSeconds(entry.t)]),
                el('span', { class: 'rs-event' }, entry.fired ? [el('strong', {}, ['Fired.']), entry.text.slice('Fired.'.length)] : [entry.text]),
            ]);
            logSheet.append(row);
        }
    }
    // ---- run ----
    function run() {
        defaultSignals();
        sim = simulate(rule, { stop: state.stop, step: state.step, signals: state.signals });
        if (state.cursor < 0 || state.cursor > state.stop)
            state.cursor = sim.fires[0] ?? Math.round(state.stop / 2 / state.step) * state.step;
        stopInput.value = formatSeconds(state.stop);
        stepInput.value = formatSeconds(state.step);
        backBtn.textContent = `← ${rule.name || 'unnamed'}`;
        renderTags();
        renderTimeline();
        renderLog();
        opts.onChange?.(getState(), sim);
        return sim;
    }
    const getState = () => ({ ...state, signals: { ...state.signals } });
    // ---- layout ----
    const main = el('div', { class: 'rs-main' }, [el('h2', { class: 'rs-section' }, ['Tags']), tagsSheet, timeline]);
    const side = el('div', { class: 'rs-side' }, [el('h2', { class: 'rs-section' }, ['Log']), logSheet]);
    root.replaceChildren(top, el('div', { class: 'rs-body' }, [main, side]));
    let ticksDrawn = 0;
    const measure = () => {
        const width = root.clientWidth;
        if (width <= 0)
            return;
        root.classList.toggle('is-medium', width <= 900);
        root.classList.toggle('is-narrow', width <= 560);
        // The clock has fewer ticks on a phone: redraw when the width crosses a line.
        if (ticksDrawn && tickCount() !== ticksDrawn)
            renderTimeline();
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resizeObserver?.observe(root);
    measure();
    run();
    return {
        run,
        getSimulation: () => sim,
        getState,
        setRule: (next) => {
            rule = next;
            const keep = new Set(ruleTags(rule).map(tagKey));
            for (const key of Object.keys(state.signals))
                if (!keep.has(key))
                    delete state.signals[key];
            run();
        },
        setCursor,
        destroy: () => {
            resizeObserver?.disconnect();
            root.replaceChildren();
            root.classList.remove('rs-root', 'is-medium', 'is-narrow');
        },
    };
}
/** Seconds from "600 s", "600", "2.5", or a Go duration such as "10m" or "1m30s". */
export function parseSeconds(text) {
    const t = text.trim().replace(/\s+/g, '');
    if (t === '')
        return null;
    if (/^\d+(\.\d+)?s?$/.test(t))
        return Number(t.replace(/s$/, ''));
    return parseGoDuration(t);
}
// ---- styles -----------------------------------------------------------------
const STYLE_ID = 'octaview-rules-simulator-styles';
const STYLES = `
.rs-root {
  --re-accent: var(--accent, #b8460f);
  --re-ink: var(--ink, #1b1a17);
  --re-text: var(--gray-700, #3b3934);
  --re-muted: var(--gray-500, #6a6660);
  --re-line: var(--gray-200, #ddd9d2);
  --re-grid: var(--grid, #efece7);
  --re-head: var(--sheet-head, #f2efe9);
  --re-paper: var(--bg, #faf9f6);
  --re-surface: var(--surface, #ffffff);
  --re-result: var(--sheet-result, #f7f6f2);
  --re-reading: var(--reading, #3b5570);
  --re-critical: var(--incident, #a32c1e);
  --re-warn: var(--warning, #8a5a00);
  --re-warn-wash: #fbf3e0;
  --re-font: var(--font-body, "Helvetica Neue", Helvetica, Arial, sans-serif);
  --rs-band-on: color-mix(in srgb, var(--re-reading) 22%, var(--re-surface));
  --rs-band-off: color-mix(in srgb, var(--re-muted) 12%, var(--re-surface));
  --rs-label-w: 340px; --rs-value-w: 84px; --rs-axis-w: 54px;
  --rs-plot-left: calc(var(--rs-label-w) + var(--rs-value-w) + var(--rs-axis-w));
  font-family: var(--re-font); color: var(--re-ink); font-size: 13px; line-height: 1.45;
  background: var(--re-surface); border: 1px solid var(--re-line); border-radius: 4px; overflow: hidden;
}
.rs-root *, .rs-root *::before, .rs-root *::after { box-sizing: border-box; }
.rs-root button, .rs-root input { font-family: inherit; }
.rs-top { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:11px 15px; border-bottom:1px solid var(--re-line); background:var(--re-paper); }
.rs-top-left { display:flex; align-items:baseline; gap:10px; min-width:0; }
.rs-back { font-size:13px; color:var(--re-accent); background:none; border:none; padding:0; cursor:pointer; white-space:nowrap; }
.rs-title { font-size:15px; font-weight:500; }
.rs-controls { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.rs-control { display:inline-flex; align-items:center; gap:7px; font-size:12px; color:var(--re-muted); }
.rs-num, .rs-readout { font-size:13px; color:var(--re-ink); background:var(--re-surface); border:1px solid var(--re-line); border-radius:3px; padding:4px 8px; min-width:52px; width:5.5em; font-variant-numeric:tabular-nums; }
.rs-num:focus { outline:2px solid var(--re-reading); outline-offset:-2px; }
.rs-readout { color:var(--re-reading); background:var(--re-result); border-color:var(--re-grid); display:inline-block; text-align:left; }
.rs-run { font-size:12px; font-weight:500; color:#fff; background:var(--re-accent); border:1px solid var(--re-accent); border-radius:3px; padding:5px 13px; cursor:pointer; }
.rs-body { display:grid; grid-template-columns:minmax(0,1fr) 330px; gap:18px; padding:16px 18px 18px; }
.rs-main, .rs-side { display:flex; flex-direction:column; gap:8px; min-width:0; }
.rs-main > .rs-timeline { margin-top:8px; }
.rs-section { margin:0; font-size:15px; font-weight:400; color:var(--re-muted); }
.rs-sheet, .rs-timeline { border:1px solid var(--re-line); border-radius:3px; overflow:hidden; background:var(--re-surface); }
.rs-head { display:grid; background:var(--re-head); border-bottom:1px solid var(--re-line); }
.rs-head > span { font-size:12px; color:var(--re-muted); padding:6px 9px; border-right:1px solid var(--re-grid); white-space:nowrap; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.rs-head > span:last-child { border-right:none; }
.rs-row { display:grid; border-bottom:1px solid var(--re-grid); }
.rs-row:last-child { border-bottom:none; }
.rs-gutter { font-size:12px; color:var(--re-muted); padding:7px 8px; text-align:center; background:var(--re-head); border-right:1px solid var(--re-grid); }
.rs-tags .rs-head, .rs-tags .rs-row { grid-template-columns:30px 250px minmax(0,1fr); }
.rs-tags .rs-head > span:first-child { padding:0; }
.rs-cell { position:relative; display:flex; flex-direction:column; min-width:0; border-right:1px solid var(--re-grid); }
.rs-cell:last-child { border-right:none; }
.rs-cell-body { position:relative; flex:1 1 auto; }
.rs-formula-view { display:block; min-height:32px; padding:7px 9px; white-space:pre-wrap; overflow-wrap:anywhere; pointer-events:none; }
.rs-cell-formula .rs-formula-view { color:var(--re-text); }
.rs-cell-signal input { position:absolute; inset:0; width:100%; border:none; background:none; padding:7px 9px; font-size:13px; color:transparent; caret-color:var(--re-ink); }
.rs-cell-signal input:focus { outline:2px solid var(--re-reading); outline-offset:-2px; color:var(--re-ink); background:var(--re-surface); }
.rs-cell-signal:focus-within .rs-formula-view { visibility:hidden; }
.rs-cell.is-invalid { background:var(--re-warn-wash); }
.rs-msg { margin:0; padding:0 9px 7px; font-size:12px; line-height:1.45; color:var(--re-warn); overflow-wrap:anywhere; }
.rs-empty { padding:7px 9px; color:var(--re-muted); }
.rs-root .re-tok-function { color:var(--re-muted); }
.rs-root .re-tok-string, .rs-root .re-tok-context { color:var(--re-reading); }
.rs-root .re-tok-error { color:var(--re-critical); text-decoration:underline wavy; }
/* timeline */
.rs-timeline { position:relative; }
.rs-tl-head, .rs-lane { grid-template-columns:var(--rs-label-w) var(--rs-value-w) var(--rs-axis-w) minmax(0,1fr); }
.rs-tl-head { display:grid; }
.rs-tl-head > span:first-child, .rs-tl-head > span:nth-child(3) { border-right:none; }
.rs-ticks { position:relative; height:24px; overflow:hidden; }
.rs-tick { position:absolute; top:6px; transform:translateX(-50%); font-size:11px; color:var(--re-muted); white-space:nowrap; }
.rs-tick.is-first { transform:translateX(4px); }
.rs-tick.is-last { transform:translateX(calc(-100% - 4px)); }
/* The lanes are a scrub surface: no text selection while the cursor is dragged. */
.rs-tree, .rs-tl-head { user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
.rs-lane { display:grid; align-items:center; border-bottom:1px solid var(--re-grid); }
.rs-lane:last-child { border-bottom:none; }
.rs-lane.is-condition { background:var(--re-paper); }
.rs-lane.is-condition:not(.is-first) { border-top:1px solid var(--re-line); }
.rs-lane-empty { display:block; }
.rs-label { display:flex; align-items:center; gap:6px; min-width:0; height:36px; padding:0 9px; font-size:12.5px; color:var(--re-ink); background:none; border:none; text-align:left; cursor:pointer; overflow:hidden; }
.rs-label:disabled { cursor:default; color:var(--re-muted); }
.rs-label .rs-formula-view { display:inline; min-height:0; padding:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rs-lane.is-condition .rs-label { font-weight:500; }
.rs-lane.is-condition .rs-label .rs-formula-view, .rs-lane.is-condition .rs-label .re-tok-function { color:var(--re-ink); }
.rs-lane.is-tag .rs-label .rs-formula-view { color:var(--re-muted); }
.rs-caret { width:10px; flex:none; font-size:10px; color:var(--re-muted); }
.rs-name { overflow:hidden; text-overflow:ellipsis; }
.rs-value { align-self:stretch; display:flex; align-items:center; padding:0 9px; font-size:12px; color:var(--re-reading); background:var(--re-result); border-right:1px solid var(--re-grid); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rs-axis { align-self:stretch; display:flex; flex-direction:column; justify-content:space-between; padding:3px 6px 3px 0; text-align:right; font-size:10px; line-height:1; color:var(--re-muted); border-right:1px solid var(--re-grid); white-space:nowrap; overflow:hidden; }
.rs-plot { position:relative; height:36px; min-width:0; cursor:col-resize; touch-action:pan-y; }
.rs-plot svg { position:absolute; inset:0; width:100%; height:100%; display:block; }
.rs-grid { stroke:var(--re-grid); stroke-width:1; }
.rs-threshold { stroke:var(--re-reading); stroke-width:1; stroke-dasharray:3 3; }
.rs-trace { fill:none; stroke:var(--re-reading); stroke-width:1.5; stroke-linejoin:round; }
.rs-band { position:absolute; top:6px; bottom:6px; display:flex; align-items:center; padding-left:5px; overflow:hidden; font-size:11px; color:var(--re-muted); background:var(--rs-band-off); border-left:1px solid var(--re-surface); white-space:nowrap; }
.rs-band.is-on { background:var(--rs-band-on); color:var(--re-reading); }
.rs-band.is-null { background:none; }
.rs-cursor, .rs-fire { position:absolute; top:0; bottom:0; width:0; pointer-events:none; left:calc(var(--rs-plot-left) + (100% - var(--rs-plot-left)) * var(--rs-frac, 0)); }
.rs-cursor { border-left:1.5px solid var(--re-accent); }
.rs-fire { border-left:1px dashed var(--re-accent); }
/* log */
.rs-log .rs-head, .rs-log .rs-row { grid-template-columns:70px minmax(0,1fr); }
.rs-time { font-size:13px; color:var(--re-muted); padding:7px 9px; border-right:1px solid var(--re-grid); font-variant-numeric:tabular-nums; white-space:nowrap; }
.rs-event { font-size:13px; color:var(--re-text); padding:7px 9px; overflow-wrap:anywhere; }
.rs-row.is-fired .rs-time, .rs-row.is-fired .rs-event { color:var(--re-ink); }
.rs-event strong { font-weight:500; }
/* widths */
.rs-root.is-medium .rs-body { grid-template-columns:minmax(0,1fr); }
.rs-root.is-medium { --rs-label-w: 200px; --rs-value-w: 72px; --rs-axis-w: 46px; }
.rs-root.is-medium .rs-tags .rs-head, .rs-root.is-medium .rs-tags .rs-row { grid-template-columns:30px minmax(0,1fr) minmax(0,1fr); }
.rs-root.is-narrow { --rs-label-w: 130px; --rs-value-w: 60px; --rs-axis-w: 40px; }
.rs-root.is-narrow .rs-body { padding:12px; gap:12px; }
/* Narrow: the tag formula sits above its signal, both in one row of the sheet. */
.rs-root.is-narrow .rs-tags .rs-head, .rs-root.is-narrow .rs-tags .rs-row { grid-template-columns:30px minmax(0,1fr); }
.rs-root.is-narrow .rs-tags .rs-head > span:nth-child(2) { display:none; }
.rs-root.is-narrow .rs-tags .rs-gutter { grid-row:1 / span 2; }
.rs-root.is-narrow .rs-tags .rs-cell-formula { grid-column:2; border-right:none; border-bottom:1px dashed var(--re-grid); }
.rs-root.is-narrow .rs-tags .rs-cell-formula .rs-formula-view { min-height:0; padding:5px 9px 3px; font-size:12px; }
.rs-root.is-narrow .rs-tags .rs-cell-signal { grid-column:2; }
.rs-root.is-narrow .rs-num { width:4.5em; }
`;
function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
}
//# sourceMappingURL=simulator.js.map