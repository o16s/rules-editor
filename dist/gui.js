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
// / description) and Then (action / field / formula / result) — in the
// spreadsheet style of the design handoff. Colours and fonts read the host's
// design tokens (--accent, --ink, --font-body, …) with fallbacks.
import { LIMITS, SEVERITIES, } from './model.js';
import { serialize } from './serialize.js';
import { parse, validateIssues, RulesParseError } from './parse.js';
import { formulaTokens, isFormula, parseFormula } from './formula.js';
import { applyTagChoice, tagChoices, tagContext } from './catalog.js';
const clone = (v) => JSON.parse(JSON.stringify(v));
/** Editors mounted so far, for unique ids (tabs and their panels). */
let instances = 0;
const locKey = (l) => `${l.rule ?? ''}|${l.field ?? ''}|${l.variable ?? ''}|${l.condition ?? ''}|${l.action ?? ''}`;
function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (typeof v === 'function')
            node.addEventListener(k.replace(/^on/, ''), v);
        else if (k === 'class')
            node.className = String(v);
        else if (v === false)
            continue;
        else
            node.setAttribute(k, String(v));
    }
    for (const c of children)
        node.append(c);
    return node;
}
/** An inline icon from a static path list (never from user input). */
function icon(paths) {
    const span = el('span', { class: 're-icon', 'aria-hidden': 'true' });
    span.innerHTML = `<svg viewBox="0 0 14 14">${paths}</svg>`;
    return span;
}
const ICON_TRASH = '<path d="M2.5 4h9M5.5 4V2.5h3V4M4 4v7.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" fill="none" stroke="currentColor" stroke-width="1.2"/>';
const ICON_COPY = '<rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="4.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/>';
const MATCH_OPTIONS = [
    { value: 'any', label: 'any' },
    { value: 'all', label: 'all' },
];
const EDGE_OPTIONS = [
    { value: 'rising', label: 'becomes true' },
    { value: 'none', label: 'is true' },
];
const EDGE_META = { rising: 'rising edge', none: 'every cycle' };
const ACTION_OPTIONS = [
    { value: 'publish', label: 'Publish MQTT message' },
    ...SEVERITIES.map((s) => ({ value: s, label: `Raise ${s} alarm` })),
];
// Help, one paragraph per sheet, grounded in the documented rules.xml schema.
const HELP = {
    variables: 'One named formula per row. Name: letters, digits and underscores. Formula: TAG("device", "tag") reads a field; RATE(x, 30min), CHANGED(x), BITAND(x, mask), HEX2DEC("FF") and the comparison operators build on it. Formula result: the live value, when the host supplies one. Description: what the value means, for the operator.',
    when: 'One condition per row, written with the variable names, for example temp > 50 or AND(milk_temp > 3.6, door_changed). "any" fires when one row is true, "all" when every row is true. "becomes true" fires once on the false-to-true change; "is true" fires on every cycle while true. Description: quoted by the alarm as condition.description.',
    then: 'One row per field of an action. Publish MQTT message: topic and payload. Raise alarm: source (the device the alarm is attributed to), title (at most 120 characters), first step (what the operator does first) and cause (why it fired, and where the boundary of what we read sits). A field that starts with = is a formula and can use condition.description. Cooldown: a Go duration such as 30s, 1m30s or 500ms; blank fires every time.',
};
function exampleModel() {
    const rule = (r) => ({
        variables: [],
        match: 'any',
        conditions: [],
        actions: [],
        incident: null,
        ...r,
    });
    return {
        rules: [
            rule({
                name: 'alarm-camera',
                cooldown: '45s',
                edge: 'rising',
                variables: [
                    { name: 'alarm_active', formula: 'TAG("plc1", "AlarmActive")', description: 'Cell 3 PLC has set its own alarm bit' },
                    { name: 'temp', formula: 'TAG("vibration1", "temperature")', description: 'Press motor housing temperature' },
                    { name: 'temp_rate', formula: 'RATE(temp, 30min)', description: 'How fast the housing is heating, over 30 min' },
                    { name: 'milk_temp', formula: 'TAG("bulk1", "milk_temperature")', description: 'Bulk tank 1 milk temperature' },
                    { name: 'door_changed', formula: 'CHANGED(TAG("bulk1", "door_state"))', description: 'Bulk tank 1 door opened or closed' },
                    { name: 'status_word', formula: 'TAG("plc1", "StatusWord")', description: 'Cell 3 PLC status register, 16 bits' },
                    { name: 'guard_open', formula: 'BITAND(status_word, 4) != 0', description: 'Bit 2 of the status word: guard door open' },
                    { name: 'in_manual', formula: 'BITAND(status_word, HEX2DEC("10")) != 0', description: 'Bit 4 of the status word: cell in manual mode' },
                    { name: 'alarm_byte', formula: 'TAG("plc1", "AlarmFlags")', description: 'Cell 3 PLC alarm flags, one bit per alarm' },
                    { name: 'any_plc_alarm', formula: 'BITAND(alarm_byte, HEX2DEC("FF")) != 0', description: 'At least one PLC alarm flag is raised' },
                ],
                conditions: [
                    { expr: 'alarm_active', description: 'Cell 3 PLC raised its own alarm' },
                    { expr: 'temp > 50', description: 'Housing above 50 °C' },
                    { expr: 'temp_rate > 4', description: 'Housing heating faster than 4 °C/h' },
                    { expr: 'AND(milk_temp > 3.6, door_changed)', description: 'Milk warm while the tank door moved' },
                    { expr: 'any_plc_alarm', description: 'Cell 3 PLC reports an alarm' },
                ],
                actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
                incident: {
                    source: 'Cell 3 press',
                    severity: 'critical',
                    summary: 'Press guard alarm on cell 3',
                    firstStep: 'Watch the 40 s camera clip before you open the cell.',
                    cause: '=condition.description & ". The press PLC set its own alarm bit. We read that bit and nothing upstream of it, so the reason sits in the PLC."',
                },
            }),
            rule({
                name: 'pump-overtemp',
                cooldown: '60s',
                edge: 'rising',
                variables: [
                    { name: 'vrms_alert', formula: 'TAG("vibration1", "alert_vrms_max")', description: 'Sensor vibration alert bit' },
                    { name: 'temp', formula: 'TAG("vibration1", "temperature")', description: 'Pump housing temperature' },
                ],
                match: 'all',
                conditions: [
                    { expr: 'vrms_alert', description: 'Vibration above the sensor limit' },
                    { expr: 'temp > 50.0', description: 'Housing above 50 °C' },
                ],
                incident: { source: 'vibration1', severity: 'error', summary: 'Pump 1 vibrates while hot', firstStep: 'Stop pump 1 and check the bearing.' },
            }),
            rule({
                name: 'wetwell-highlevel',
                cooldown: '5m',
                edge: 'rising',
                variables: [{ name: 'level', formula: 'TAG("wetwell", "level")', description: 'Wet well level' }],
                conditions: [{ expr: 'level > 3.6', description: 'Wet well above 3.6 m' }],
                actions: [{ topic: 'pumps/start', payload: '{"pump":2}' }],
                incident: { source: 'wetwell', severity: 'critical', summary: 'Wet well high level', firstStep: 'Check that pump 2 started.' },
            }),
            rule({
                name: 'weekly-flow-total',
                variables: [{ name: 'flow', formula: 'TAG("flowmeter1", "total")', description: 'Flow meter totaliser' }],
                conditions: [{ expr: 'CHANGED(flow)', description: 'Totaliser updated' }],
                actions: [{ topic: 'reports/flow', payload: '=flow' }],
            }),
            rule({
                name: 'firmware-updated',
                variables: [{ name: 'version', formula: 'TAG("plc1", "FirmwareVersion")', description: 'PLC firmware version string' }],
                conditions: [{ expr: 'CHANGED(version)', description: 'PLC reports a new firmware version' }],
                actions: [{ topic: 'events/firmware', payload: '=version' }],
            }),
            rule({
                name: 'bulk1-milk-temp',
                cooldown: '10m',
                edge: 'rising',
                variables: [{ name: 'milk_temp', formula: 'TAG("bulk1", "milk_temperature")', description: 'Bulk tank 1 milk temperature' }],
                conditions: [{ expr: 'milk_temp > 4', description: 'Milk above 4 °C' }],
                incident: { source: 'bulk1', severity: 'warning', summary: 'Bulk tank 1 milk too warm', firstStep: 'Check the cooling compressor.' },
            }),
        ],
    };
}
const THEN_LABEL = { topic: 'topic', payload: 'payload', source: 'source', summary: 'title', firstStep: 'first step', cause: 'cause' };
/** The `field` name in a ValidationIssue for each Then field. */
const THEN_ISSUE_FIELD = {
    topic: 'topic', payload: 'payload', source: 'source', summary: 'summary', firstStep: 'first_step', cause: 'cause',
};
function thenRows(rule) {
    const rows = [];
    rule.actions.forEach((_, index) => rows.push({ kind: 'publish', index, field: 'topic' }, { kind: 'publish', index, field: 'payload' }));
    if (rule.incident)
        rows.push({ kind: 'incident', field: 'source' }, { kind: 'incident', field: 'summary' }, { kind: 'incident', field: 'firstStep' }, { kind: 'incident', field: 'cause' });
    return rows;
}
function thenGet(rule, row) {
    if (row.kind === 'publish')
        return rule.actions[row.index][row.field] ?? '';
    return rule.incident?.[row.field] ?? '';
}
function thenSet(rule, row, value) {
    if (row.kind === 'publish') {
        const a = rule.actions[row.index];
        if (row.field === 'topic')
            a.topic = value;
        else if (value)
            a.payload = value;
        else
            delete a.payload;
        return;
    }
    const inc = rule.incident;
    if (row.field === 'source' || row.field === 'summary')
        inc[row.field] = value;
    else if (value)
        inc[row.field] = value;
    else
        delete inc[row.field];
}
/**
 * What a Then field shows as its result: literal text as is; a formula folded
 * as far as constants go, with condition.description read from the first
 * condition as a preview. Anything that needs live data gives null.
 */
function previewThen(text, rule) {
    if (!isFormula(text))
        return text;
    let ast;
    try {
        ast = parseFormula(text);
    }
    catch {
        return null;
    }
    const fold = (n) => {
        switch (n.kind) {
            case 'string': return n.value;
            case 'number': return n.raw;
            case 'bool': return n.value ? 'true' : 'false';
            case 'duration': return n.raw;
            case 'context': return n.name === 'condition.description' ? rule.conditions[0]?.description ?? null : null;
            case 'binary': {
                if (n.op !== '&')
                    return null;
                const l = fold(n.left);
                const r = fold(n.right);
                return l === null || r === null ? null : l + r;
            }
            default: return null;
        }
    };
    return fold(ast);
}
// ---- scoped styles -------------------------------------------------------
const STYLE_ID = 'octaview-rules-editor-styles';
/**
 * Declarations that apply when the editor is narrow. The width that counts is
 * the editor's own container, measured by a ResizeObserver, which sets
 * `is-medium` (900px or less), `is-narrow` (560px or less) and `is-tight`
 * (430px or less) on the root. The CSS keys off those classes only: no media
 * or container query, so the styles and the behaviour (tabs, the formula bar)
 * can never disagree about the width. Below 900px the rail folds into a
 * select above the sheets. Below 560px the phone model applies: one sheet per
 * tab, the sheet scrolls sideways, cells are tapped and edited in the bar,
 * controls go to 16px because iOS Safari zooms the page when a focused field
 * is smaller, and the small controls get a 44px target (WCAG 2.5.8 asks 24px).
 */
const MEDIUM = `
  .re-root .re-body { grid-template-columns:minmax(0,1fr); }
  .re-root .re-rail { display:none; }
  .re-root .re-rail-select { display:block; }
`;
const NARROW = `
  .re-root .re-cool input, .re-root .re-filter input, .re-root .re-xml textarea, .re-root .re-rail-select { font-size:16px; }
  .re-root .re-cell select, .re-root .re-when-title select { font-size:16px; }
  .re-root .re-bar input { font-size:16px; }
  .re-root .re-cell input { pointer-events:none; }
  .re-root .re-add { min-height:44px; }
  .re-root .re-remove { min-width:44px; min-height:44px; display:inline-flex; align-items:center; justify-content:center; }
  .re-root .re-link { min-height:44px; display:inline-flex; align-items:center; }
  .re-root .re-btn, .re-root .re-btn-primary, .re-root .re-tab { min-height:44px; }
  .re-root .re-info { min-width:32px; min-height:32px; font-size:15px; }
  .re-root .re-help, .re-root .re-msg { font-size:13px; }
  .re-root .re-tabs { display:flex; }
  .re-root .re-sheet-vars .re-sheet-head, .re-root .re-sheet-vars .re-row { grid-template-columns:30px 110px 200px 90px 180px 30px; min-width:640px; }
  .re-root .re-sheet-when .re-sheet-head, .re-root .re-sheet-when .re-row { grid-template-columns:30px 200px 90px 180px 30px; min-width:530px; }
  .re-root .re-sheet-then .re-sheet-head, .re-root .re-sheet-then .re-row { grid-template-columns:30px 150px 80px 200px 180px 30px; min-width:670px; }
  .re-root .re-row.re-row-add { grid-template-columns:30px minmax(0,1fr); }
  .re-root .re-formula-view, .re-root .re-cell input, .re-root .re-cell-result, .re-root .re-cell-field { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .re-root .re-formula-view { min-height:36px; line-height:22px; }
  .re-root .re-row > .re-msg { display:none; }
`;
/**
 * Below this the pane padding and the When heading are the last things that
 * still take width, so they tighten and wrap.
 */
const TIGHT = `
  .re-root .re-pane-head, .re-root .re-pane-body { padding-left:12px; padding-right:12px; }
  .re-root .re-when-title { flex-wrap:wrap; }
  .re-root .re-cool { flex-wrap:wrap; }
  .re-root .re-top { flex-wrap:wrap; gap:8px; }
`;
/** Scope a block's `.re-root` rules to one width class. */
const scoped = (cls, block) => block.replace(/\.re-root /g, `.re-root.${cls} `);
const NARROW_BLOCKS = `${scoped('is-medium', MEDIUM)}${scoped('is-narrow', NARROW)}${scoped('is-tight', TIGHT)}`;
/** Width classes, widest first; `measure()` sets them from the container width. */
const WIDTH_CLASSES = [['is-medium', 900], ['is-narrow', 560], ['is-tight', 430]];
const STYLES = `
.re-root {
  --re-accent: var(--accent, #b8460f);
  --re-accent-hover: var(--accent-hover, #a03d0c);
  --re-ink: var(--ink, #1b1a17);
  --re-text: var(--gray-700, #3b3934);
  --re-muted: var(--gray-500, #6a6660);
  --re-line: var(--gray-200, #ddd9d2);
  --re-grid: var(--grid, #efece7);
  --re-head: var(--sheet-head, #f2efe9);
  --re-paper: var(--bg, #faf9f6);
  --re-surface: var(--surface, #ffffff);
  --re-result: var(--sheet-result, #f7f6f2);
  --re-select: var(--selected, #efece5);
  --re-reading: var(--reading, #3b5570);
  --re-focus: #dfe5ee;
  --re-warn-wash: #fbf3e0;
  --re-warn: var(--warning, #8a5a00);
  --re-critical: var(--incident, #a32c1e);
  --re-error: #b8460f;
  --re-warning: #c4891a;
  --re-info: #3b5570;
  --re-font: var(--font-body, "Helvetica Neue", Helvetica, Arial, sans-serif);
  font-family: var(--re-font); color: var(--re-ink); font-size: 13px; line-height: 1.45;
  background: var(--re-surface); border: 1px solid var(--re-line); border-radius: 4px; overflow: hidden;
  /* Taps act at once: no double-tap-to-zoom delay on cells. Pinch zoom stays. */
  touch-action: manipulation;
}
.re-root *, .re-root *::before, .re-root *::after { box-sizing: border-box; }
.re-root button, .re-root input, .re-root select, .re-root textarea { font-family: inherit; }
.re-root button, .re-root .re-cell, .re-root .re-rail-row { -webkit-tap-highlight-color: transparent; }
.re-top { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 15px; border-bottom:1px solid var(--re-line); background:var(--re-paper); }
.re-title { font-size:14px; font-weight:600; }
.re-top-actions { display:flex; align-items:center; gap:8px; }
.re-btn { font-size:12.5px; color:var(--re-text); background:var(--re-surface); border:1px solid var(--re-line); border-radius:3px; padding:6px 11px; cursor:pointer; }
.re-btn-primary { font-size:12.5px; font-weight:500; color:#fff; background:var(--re-accent); border:1px solid var(--re-accent-hover); border-radius:3px; padding:6px 13px; cursor:pointer; }
.re-link { background:none; border:none; padding:0; margin:0; cursor:pointer; font-size:12px; color:var(--re-accent); }
.re-link:disabled { color:var(--re-muted); cursor:not-allowed; text-decoration:none; }
.re-link.re-danger { color:var(--re-critical); }
.re-status { display:none; padding:8px 15px; font-size:12.5px; color:var(--re-warn); background:var(--re-warn-wash); border-bottom:1px solid var(--re-line); }
.re-status.is-error { display:block; }
.re-xml { padding:14px 15px; border-bottom:1px solid var(--re-line); background:var(--re-paper); }
.re-xml-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; font-size:13px; font-weight:500; }
.re-xml textarea { width:100%; border:1px solid var(--re-line); border-radius:3px; padding:10px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12.5px; background:var(--re-surface); color:var(--re-ink); resize:vertical; }
.re-xml-actions { display:flex; flex-wrap:wrap; align-items:center; gap:14px; margin-top:10px; }
.re-xml-msg { font-size:12.5px; margin-top:8px; color:var(--re-muted); }
.re-xml-msg.is-error { color:var(--re-critical); }
.re-body { display:grid; grid-template-columns:286px minmax(0,1fr); }
.re-rail { border-right:1px solid var(--re-line); background:var(--re-paper); min-width:0; }
.re-filter { padding:9px 12px; border-bottom:1px solid var(--re-grid); }
.re-filter input { width:100%; background:var(--re-surface); border:1px solid var(--re-line); border-radius:3px; padding:6px 9px; font-size:12.5px; color:var(--re-ink); }
.re-filter input::placeholder { color:var(--re-muted); }
.re-rail-row { display:grid; grid-template-columns:14px minmax(0,1fr) 48px; column-gap:10px; align-items:center; padding:10px 13px; border-bottom:1px solid var(--re-grid); cursor:pointer; }
.re-rail-row.is-selected { background:var(--re-select); border-bottom-color:#e0dcd4; }
.re-rail-row[hidden] { display:none; }
.re-square { display:block; width:8px; height:8px; margin:0 auto; background:var(--re-muted); }
.re-square.is-hollow { background:none; border:1px solid #a8a49c; }
.re-square.is-critical { background:var(--re-critical); }
.re-square.is-error { background:var(--re-error); }
.re-square.is-warning { background:var(--re-warning); }
.re-square.is-info { background:var(--re-info); }
.re-rail-text { min-width:0; }
.re-rail-name { display:flex; align-items:baseline; gap:7px; font-size:13.5px; color:var(--re-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.re-rail-row.is-selected .re-rail-name { font-weight:500; }
.re-rail-issues { font-size:11.5px; color:var(--re-warn); flex:none; }
.re-rail-issues:empty { display:none; }
.re-rail-meta { font-size:11.5px; color:var(--re-muted); margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.re-rail-actions { display:flex; align-items:center; justify-content:flex-end; gap:6px; visibility:hidden; }
.re-rail-row.is-selected .re-rail-actions, .re-rail-row:focus-within .re-rail-actions { visibility:visible; }
.re-icon svg { width:13px; height:13px; display:block; }
.re-icon-btn { background:none; border:none; padding:3px; cursor:pointer; color:var(--re-muted); border-radius:3px; }
.re-pane { min-width:0; }
.re-rail-select { display:none; width:100%; margin:12px 18px 0; width:calc(100% - 36px); font-size:13px; padding:6px 9px; border:1px solid var(--re-line); border-radius:3px; background:var(--re-surface); color:var(--re-ink); }
.re-pane-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 18px; border-bottom:1px solid var(--re-grid); }
.re-name { font-size:18px; font-weight:500; color:var(--re-ink); background:none; border:none; border-bottom:1px solid transparent; padding:0; min-width:0; flex:1 1 auto; }
.re-name:focus { border-bottom-color:var(--re-line); outline:none; }
.re-pane-head.is-invalid .re-name { border-bottom-color:var(--re-critical); }
.re-pane-body { padding:14px 18px 18px; display:flex; flex-direction:column; gap:16px; }
.re-empty { color:var(--re-muted); padding:48px 28px; text-align:center; }
.re-sheet-title { display:flex; align-items:baseline; gap:9px; font-size:15px; color:var(--re-muted); margin-bottom:8px; }
.re-pick { position:relative; display:inline-flex; align-items:center; gap:5px; cursor:pointer; color:var(--re-ink); }
.re-pick-caret { font-size:12px; color:var(--re-muted); }
.re-pick select { position:absolute; inset:0; width:100%; height:100%; margin:0; padding:0; border:none; background:none; opacity:0; font-size:16px; cursor:pointer; appearance:none; -webkit-appearance:none; }
.re-pick:focus-within { outline:2px solid var(--re-reading); outline-offset:-2px; }
.re-when-title .re-pick { font-size:15px; }
.re-cell-pick .re-pick { display:flex; width:100%; justify-content:space-between; align-items:flex-start; padding:7px 9px; min-height:32px; }
.re-cell-pick .re-pick-caret { padding-top:2px; }
.re-info { margin-left:auto; padding:0 4px; background:none; border:none; color:var(--re-muted); font-size:12px; line-height:1; cursor:help; }
.re-info[aria-expanded="true"] { color:var(--re-accent); }
.re-help { margin:0 0 8px; font-size:12px; line-height:1.45; color:var(--re-muted); max-width:70ch; }
/* Sheets scroll sideways inside their frame, like a spreadsheet; the page never does, and a sideways drag at the end does not bounce the page. */
.re-sheet { border:1px solid var(--re-line); border-radius:4px; overflow-x:auto; overflow-y:hidden; overscroll-behavior-x:contain; -webkit-overflow-scrolling:touch; }
.re-sheet-block.is-invalid > .re-sheet { border-color:var(--re-critical); }
.re-tabs { display:none; gap:4px; border-bottom:1px solid var(--re-grid); }
.re-tab { flex:1; background:none; border:none; border-bottom:2px solid transparent; padding:8px 4px; font-size:13px; color:var(--re-muted); cursor:pointer; }
.re-tab[aria-selected="true"] { color:var(--re-ink); border-bottom-color:var(--re-reading); font-weight:500; }
.re-tab-count { color:var(--re-muted); margin-left:5px; font-weight:400; }
.re-sheet-head, .re-row { display:grid; align-items:stretch; }
.re-sheet-vars .re-sheet-head, .re-sheet-vars .re-row { grid-template-columns:30px 124px minmax(200px,1fr) 100px 220px 30px; min-width:704px; }
.re-sheet-when .re-sheet-head, .re-sheet-when .re-row { grid-template-columns:30px minmax(200px,1fr) 110px 280px 30px; min-width:650px; }
.re-sheet-then .re-sheet-head, .re-sheet-then .re-row { grid-template-columns:30px 192px 92px minmax(200px,1fr) 220px 30px; min-width:764px; }
.re-row.re-row-add { grid-template-columns:30px minmax(0,1fr); }
.re-sheet-head { background:var(--re-head); border-bottom:1px solid #e4e0d9; }
.re-sheet-head > span { font-size:12px; color:var(--re-muted); padding:6px 9px; border-right:1px solid var(--re-grid); }
.re-sheet-head > span:last-child { border-right:none; }
.re-row { border-bottom:1px solid var(--re-grid); }
.re-row:last-child { border-bottom:none; }
/* Row numbers stay frozen on the left while the sheet scrolls. */
.re-gutter, .re-gutter-head { position:sticky; left:0; z-index:1; background:var(--re-head); }
.re-gutter { font-size:12px; color:var(--re-muted); padding:7px 8px; text-align:center; border-right:1px solid var(--re-grid); }
.re-cell.is-selected { outline:2px solid var(--re-reading); outline-offset:-2px; background:var(--re-surface); }
.re-bar { display:none; position:sticky; bottom:0; z-index:2; background:var(--re-paper); border-top:1px solid var(--re-line); padding:8px 12px calc(10px + env(safe-area-inset-bottom, 0px)); box-shadow:0 -2px 8px rgba(0,0,0,.06); transform:translate3d(0,0,0); }
.re-bar.is-open { display:block; }
.re-bar-head { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; color:var(--re-muted); margin-bottom:6px; min-height:20px; }
.re-bar-line { display:flex; align-items:center; gap:8px; }
.re-bar input { flex:1; min-width:0; border:1px solid var(--re-line); border-radius:3px; padding:8px 10px; font-size:14px; color:var(--re-ink); background:var(--re-surface); }
.re-bar input[readonly] { background:var(--re-result); color:var(--re-reading); }
.re-bar-btn { flex:none; min-width:44px; min-height:44px; border:1px solid var(--re-line); border-radius:3px; background:var(--re-surface); font-size:18px; color:var(--re-ink); cursor:pointer; }
.re-bar-btn.re-bar-ok { background:var(--re-reading); color:#fff; border-color:var(--re-reading); }
.re-bar > .re-msg { padding:6px 0 0; background:none; }
/* The menu scrolls on its own: a drag inside it never scrolls the page (overscroll-behavior) and only pans vertically (touch-action). */
.re-menu { position:fixed; z-index:20; min-width:260px; max-width:min(480px, 96vw); max-height:240px; overflow-y:auto; overscroll-behavior:contain; touch-action:pan-y; -webkit-overflow-scrolling:touch; background:var(--re-surface); border:1px solid var(--re-line); border-radius:4px; box-shadow:0 4px 16px rgba(0,0,0,.12); font-size:13px; }
.re-menu.re-menu-inline { position:static; max-width:none; max-height:200px; margin-bottom:6px; box-shadow:none; }
.re-menu-item { display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:7px 10px; cursor:pointer; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
.re-menu-item.is-active { background:var(--re-select); }
.re-menu-item:active { background:var(--re-focus); }
.re-menu-main { color:var(--re-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.re-menu-meta { color:var(--re-reading); font-size:12px; white-space:nowrap; font-variant-numeric:tabular-nums; }
.re-menu-item.is-stale .re-menu-meta { color:var(--re-warn); }
.re-menu.re-menu-inline .re-menu-item { min-height:44px; align-items:center; }
/* Hover styles only where a pointer can hover: on a touchscreen a hover state sticks after the tap. */
@media (hover: hover) {
  .re-menu-item:hover { background:var(--re-select); }
  .re-btn:hover { border-color:var(--re-muted); }
  .re-btn-primary:hover { background:var(--re-accent-hover); }
  .re-link:hover { text-decoration:underline; }
  .re-icon-btn:hover { color:var(--re-ink); background:rgba(0,0,0,.05); }
  .re-remove:hover { color:var(--re-critical); }
  .re-add:hover { color:var(--re-ink); background:var(--re-paper); }
  .re-info:hover { color:var(--re-accent); }
  .re-name:hover { border-bottom-color:var(--re-line); }
  .re-rail-row:hover .re-rail-actions { visibility:visible; }
}
/* Touch feedback: iOS shows no active state unless one is styled. */
.re-btn:active, .re-btn-primary:active, .re-tab:active, .re-add:active, .re-icon-btn:active, .re-bar-btn:active { filter:brightness(0.94); }
.re-tab, .re-rail-row, .re-gutter, .re-sheet-head, .re-pick, .re-bar-btn { user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
.re-cell { position:relative; min-width:0; border-right:1px solid var(--re-grid); font-size:13px; }
.re-cell input { width:100%; height:100%; min-height:32px; border:none; background:none; padding:7px 9px; font-size:13px; color:var(--re-ink); text-overflow:ellipsis; }
.re-cell input:focus { outline:2px solid var(--re-reading); outline-offset:-2px; background:var(--re-surface); }
.re-cell input::placeholder { color:var(--re-muted); }
.re-cell-text { color:var(--re-text); }
.re-cell-field { padding:7px 9px; color:var(--re-text); }
.re-cell-result { padding:7px 9px; background:var(--re-result); color:var(--re-reading); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.re-cell-result:empty::before { content:"—"; color:var(--re-muted); }
/* The view is in flow, so a wrapped formula sets the row height; the input
   sits over it, transparent until focused, when it takes over the cell. */
.re-cell-formula .re-formula-view { display:block; min-height:32px; padding:7px 9px; white-space:pre-wrap; overflow-wrap:anywhere; pointer-events:none; }
.re-cell-formula input { position:absolute; left:0; right:0; bottom:0; top:0; color:transparent; caret-color:var(--re-ink); }
.re-cell-formula input:focus { color:var(--re-ink); }
.re-cell-formula:focus-within .re-formula-view { visibility:hidden; }
.re-tok-function { color:var(--re-muted); }
.re-tok-string { color:var(--re-reading); }
.re-tok-context { color:var(--re-reading); font-style:italic; }
.re-tok-error { color:var(--re-critical); text-decoration:underline wavy; }
.re-cell.is-invalid { background:var(--re-warn-wash); }
.re-cell.is-invalid .re-formula-view { background:var(--re-warn-wash); }
.re-msg { grid-column:1 / -1; margin:0; padding:4px 9px 6px 39px; font-size:12px; line-height:1.45; color:var(--re-warn); background:var(--re-warn-wash); }
.re-pane-head > .re-msg, .re-sheet-block > .re-msg { padding:6px 9px; border-radius:3px; margin-top:6px; }
.re-remove { background:none; border:none; cursor:pointer; color:var(--re-muted); display:flex; align-items:center; justify-content:center; padding:0; }
/* Sticky, so Add stays in view while the sheet is scrolled sideways. */
.re-add { grid-column:2; justify-self:start; position:sticky; left:30px; text-align:left; background:none; border:none; padding:7px 9px; font-size:13px; color:var(--re-muted); cursor:text; }
.re-add:focus { color:var(--re-ink); outline:none; background:var(--re-paper); }
.re-add:disabled { cursor:not-allowed; color:var(--re-muted); background:none; }
.re-cool { display:flex; align-items:center; gap:7px; background:var(--re-paper); padding:8px 12px; border-top:1px solid var(--re-grid); font-size:12px; color:var(--re-muted); }
.re-cool input { width:6em; font-size:12.5px; color:var(--re-ink); background:var(--re-surface); border:1px solid var(--re-line); border-radius:3px; padding:3px 8px; }
.re-cool.is-invalid input { border-color:var(--re-critical); }
.re-cool .re-msg { flex-basis:100%; background:none; padding:0; }
${NARROW_BLOCKS}`;
function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
}
// ---- component -----------------------------------------------------------
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
            parseError = e instanceof RulesParseError ? e.message : 'Could not parse XML.';
        }
    }
    else {
        model = opts.initialModel ? clone(opts.initialModel) : exampleModel();
    }
    let selected = 0;
    let filter = '';
    /** data-loc of the input to focus (or, when narrow, the cell to select) after the next render. */
    let focusNext = null;
    // ---- narrow mode: one sheet at a time, tap a cell, edit in the bar ----
    /** True when the editor is at most 560px wide: the Google Sheets phone model. */
    let narrow = false;
    let activeSheet = 'vars';
    const cellInfo = new WeakMap();
    let selectedCell = null;
    /** The value the selected cell had when it was tapped, for Cancel. */
    let selectedOriginal = '';
    const uid = ++instances;
    /** Result cells of the current pane and how to re-read them from `monitor`. */
    const liveCells = new Map();
    /** Then result cells of the current pane and how to recompute their preview. */
    const previews = new Set();
    /** True while a structural change is in progress: commits then skip their own refresh. */
    let batching = false;
    let xmlTextarea = null;
    let monitor = opts.monitor;
    let catalogSource = opts.catalog;
    const resolveCatalog = () => typeof catalogSource === 'function' ? catalogSource() : catalogSource ?? null;
    /** Validation messages, with any initial parse error surfaced first. */
    const computeErrors = (issues = validateIssues(model)) => {
        const errs = issues.map((i) => i.message);
        return parseError ? [parseError, ...errs] : errs;
    };
    const status = el('div', { class: 're-status', role: 'alert' });
    const xmlPanel = el('div', { class: 're-xml', hidden: true });
    const rail = el('aside', { class: 're-rail', 'aria-label': 'Rules' });
    const pane = el('section', { class: 're-pane' });
    const copyBtn = el('button', { class: 're-link', type: 'button', onclick: () => copyXml(copyBtn) }, ['Copy XML']);
    const exportBtn = el('button', { class: 're-link', type: 'button', onclick: () => download() }, ['Download rules.xml']);
    // ---- validation + change notification (runs once per committed change) ----
    function refresh() {
        if (batching)
            return;
        const issues = validateIssues(model);
        const errs = computeErrors(issues);
        status.replaceChildren();
        const fileLevel = issues.filter((i) => i.rule === undefined).map((i) => i.message);
        if (parseError)
            fileLevel.unshift(parseError);
        status.className = fileLevel.length ? 're-status is-error' : 're-status';
        status.textContent = fileLevel.join(' ');
        markFields(issues);
        markRail(issues);
        for (const update of previews)
            update();
        // The XML panel follows the model while it is open and not being edited.
        if (xmlTextarea && !xmlPanel.hidden && document.activeElement !== xmlTextarea)
            xmlTextarea.value = serialize(model);
        const gate = (btn) => {
            btn.disabled = errs.length > 0;
            if (errs.length)
                btn.title = `Fix ${errs.length} issue${errs.length === 1 ? '' : 's'} first.`;
            else
                btn.removeAttribute('title');
        };
        gate(exportBtn);
        gate(copyBtn);
        // onChange still carries the xml while invalid, so a host can autosave a draft.
        opts.onChange?.({ model: clone(model), xml: serialize(model), errors: errs });
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
            // A cell's message goes under its row, across every column, so a narrow
            // column never has to fit a sentence.
            const host = node.classList.contains('re-cell') ? node.parentElement ?? node : node;
            const shown = messageFor(node);
            if (messages) {
                node.title = messages.join(' ');
                const p = shown ?? host.appendChild(el('p', { class: 're-msg', 'data-for': loc }));
                p.textContent = messages.join(' ');
            }
            else {
                node.removeAttribute('title');
                shown?.remove();
            }
        }
    }
    /** The message element shown for a marked node, or null. */
    function messageFor(node) {
        const host = node.classList.contains('re-cell') ? node.parentElement ?? node : node;
        const loc = node.dataset.loc ?? '';
        return Array.from(host.children).find((c) => c.classList.contains('re-msg') && c.dataset.for === loc) ?? null;
    }
    /** Issue counts and names in the rail, without re-rendering it. */
    function markRail(issues) {
        const counts = new Map();
        for (const i of issues)
            if (i.rule !== undefined)
                counts.set(i.rule, (counts.get(i.rule) ?? 0) + 1);
        for (const row of Array.from(rail.querySelectorAll('.re-rail-row'))) {
            const index = Number(row.dataset.rule);
            const n = counts.get(index) ?? 0;
            const count = row.querySelector('.re-rail-issues');
            if (count)
                count.textContent = n ? `${n} issue${n === 1 ? '' : 's'}` : '';
            row.classList.toggle('is-invalid', n > 0);
            const rule = model.rules[index];
            const name = row.querySelector('.re-rail-name-text');
            if (rule && name)
                name.textContent = rule.name || 'unnamed';
            const meta = row.querySelector('.re-rail-meta');
            if (rule && meta)
                meta.textContent = EDGE_META[rule.edge ?? 'none'];
        }
        const select = pane.querySelector('.re-rail-select');
        if (select) {
            Array.from(select.options).forEach((o) => {
                const rule = model.rules[Number(o.value)];
                if (rule)
                    o.textContent = rule.name || 'unnamed';
            });
        }
    }
    // ---- controls ----
    const identifierAttrs = (input) => {
        // Identifiers must survive a phone keyboard: iOS otherwise capitalises the
        // first letter and autocorrects, so `alert_temp` is stored as `Alert_temp`
        // and no longer matches the field it names. Prose fields keep the defaults.
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        return input;
    };
    /**
     * A text cell with spreadsheet commit semantics. The model changes, and
     * validation runs, only when the edit is committed: Enter, Tab, or leaving
     * the cell (the `change` event). Escape restores the committed value.
     * `onDraft` sees every keystroke, for cosmetic updates only.
     */
    function textInput(value, onCommit, o) {
        let committed = value;
        // autocomplete=off: no browser autofill strip over the sheet on a phone.
        const input = el('input', { type: 'text', value, placeholder: o.placeholder ?? '', 'aria-label': o.label, autocomplete: 'off' });
        const commit = () => {
            closeMenu();
            if (input.value === committed)
                return;
            committed = input.value;
            onCommit(committed);
            refresh();
        };
        input.addEventListener('input', () => { o.onDraft?.(input.value); if (o.formula)
            maybeMenu(input); });
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
            // An open TAG("…") menu takes the arrows, Enter, Tab and Escape first.
            if (o.formula && menuKey(input, e))
                return;
            if (e.key === 'Enter') {
                commit();
                input.blur();
            }
            else if (e.key === 'Escape') {
                input.value = committed;
                o.onDraft?.(committed);
                input.blur();
            }
        });
        if (o.formula) {
            input.addEventListener('click', () => maybeMenu(input));
            input.addEventListener('blur', () => { if (menuFor === input)
                closeMenu(); });
        }
        return o.prose ? input : identifierAttrs(input);
    }
    // ---- TAG("…") autocomplete ----
    // One menu for the whole editor. On a desktop it floats under the cell being
    // typed into (position: fixed, so the sheet's own scrolling never clips it);
    // on a phone it sits inside the bar, above the input.
    const menu = el('div', { class: 're-menu', role: 'listbox', hidden: true });
    let menuFor = null;
    let menuItems = [];
    let menuIndex = 0;
    let menuCtx = null;
    /** Open, refresh or close the menu for the caret position in `input`. */
    function maybeMenu(input) {
        // On a phone the bar is the only place to type; a cell input never anchors the menu.
        if (narrow && input !== barInput)
            return;
        const catalog = resolveCatalog();
        const ctx = catalog ? tagContext(input.value, input.selectionStart ?? input.value.length) : null;
        const items = catalog && ctx ? tagChoices(catalog, ctx).slice(0, 40) : [];
        if (!ctx || items.length === 0) {
            closeMenu();
            return;
        }
        menuFor = input;
        menuCtx = ctx;
        menuItems = items;
        menuIndex = 0;
        drawMenu();
        placeMenu();
    }
    /** A key for the current list, so an unchanged list keeps its DOM (and its scroll position). */
    let menuKeyOf = '';
    function drawMenu() {
        const key = menuItems.map((c) => (c.kind === 'device' ? `d:${c.device}` : `t:${c.device ?? ''}/${c.entry.tag}/${c.entry.value ?? ''}/${c.entry.stale ? 1 : 0}`)).join('\n');
        if (key !== menuKeyOf || menu.children.length !== menuItems.length) {
            menuKeyOf = key;
            menu.replaceChildren(...menuItems.map((choice, i) => {
                const main = choice.kind === 'device' ? choice.device : choice.entry.tag;
                const meta = [];
                if (choice.kind === 'device') {
                    if (choice.entry.description)
                        meta.push(choice.entry.description);
                    meta.push(`${choice.entry.tags.length} tag${choice.entry.tags.length === 1 ? '' : 's'}`);
                }
                else {
                    if (choice.entry.value !== undefined)
                        meta.push(`${choice.entry.value}${choice.entry.unit ? ` ${choice.entry.unit}` : ''}`);
                    else if (choice.entry.unit)
                        meta.push(choice.entry.unit);
                    if (choice.entry.stale)
                        meta.push('stale');
                }
                const item = el('div', {
                    class: `re-menu-item${choice.kind === 'tag' && choice.entry.stale ? ' is-stale' : ''}`,
                    role: 'option',
                    // mousedown is prevented so the input keeps its focus and caret. On a
                    // touchscreen that is the compatibility event after a tap, so a drag
                    // still scrolls the list; the pick itself waits for the click.
                    onmousedown: (e) => e.preventDefault(),
                    onclick: () => pickMenu(i),
                }, [
                    el('span', { class: 're-menu-main' }, [main]),
                    el('span', { class: 're-menu-meta' }, [meta.join(' · ')]),
                ]);
                if (choice.kind === 'tag' && choice.entry.description)
                    item.title = choice.entry.description;
                return item;
            }));
            menu.scrollTop = 0;
        }
        Array.from(menu.children).forEach((item, i) => {
            item.classList.toggle('is-active', i === menuIndex);
            item.setAttribute('aria-selected', String(i === menuIndex));
        });
        menu.hidden = false;
        // Keep the active row in view by scrolling the menu only, never the page.
        const active = menu.children[menuIndex];
        if (active) {
            const top = active.offsetTop;
            const bottom = top + active.offsetHeight;
            if (top < menu.scrollTop)
                menu.scrollTop = top;
            else if (bottom > menu.scrollTop + menu.clientHeight)
                menu.scrollTop = bottom - menu.clientHeight;
        }
    }
    function placeMenu() {
        if (!menuFor)
            return;
        if (menuFor === barInput) {
            menu.classList.add('re-menu-inline');
            menu.removeAttribute('style');
            if (menu.parentElement !== bar)
                bar.insertBefore(menu, barLine);
            return;
        }
        menu.classList.remove('re-menu-inline');
        if (menu.parentElement !== root)
            root.append(menu);
        const r = menuFor.getBoundingClientRect();
        const height = Math.min(240, menu.scrollHeight || 240);
        const below = window.innerHeight - r.bottom >= height + 8;
        menu.style.left = `${Math.round(r.left)}px`;
        menu.style.minWidth = `${Math.round(Math.max(r.width, 260))}px`;
        menu.style.top = below ? `${Math.round(r.bottom)}px` : '';
        menu.style.bottom = below ? '' : `${Math.round(window.innerHeight - r.top)}px`;
    }
    function pickMenu(i) {
        const input = menuFor;
        const ctx = menuCtx;
        const choice = menuItems[i];
        if (!input || !ctx || !choice)
            return;
        const r = applyTagChoice(input.value, ctx, choice);
        input.value = r.text;
        input.setSelectionRange(r.caret, r.caret);
        input.dispatchEvent(new Event('input'));
        if (!r.more)
            closeMenu();
    }
    /** Keys the open menu consumes; false when the menu is closed for this input. */
    function menuKey(input, e) {
        if (menu.hidden || menuFor !== input)
            return false;
        switch (e.key) {
            case 'ArrowDown':
                menuIndex = (menuIndex + 1) % menuItems.length;
                drawMenu();
                break;
            case 'ArrowUp':
                menuIndex = (menuIndex + menuItems.length - 1) % menuItems.length;
                drawMenu();
                break;
            case 'Enter':
            case 'Tab':
                pickMenu(menuIndex);
                break;
            case 'Escape':
                closeMenu();
                break;
            default: return false;
        }
        e.preventDefault();
        return true;
    }
    function closeMenu() {
        menu.hidden = true;
        menuFor = null;
        menuCtx = null;
        menuKeyOf = '';
    }
    // A floating menu follows its cell when the page scrolls or resizes, and
    // closes when the cell is no longer being edited.
    let menuFrame = 0;
    const followMenu = () => {
        if (menu.hidden || !menuFor || menuFor === barInput)
            return;
        cancelAnimationFrame(menuFrame);
        menuFrame = requestAnimationFrame(() => {
            if (document.activeElement !== menuFor)
                closeMenu();
            else
                placeMenu();
        });
    };
    window.addEventListener('scroll', followMenu, { capture: true, passive: true });
    window.addEventListener('resize', followMenu, { passive: true });
    function selectInput(value, options, onChange, label) {
        const sel = el('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) });
        for (const opt of options) {
            const o = el('option', { value: opt.value }, [opt.label]);
            if (opt.value === value)
                o.setAttribute('selected', 'selected');
            sel.append(o);
        }
        return sel;
    }
    /**
     * A choice shown as text with a caret, styled like the text around it. The
     * native select sits on top, transparent and 16px, so a tap opens the
     * picker without iOS zooming and without the visible text changing size.
     */
    function pickInput(value, options, onChange, label) {
        const labelOf = (v) => options.find((o) => o.value === v)?.label ?? v;
        const text = el('span', { class: 're-pick-label' }, [labelOf(value)]);
        const sel = selectInput(value, options, (v) => { text.textContent = labelOf(v); onChange(v); }, label);
        return el('span', { class: 're-pick' }, [text, el('span', { class: 're-pick-caret', 'aria-hidden': 'true' }, ['▾']), sel]);
    }
    /** The coloured, read-only view of a formula, shown while the cell is not focused. */
    function formulaView(text, literal) {
        const view = el('span', { class: 're-formula-view', 'aria-hidden': 'true' });
        // An empty cell shows only the input's placeholder, not a lone "=".
        if (literal || text === '') {
            view.textContent = text;
            return view;
        }
        view.append('=');
        for (const t of formulaTokens(text))
            view.append(el('span', { class: `re-tok-${t.kind}` }, [t.text]));
        return view;
    }
    /** A cell; `loc` lets the marking pass find it, `info` lets the bar edit it. */
    function cell(cls, label, loc, children, info = {}) {
        const c = el('div', { class: `re-cell ${cls}`, 'data-label': label }, children);
        if (loc)
            c.dataset.loc = locKey(loc);
        cellInfo.set(c, { address: info.address ?? label, input: info.input, formula: info.formula, remove: info.remove });
        return c;
    }
    /**
     * A formula cell: the input holds the text; the view over it colours the
     * tokens until the cell is focused. `thenField` cells are literal text
     * unless the value starts with "=".
     */
    function formulaCell(value, onInput, o) {
        const literal = (v) => Boolean(o.thenField) && !isFormula(v);
        let view = formulaView(value, literal(value));
        // Excel habit: a typed leading "=" is the cell's own prefix, not formula text.
        const strip = (raw) => (!o.thenField && raw.startsWith('=') ? raw.slice(1) : raw);
        // The model updates inside textInput's commit, before it refreshes; the
        // coloured view follows every keystroke.
        const input = textInput(value, (raw) => {
            const v = strip(raw);
            if (v !== raw)
                input.value = v;
            onInput(v, input);
        }, {
            label: o.label,
            placeholder: o.placeholder,
            prose: Boolean(o.thenField),
            formula: true,
            onDraft: (raw) => {
                const v = strip(raw);
                if (v !== raw)
                    input.value = v;
                const next = formulaView(v, literal(v));
                view.replaceWith(next);
                view = next;
            },
        });
        return cell('re-cell-formula', o.column, o.loc, [view, input], { address: o.address, input, formula: true, remove: o.remove });
    }
    const resultCell = (label, value, info = {}) => cell('re-cell-result', label, null, value ? [value] : [], info);
    /** A result cell fed by `monitor`; `refreshValues()` re-reads it in place. */
    function liveCell(label, ref, info) {
        const read = () => monitor?.(ref);
        const c = resultCell(label, read(), info);
        liveCells.set(c, read);
        return c;
    }
    function refreshValues() {
        for (const [c, read] of liveCells)
            c.textContent = read() ?? '';
    }
    const removeBtn = (title, fn) => el('button', { class: 're-remove', type: 'button', title, 'aria-label': title, onclick: fn }, [icon(ICON_TRASH)]);
    const gutter = (n) => el('span', { class: 're-gutter' }, [String(n)]);
    function addRow(n, label, fn, disabledWhy) {
        const btn = el('button', { class: 're-add', type: 'button', onclick: fn }, [label]);
        if (disabledWhy) {
            btn.disabled = true;
            btn.title = disabledWhy;
        }
        return el('div', { class: 're-row re-row-add' }, [gutter(n), btn]);
    }
    function sheetHead(cols, titles = []) {
        return el('div', { class: 're-sheet-head' }, [
            el('span', { class: 're-gutter-head' }),
            ...cols.map((c, i) => el('span', titles[i] ? { title: titles[i] } : {}, [c])),
            el('span'),
        ]);
    }
    /** A sheet title with a help toggle that reveals its paragraph on tap. */
    function sheetTitle(cls, help, children) {
        const text = el('p', { class: 're-help', hidden: true }, [help]);
        const info = el('button', {
            class: 're-info',
            type: 'button',
            'aria-expanded': 'false',
            'aria-label': 'Help',
            title: help,
            onclick: () => {
                text.hidden = !text.hidden;
                info.setAttribute('aria-expanded', String(!text.hidden));
            },
        }, ['ⓘ']);
        return { title: el('div', { class: `re-sheet-title ${cls}` }, [...children, info]), help: text };
    }
    // ---- rail ----
    function renderRail() {
        rail.replaceChildren();
        const filterInput = identifierAttrs(el('input', {
            type: 'search',
            value: filter,
            placeholder: 'Filter',
            'aria-label': 'Filter rules',
            oninput: (e) => { filter = e.target.value; applyFilter(); },
        }));
        rail.append(el('div', { class: 're-filter' }, [filterInput]));
        const list = el('div', { class: 're-rail-list', role: 'list' });
        model.rules.forEach((rule, index) => {
            const square = el('span', { class: `re-square ${rule.incident ? `is-${rule.incident.severity}` : 'is-hollow'}` });
            const row = el('div', {
                class: `re-rail-row${index === selected ? ' is-selected' : ''}`,
                role: 'listitem',
                tabindex: '0',
                'data-rule': String(index),
                onclick: () => selectRule(index),
                onkeydown: (e) => { if (e.key === 'Enter')
                    selectRule(index); },
            }, [
                el('span', {}, [square]),
                el('div', { class: 're-rail-text' }, [
                    el('div', { class: 're-rail-name' }, [
                        el('span', { class: 're-rail-name-text' }, [rule.name || 'unnamed']),
                        el('span', { class: 're-rail-issues' }),
                    ]),
                    el('div', { class: 're-rail-meta' }, [EDGE_META[rule.edge ?? 'none']]),
                ]),
                el('span', { class: 're-rail-actions' }, [
                    el('button', { class: 're-icon-btn', type: 'button', title: 'Duplicate', 'aria-label': `Duplicate ${rule.name}`, onclick: (e) => { e.stopPropagation(); duplicateRule(index); } }, [icon(ICON_COPY)]),
                    el('button', { class: 're-icon-btn', type: 'button', title: 'Delete', 'aria-label': `Delete ${rule.name}`, onclick: (e) => { e.stopPropagation(); deleteRule(index); } }, [icon(ICON_TRASH)]),
                ]),
            ]);
            list.append(row);
        });
        rail.append(list);
        applyFilter();
    }
    function applyFilter() {
        const q = filter.trim().toLowerCase();
        for (const row of Array.from(rail.querySelectorAll('.re-rail-row'))) {
            const rule = model.rules[Number(row.dataset.rule)];
            row.hidden = q !== '' && !(rule?.name ?? '').toLowerCase().includes(q);
        }
    }
    /** Show another rule. The rail is not rebuilt: its rows only change class. */
    function selectRule(index) {
        if (index === selected || !model.rules[index])
            return;
        selected = index;
        for (const row of Array.from(rail.querySelectorAll('.re-rail-row'))) {
            row.classList.toggle('is-selected', Number(row.dataset.rule) === index);
        }
        renderSelected();
    }
    function duplicateRule(index) {
        const copy = clone(model.rules[index]);
        const names = new Set(model.rules.map((r) => r.name));
        let name = `${copy.name}-copy`;
        for (let n = 2; names.has(name); n++)
            name = `${copy.name}-copy${n}`;
        copy.name = name;
        model.rules.splice(index + 1, 0, copy);
        selected = index + 1;
        render();
    }
    function deleteRule(index) {
        model.rules.splice(index, 1);
        if (selected >= model.rules.length)
            selected = Math.max(0, model.rules.length - 1);
        render();
    }
    // ---- pane: the selected rule as three sheets ----
    function renderPane() {
        pane.replaceChildren();
        liveCells.clear();
        previews.clear();
        const railSelect = selectInput(String(selected), model.rules.map((r, i) => ({ value: String(i), label: r.name || 'unnamed' })), (v) => selectRule(Number(v)), 'Rule');
        railSelect.className = 're-rail-select';
        if (model.rules.length === 0) {
            pane.append(el('p', { class: 're-empty' }, [
                'No rules yet. Add one, or ',
                el('button', { class: 're-link', type: 'button', onclick: () => { parseError = null; model = exampleModel(); selected = 0; render(); } }, ['Load example']),
                '.',
            ]));
            return;
        }
        if (selected >= model.rules.length)
            selected = 0;
        const index = selected;
        const rule = model.rules[index];
        pane.append(railSelect);
        const nameInput = textInput(rule.name, (v) => { rule.name = v; }, { label: 'Rule name', placeholder: 'rule-name' });
        nameInput.className = 're-name';
        const head = el('div', { class: 're-pane-head' }, [
            nameInput,
            el('button', { class: 're-link re-danger', type: 'button', onclick: () => deleteRule(index) }, ['Delete']),
        ]);
        head.dataset.loc = locKey({ rule: index, field: 'name' });
        pane.append(head);
        const tabs = el('div', { class: 're-tabs', role: 'tablist', 'aria-label': 'Sheets' });
        const sheets = [
            ['vars', 'Variables', rule.variables.length],
            ['when', 'When', rule.conditions.length],
            ['then', 'Then', thenRows(rule).length],
        ];
        for (const [key, label, count] of sheets) {
            tabs.append(el('button', {
                class: 're-tab',
                type: 'button',
                role: 'tab',
                id: `re-${uid}-tab-${key}`,
                'aria-controls': `re-${uid}-sheet-${key}`,
                'data-sheet': key,
                'aria-selected': String(key === activeSheet),
                onclick: () => { activeSheet = key; clearSelection(); applySheetVisibility(); },
            }, [label, el('span', { class: 're-tab-count' }, [String(count)])]));
        }
        const blocks = [['vars', renderVariables(rule, index)], ['when', renderWhen(rule, index)], ['then', renderThen(rule, index)]];
        for (const [key, block] of blocks) {
            block.dataset.sheet = key;
            block.id = `re-${uid}-sheet-${key}`;
            block.setAttribute('role', 'tabpanel');
            block.setAttribute('aria-labelledby', `re-${uid}-tab-${key}`);
        }
        const body = el('div', { class: 're-pane-body' }, [tabs, ...blocks.map(([, b]) => b)]);
        // An issue with no single field (no actions and no incident) lands on the body.
        body.dataset.loc = locKey({ rule: index });
        pane.append(body);
        applySheetVisibility();
    }
    /** In narrow mode only the active sheet shows; wider, all three stack. */
    function applySheetVisibility() {
        for (const b of Array.from(pane.querySelectorAll('.re-sheet-block')))
            b.hidden = narrow && b.dataset.sheet !== activeSheet;
        for (const t of Array.from(pane.querySelectorAll('.re-tab')))
            t.setAttribute('aria-selected', String(t.dataset.sheet === activeSheet));
    }
    function renderVariables(rule, index) {
        const { title, help } = sheetTitle('', HELP.variables, ['Variables']);
        const sheet = el('div', { class: 're-sheet re-sheet-vars' }, [
            sheetHead(['Name', 'Formula', 'Formula result', 'Description'], ['Letters, digits and underscores', 'An Excel-style formula', 'Live value from the host', 'What the value means']),
        ]);
        rule.variables.forEach((v, i) => sheet.append(variableRow(v, i, rule, index)));
        const n = rule.variables.length + 1;
        const full = rule.variables.length >= LIMITS.maxVariables;
        sheet.append(addRow(n, 'Add', () => {
            rule.variables.push({ name: '', formula: '' });
            focusNext = locKey({ rule: index, field: 'variable', variable: rule.variables.length - 1 });
            render();
        }, full ? `A rule holds at most ${LIMITS.maxVariables} variables.` : undefined));
        const block = el('div', { class: 're-sheet-block' }, [title, help, sheet]);
        block.dataset.loc = locKey({ rule: index, field: 'variable' });
        return block;
    }
    function variableRow(v, i, rule, index) {
        const remove = () => { rule.variables.splice(i, 1); render(); };
        const who = v.name || `Row ${i + 1}`;
        const nameInput = textInput(v.name, (val) => { v.name = val; }, { label: `Name of variable ${i + 1}`, placeholder: 'name' });
        const descInput = textInput(v.description ?? '', (val) => { if (val)
            v.description = val;
        else
            delete v.description; }, { label: `Description of variable ${i + 1}`, prose: true });
        return el('div', { class: 're-row' }, [
            gutter(i + 1),
            cell('', 'Name', { rule: index, field: 'variable', variable: i }, [nameInput], { address: `${who} · Name`, input: nameInput, remove }),
            formulaCell(v.formula, (val) => { v.formula = val; }, { label: `Formula of variable ${i + 1}`, column: 'Formula', loc: { rule: index, field: 'formula', variable: i }, placeholder: 'TAG("device", "tag")', address: `${who} · Formula`, remove }),
            liveCell('Formula result', { rule: index, kind: 'variable', name: v.name }, { address: `${who} · Formula result`, remove }),
            cell('re-cell-text', 'Description', { rule: index, field: 'description', variable: i }, [descInput], { address: `${who} · Description`, input: descInput, remove }),
            removeBtn('Delete variable', remove),
        ]);
    }
    function renderWhen(rule, index) {
        const match = pickInput(rule.match, MATCH_OPTIONS, (v) => { rule.match = v; refresh(); }, 'Match');
        const edge = pickInput(rule.edge ?? 'none', EDGE_OPTIONS, (v) => { if (v === 'none')
            delete rule.edge;
        else
            rule.edge = v; refresh(); }, 'Trigger');
        const { title, help } = sheetTitle('re-when-title', HELP.when, ['When', match, 'of these', edge]);
        const sheet = el('div', { class: 're-sheet re-sheet-when' }, [
            sheetHead(['Condition', 'Condition result', 'Description'], ['A formula that is true or false', 'Live value from the host', 'What the row means; the alarm can quote it']),
        ]);
        rule.conditions.forEach((c, i) => sheet.append(conditionRow(c, i, rule, index)));
        const full = rule.conditions.length >= LIMITS.maxChildren;
        sheet.append(addRow(rule.conditions.length + 1, 'Add', () => {
            rule.conditions.push({ expr: '' });
            focusNext = locKey({ rule: index, field: 'expr', condition: rule.conditions.length - 1 });
            render();
        }, full ? `A rule holds at most ${LIMITS.maxChildren} conditions.` : undefined));
        const block = el('div', { class: 're-sheet-block' }, [title, help, sheet]);
        block.dataset.loc = locKey({ rule: index, field: 'condition' });
        return block;
    }
    function conditionRow(c, i, rule, index) {
        const remove = () => { rule.conditions.splice(i, 1); render(); };
        const who = `Row ${i + 1}`;
        const descInput = textInput(c.description ?? '', (val) => { if (val)
            c.description = val;
        else
            delete c.description; }, { label: `Description of condition ${i + 1}`, prose: true });
        return el('div', { class: 're-row' }, [
            gutter(i + 1),
            formulaCell(c.expr, (val) => { c.expr = val; }, { label: `Condition ${i + 1}`, column: 'Condition', loc: { rule: index, field: 'expr', condition: i }, placeholder: 'temp > 50', address: `${who} · Condition`, remove }),
            liveCell('Condition result', { rule: index, kind: 'condition', index: i }, { address: `${who} · Condition result`, remove }),
            cell('re-cell-text', 'Description', { rule: index, field: 'description', condition: i }, [descInput], { address: `${who} · Description`, input: descInput, remove }),
            removeBtn('Delete condition', remove),
        ]);
    }
    function renderThen(rule, index) {
        const { title, help } = sheetTitle('', HELP.then, ['Then']);
        const sheet = el('div', { class: 're-sheet re-sheet-then' }, [
            sheetHead(['Action', 'Field', 'Formula', 'Formula result'], ['What happens when the rule fires', 'The field of the action', 'Text, or a formula when it starts with =', 'What the gateway sends']),
        ]);
        const rows = thenRows(rule);
        rows.forEach((row, i) => sheet.append(thenRow(row, i, rule, index)));
        sheet.append(addRow(rows.length + 1, 'Add', () => {
            rule.actions.push({ topic: '' });
            focusNext = locKey({ rule: index, field: 'topic', action: rule.actions.length - 1 });
            render();
        }));
        const cooldown = textInput(rule.cooldown ?? '', (v) => { if (v)
            rule.cooldown = v;
        else
            delete rule.cooldown; }, { label: 'Cooldown', placeholder: '0s' });
        cooldown.title = 'A Go duration: 30s, 1m30s, 500ms. Units ns, us, ms, s, m, h. Blank fires every time.';
        const cool = el('div', { class: 're-cool' }, ['Actions are fired at most once every', cooldown]);
        cool.dataset.loc = locKey({ rule: index, field: 'cooldown' });
        sheet.append(cool);
        return el('div', { class: 're-sheet-block' }, [title, help, sheet]);
    }
    function thenRow(row, i, rule, index) {
        const current = row.kind === 'publish' ? 'publish' : rule.incident.severity;
        const action = pickInput(current, ACTION_OPTIONS, (v) => setAction(row, v, rule), `Action of row ${i + 1}`);
        const value = thenGet(rule, row);
        const loc = row.kind === 'publish'
            ? { rule: index, field: THEN_ISSUE_FIELD[row.field], action: row.index }
            : { rule: index, field: THEN_ISSUE_FIELD[row.field] };
        const placeholder = row.field === 'topic' ? 'camera/record' : row.field === 'payload' ? '{}' : row.field === 'summary' ? 'Eight words, lead with the fix' : '';
        const remove = () => {
            if (row.kind === 'publish')
                rule.actions.splice(row.index, 1);
            else
                rule.incident = null;
            render();
        };
        const who = THEN_LABEL[row.field];
        const result = resultCell('Formula result', previewThen(value, rule), { address: `${who} · Formula result`, remove });
        // Recomputed on every refresh: the preview also reads condition 1's description.
        previews.add(() => { result.textContent = previewThen(thenGet(rule, row), rule) ?? ''; });
        return el('div', { class: 're-row' }, [
            gutter(i + 1),
            cell('re-cell-pick', 'Action', null, [action], { address: `${who} · Action`, remove }),
            cell('re-cell-field', 'Field', null, [THEN_LABEL[row.field]], { address: `${who} · Field`, remove }),
            formulaCell(value, (v) => thenSet(rule, row, v), { label: `${THEN_LABEL[row.field]} of row ${i + 1}`, column: 'Formula', loc, thenField: true, placeholder, address: `${who} · Formula`, remove }),
            result,
            removeBtn(row.kind === 'publish' ? 'Delete action' : 'Delete alarm', remove),
        ]);
    }
    /** The Action select changed: convert between a publish and the alarm, or change severity. */
    function setAction(row, value, rule) {
        if (value === 'publish') {
            if (row.kind === 'publish')
                return;
            rule.incident = null;
            rule.actions.push({ topic: '' });
        }
        else {
            const severity = value;
            if (row.kind === 'incident') {
                rule.incident.severity = severity;
                refresh();
                return;
            }
            rule.actions.splice(row.index, 1);
            if (rule.incident)
                rule.incident.severity = severity;
            else
                rule.incident = { source: '', severity, summary: '' };
        }
        render();
    }
    // ---- cell selection and the formula bar (narrow mode) ----
    const barAddress = el('span', { class: 're-bar-address' });
    const barDelete = el('button', { class: 're-link re-danger', type: 'button', onclick: () => {
            const info = selectedCell ? cellInfo.get(selectedCell) : undefined;
            clearSelection(false);
            info?.remove?.();
        } }, ['Delete row']);
    const barInput = el('input', {
        type: 'text',
        'aria-label': 'Cell content',
        autocomplete: 'off',
        // The phone keyboard's action key reads "done" and commits, like the tick.
        enterkeyhint: 'done',
        oninput: () => {
            const info = selectedCell ? cellInfo.get(selectedCell) : undefined;
            if (!info?.input)
                return;
            // A draft: the in-cell input and its coloured view follow, the model does not.
            info.input.value = barInput.value;
            info.input.dispatchEvent(new Event('input'));
            if (info.formula)
                maybeMenu(barInput);
        },
        onclick: () => { const info = selectedCell ? cellInfo.get(selectedCell) : undefined; if (info?.formula)
            maybeMenu(barInput); },
        onkeydown: (e) => {
            if (menuKey(barInput, e))
                return;
            const k = e.key;
            if (k === 'Enter')
                done();
            else if (k === 'Escape')
                barCancel.click();
        },
    });
    /** Commit the selected cell's draft (a no-op when nothing changed). */
    function commitSelected() {
        const info = selectedCell ? cellInfo.get(selectedCell) : undefined;
        info?.input?.dispatchEvent(new Event('change'));
    }
    /** Tick or Enter: commit; stay open with the message when the cell is now invalid. */
    function done() {
        commitSelected();
        if (selectedCell?.classList.contains('is-invalid')) {
            selectedOriginal = barInput.value;
            updateBarMessage();
            // Stay in the bar so the fix can be typed at once.
            barInput.focus();
            return;
        }
        clearSelection(false);
    }
    const barCancel = el('button', { class: 're-bar-btn', type: 'button', 'aria-label': 'Cancel', title: 'Cancel', onclick: () => {
            const info = selectedCell ? cellInfo.get(selectedCell) : undefined;
            if (info?.input && info.input.value !== selectedOriginal) {
                info.input.value = selectedOriginal;
                info.input.dispatchEvent(new Event('input'));
            }
            clearSelection(false);
        } }, ['✕']);
    const barOk = el('button', { class: 're-bar-btn re-bar-ok', type: 'button', 'aria-label': 'Done', title: 'Done', onclick: () => done() }, ['✓']);
    const barMsg = el('p', { class: 're-msg', hidden: true });
    const barLine = el('div', { class: 're-bar-line' }, [barInput, barCancel, barOk]);
    const bar = el('div', { class: 're-bar', 'aria-label': 'Formula bar' }, [
        el('div', { class: 're-bar-head' }, [barAddress, barDelete]),
        barLine,
        barMsg,
    ]);
    function selectCell(c) {
        if (selectedCell && selectedCell !== c) {
            // Moving on commits the draft, as in a spreadsheet.
            commitSelected();
            selectedCell.classList.remove('is-selected');
        }
        selectedCell = c;
        c.classList.add('is-selected');
        const info = cellInfo.get(c);
        selectedOriginal = info?.input ? info.input.value : (c.textContent ?? '');
        updateBar();
    }
    /** Close the bar. By default the draft is committed first; Cancel and Delete pass false. */
    function clearSelection(commit = true) {
        if (commit)
            commitSelected();
        closeMenu();
        selectedCell?.classList.remove('is-selected');
        selectedCell = null;
        bar.classList.remove('is-open');
        placeBar();
    }
    /**
     * Keep the bar above the on-screen keyboard. iOS shrinks the visual viewport
     * under the keyboard but not the layout viewport a sticky element sticks to,
     * so the bar is lifted by however much of it the keyboard covers.
     */
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    let barLift = 0;
    function placeBar() {
        const open = bar.classList.contains('is-open');
        let covered = 0;
        if (open && viewport) {
            const rect = bar.getBoundingClientRect();
            // Measure where the bar would sit without the lift it already has.
            covered = Math.max(0, Math.round(rect.bottom + barLift - (viewport.offsetTop + viewport.height)));
        }
        // Only move for a real change: the keyboard animation fires many events.
        if (covered !== barLift) {
            barLift = covered;
            bar.style.transform = covered > 0 ? `translate3d(0, -${covered}px, 0)` : '';
        }
        // Room under the last row, so it can scroll above the bar (and the keyboard).
        const room = open ? `${bar.offsetHeight + covered}px` : '';
        if (pane.style.paddingBottom !== room)
            pane.style.paddingBottom = room;
    }
    // One measurement per frame, however often the viewport reports.
    let barFrame = 0;
    const placeBarSoon = () => {
        cancelAnimationFrame(barFrame);
        barFrame = requestAnimationFrame(placeBar);
    };
    viewport?.addEventListener('resize', placeBarSoon);
    viewport?.addEventListener('scroll', placeBarSoon);
    function updateBar() {
        const c = selectedCell;
        const info = c ? cellInfo.get(c) : undefined;
        if (!narrow || !c || !info) {
            bar.classList.remove('is-open');
            return;
        }
        barAddress.textContent = info.address;
        barDelete.hidden = !info.remove;
        if (info.input) {
            barInput.readOnly = false;
            barInput.value = info.input.value;
            barInput.placeholder = info.input.placeholder;
            // Same keyboard behaviour as the cell: identifiers off, prose on.
            for (const a of ['autocapitalize', 'autocorrect', 'spellcheck']) {
                const v = info.input.getAttribute(a);
                if (v === null)
                    barInput.removeAttribute(a);
                else
                    barInput.setAttribute(a, v);
            }
            barOk.hidden = false;
            barCancel.hidden = false;
        }
        else {
            barInput.readOnly = true;
            barInput.value = c.textContent?.trim() ?? '';
            barInput.placeholder = '';
            barOk.hidden = true;
            barCancel.hidden = true;
        }
        updateBarMessage();
        closeMenu();
        bar.classList.add('is-open');
        placeBar();
    }
    /** The selected cell's validation message, shown in the bar where the keyboard cannot hide it. */
    function updateBarMessage() {
        const msg = (selectedCell && messageFor(selectedCell)?.textContent) || '';
        barMsg.textContent = msg;
        barMsg.hidden = !msg;
    }
    // A tap on a cell selects it; on a choice cell the native picker opens instead.
    pane.addEventListener('click', (e) => {
        if (!narrow)
            return;
        const c = e.target.closest('.re-cell');
        if (!c) {
            if (!e.target.closest('button, select, input'))
                clearSelection();
            return;
        }
        if (c.querySelector('select'))
            return;
        selectCell(c);
    });
    /**
     * In narrow mode the in-cell inputs are display only: read-only and out of
     * the tab order, so neither a tap nor Safari's form-navigation arrows can
     * focus one (a focused 13px field makes iOS zoom the page). The bar edits.
     */
    function lockCells() {
        for (const input of Array.from(pane.querySelectorAll('.re-cell input'))) {
            input.readOnly = narrow;
            input.tabIndex = narrow ? -1 : 0;
        }
    }
    function setNarrow(v) {
        if (v === narrow)
            return;
        narrow = v;
        // A cell being typed into when the width crosses the line commits first,
        // so its draft is not stranded in an input that is about to be locked.
        const active = document.activeElement;
        if (v && active instanceof HTMLInputElement && active.closest('.re-cell') && pane.contains(active))
            active.blur();
        lockCells();
        applySheetVisibility();
        if (v)
            updateBar();
        else
            clearSelection();
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
        renderRail();
        endRender();
    }
    /** Rebuild the pane only; the rail keeps its rows. For a change of selection. */
    function renderSelected() {
        beginRender();
        endRender();
    }
    function beginRender() {
        measure();
        // A draft in the bar survives a structural change (Add, Delete) by being
        // committed first. Its own refresh is skipped: endRender runs one.
        batching = true;
        commitSelected();
        batching = false;
        selectedCell = null;
        bar.classList.remove('is-open');
        placeBar();
    }
    function endRender() {
        renderPane();
        lockCells();
        refresh();
        if (focusNext) {
            const target = pane.querySelector(`[data-loc="${focusNext}"]`);
            focusNext = null;
            if (!target)
                return;
            if (narrow && target.classList.contains('re-cell')) {
                const sheet = target.closest('.re-sheet-block')?.dataset.sheet;
                if (sheet) {
                    activeSheet = sheet;
                    applySheetVisibility();
                }
                selectCell(target);
                // The row came from a tap on Add, so the keyboard may open right away.
                barInput.focus();
            }
            else {
                target.querySelector('input')?.focus();
            }
        }
    }
    // ---- XML panel: view, copy, download, import ----
    function openXml() {
        const ta = el('textarea', { rows: 14, 'aria-label': 'rules.xml', spellcheck: false });
        ta.value = serialize(model);
        identifierAttrs(ta);
        xmlTextarea = ta;
        const msg = el('div', { class: 're-xml-msg' });
        const file = el('input', { type: 'file', accept: '.xml,text/xml,application/xml', 'aria-label': 'Open a rules.xml file' });
        file.addEventListener('change', async () => {
            const f = file.files?.[0];
            if (f)
                ta.value = await f.text();
        });
        const doImport = () => {
            try {
                model = parse(ta.value);
                parseError = null;
                selected = 0;
                msg.className = 're-xml-msg';
                msg.textContent = `Imported ${model.rules.length} rule${model.rules.length === 1 ? '' : 's'}.`;
                xmlPanel.hidden = true;
                render();
            }
            catch (err) {
                msg.className = 're-xml-msg is-error';
                msg.textContent = err instanceof RulesParseError ? err.message : 'Could not parse XML.';
            }
        };
        xmlPanel.replaceChildren(el('div', { class: 're-xml-head' }, [
            el('span', {}, ['rules.xml']),
            el('button', { class: 're-link', type: 'button', onclick: () => (xmlPanel.hidden = true) }, ['Close']),
        ]), ta, el('div', { class: 're-xml-actions' }, [
            el('button', { class: 're-btn-primary', type: 'button', onclick: doImport }, ['Import']),
            file,
            copyBtn,
            exportBtn,
        ]), msg);
        xmlPanel.hidden = false;
    }
    function download() {
        const blob = new Blob([serialize(model)], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: 'rules.xml' });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function copyXml(btn) {
        const old = btn.textContent;
        const say = (text) => { btn.textContent = text; setTimeout(() => (btn.textContent = old), 1600); };
        try {
            await navigator.clipboard.writeText(serialize(model));
            say('Copied');
        }
        catch {
            // No clipboard permission (plain http on a gateway, or a locked-down
            // iframe): hand the text over selected, so one keystroke copies it.
            if (xmlTextarea) {
                xmlTextarea.focus();
                xmlTextarea.select();
            }
            say('Selected, press copy');
        }
    }
    // ---- top bar + layout ----
    const top = el('div', { class: 're-top' }, [
        el('span', { class: 're-title' }, ['Rules']),
        el('div', { class: 're-top-actions' }, [
            el('button', { class: 're-btn', type: 'button', onclick: () => (xmlPanel.hidden ? openXml() : (xmlPanel.hidden = true)) }, ['XML']),
            el('button', { class: 're-btn-primary', type: 'button', onclick: () => {
                    parseError = null;
                    model.rules.push({ name: 'new-rule', variables: [], match: 'any', conditions: [{ expr: '' }], actions: [], incident: null });
                    selected = model.rules.length - 1;
                    focusNext = locKey({ rule: selected, field: 'name' });
                    render();
                } }, ['Add rule']),
        ]),
    ]);
    root.replaceChildren(top, status, xmlPanel, el('div', { class: 're-body' }, [rail, pane]), bar, menu);
    render();
    return {
        getModel: () => clone(model),
        getXml: () => serialize(model),
        getErrors: () => computeErrors(),
        setModel: (m) => {
            parseError = null;
            model = clone(m);
            if (selected >= model.rules.length)
                selected = 0;
            render();
        },
        refreshValues,
        setMonitor: (m) => { monitor = m; refreshValues(); },
        setCatalog: (c) => { catalogSource = c; closeMenu(); },
        setXml: (xml) => {
            try {
                const next = parse(xml);
                parseError = null;
                model = next;
                if (selected >= model.rules.length)
                    selected = 0;
                render();
                return computeErrors();
            }
            catch (e) {
                return [e instanceof RulesParseError ? e.message : 'Could not parse XML.'];
            }
        },
        destroy: () => {
            resizeObserver?.disconnect();
            viewport?.removeEventListener('resize', placeBarSoon);
            viewport?.removeEventListener('scroll', placeBarSoon);
            window.removeEventListener('scroll', followMenu, { capture: true });
            window.removeEventListener('resize', followMenu);
            root.replaceChildren();
            root.classList.remove('re-root', ...WIDTH_CLASSES.map(([cls]) => cls));
        },
    };
}
// ---- re-exports: one entry for the editor + the core ---------------------
export { serialize } from './serialize.js';
export { parse, validate, validateIssues, RulesParseError } from './parse.js';
export { FUNCTIONS, RESERVED_NAMES, CONTEXT_NAMES, FormulaError, parseFormula, printFormula, formulaTokens, formulaRefs, inferType, checkFunctions, functionSpec, legacyCondToFormula, isFormula, formulaBody, quoteString, } from './formula.js';
export { tagContext, tagChoices, applyTagChoice } from './catalog.js';
export { OPERATORS, SEVERITIES, EDGES, MATCHES, VALUELESS_OPS, OP_ALIASES, LIMITS, COOLDOWN_PATTERN, COOLDOWN_RE, VARIABLE_NAME_PATTERN, VARIABLE_NAME_RE, canonicalOp, } from './model.js';
//# sourceMappingURL=gui.js.map