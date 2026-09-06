// The editor's scoped stylesheet, injected once as #octaview-rules-editor-styles.
// Everything is prefixed `re-` under `.re-root`; colours and fonts read the
// host's design tokens (--accent, --ink, --font-body, …) with fallbacks.
export const STYLE_ID = 'octaview-rules-editor-styles';
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
  .re-root .re-sheet-vars .re-sheet-head, .re-root .re-sheet-vars .re-row { grid-template-columns:30px 110px 190px 90px 220px 30px; min-width:670px; }
  .re-root .re-sheet-when .re-sheet-head, .re-root .re-sheet-when .re-row { grid-template-columns:30px 190px 90px 220px 30px; min-width:560px; }
  .re-root .re-sheet-then .re-sheet-head, .re-root .re-sheet-then .re-row { grid-template-columns:30px 150px 80px 200px 180px 30px; min-width:670px; }
  .re-root .re-row.re-row-add { grid-template-columns:30px minmax(0,1fr); }
  .re-root .re-formula-view, .re-root .re-cell input, .re-root .re-cell-result, .re-root .re-cell-field { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .re-root .re-formula-view { min-height:36px; line-height:22px; }
  .re-root .re-cell > .re-msg { display:none; }
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
export const WIDTH_CLASSES = [['is-medium', 900], ['is-narrow', 560], ['is-tight', 430]];
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
/* The rows of one action share its Action cell: the continuation rows paint over the grid line above them. */
.re-cell-merged { position:relative; margin-top:-1px; border-right:1px solid var(--re-grid); background:var(--re-surface); }
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
/* The formula column stops at 300px; the description takes what is left, because it holds sentences. */
.re-sheet-vars .re-sheet-head, .re-sheet-vars .re-row { grid-template-columns:30px 124px minmax(220px,300px) 100px minmax(220px,1fr) 30px; min-width:724px; }
.re-sheet-when .re-sheet-head, .re-sheet-when .re-row { grid-template-columns:30px minmax(220px,300px) 110px minmax(220px,1fr) 30px; min-width:710px; }
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
/* A cell stacks its value and, when marked, its message; the value fills the row height. */
.re-cell { position:relative; display:flex; flex-direction:column; min-width:0; border-right:1px solid var(--re-grid); font-size:13px; }
.re-cell > input, .re-cell > .re-cell-body, .re-cell > .re-pick { flex:1 1 auto; }
.re-cell input { width:100%; min-height:32px; border:none; background:none; padding:7px 9px; font-size:13px; color:var(--re-ink); text-overflow:ellipsis; }
.re-cell input:focus { outline:2px solid var(--re-reading); outline-offset:-2px; background:var(--re-surface); }
.re-cell input::placeholder { color:var(--re-muted); }
.re-cell-text { color:var(--re-text); }
.re-cell-field { padding:7px 9px; color:var(--re-text); }
.re-cell-result { padding:7px 9px; background:var(--re-result); color:var(--re-reading); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.re-cell-result:empty::before { content:"—"; color:var(--re-muted); }
/* The view is in flow, so a wrapped formula sets the row height; the input
   sits over it, transparent until focused, when it takes over the cell. */
.re-cell-body { position:relative; }
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
.re-msg { margin:0; padding:6px 9px; font-size:12px; line-height:1.45; color:var(--re-warn); background:var(--re-warn-wash); border-radius:3px; }
.re-pane-head > .re-msg, .re-sheet-block > .re-msg { margin-top:6px; }
/* Inside a cell the wash is already on the cell: the message is a hint line under the value. */
.re-cell > .re-msg { padding:0 9px 7px; background:none; border-radius:0; overflow-wrap:anywhere; }
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
export function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
}
//# sourceMappingURL=styles.js.map