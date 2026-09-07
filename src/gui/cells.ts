// The building blocks of a sheet: text and formula cells with spreadsheet
// commit semantics, result cells fed by the host's monitor, and the row and
// header furniture.

import { formulaTokens, isFormula } from '../formula.js';
import { el, icon, identifierAttrs, ICON_TRASH } from './dom.js';
import type { Bar } from './bar.js';
import type { Menu } from './menu.js';
import { locKey, type CellInfo, type EditorState, type Loc, type MonitorRef } from './state.js';

export interface CellsDeps {
  state: EditorState;
  menu: Menu;
  bar: Bar;
  /** Validate and notify, after a committed edit. */
  refresh: () => void;
}

export interface TextOptions {
  label: string;
  placeholder?: string;
  /** Prose keeps the phone keyboard's autocorrect; an identifier turns it off. */
  prose?: boolean;
  /** Sees every keystroke, for cosmetic updates only. */
  onDraft?: (v: string) => void;
  /** The autocomplete menu applies. */
  formula?: boolean;
}

export interface FormulaOptions {
  label: string;
  column: string;
  loc: Loc;
  /** Literal text unless the value starts with "=". */
  thenField?: boolean;
  /** Free text: the phone keyboard keeps autocorrect. Off for names, topics and payloads. */
  prose?: boolean;
  placeholder?: string;
  address?: string;
  remove?: () => void;
  /** What the bar's delete button says, when "Delete row" is not what happens. */
  removeLabel?: string;
}

export interface Cells {
  textInput(value: string, onCommit: (v: string) => void, o: TextOptions): HTMLInputElement;
  cell(cls: string, label: string, loc: Loc | null, children: Array<Node | string>, info?: Partial<CellInfo>): HTMLElement;
  formulaCell(value: string, onInput: (v: string, input: HTMLInputElement) => void, o: FormulaOptions): HTMLElement;
  resultCell(label: string, value: string | null | undefined, info?: Partial<CellInfo>): HTMLElement;
  liveCell(label: string, ref: () => MonitorRef, info: Partial<CellInfo>): HTMLElement;
  /** Re-read `monitor` for every result cell, in place. */
  refreshValues(): void;
  /** Forget the result cells of a pane about to be rebuilt. */
  resetLive(): void;
  removeBtn(title: string, fn: () => void): HTMLElement;
  gutter(n: number): HTMLElement;
  addRow(n: number, label: string, fn: () => void, disabledWhy?: string): HTMLElement;
  sheetHead(cols: string[], titles?: string[]): HTMLElement;
  sheetTitle(cls: string, help: string, children: Array<Node | string>, sheet: string): { title: HTMLElement; help: HTMLElement };
}

/** The coloured, read-only view of a formula, shown while the cell is not focused. */
function formulaView(text: string, literal: boolean): HTMLElement {
  const view = el('span', { class: 're-formula-view', 'aria-hidden': 'true' });
  // An empty cell shows only the input's placeholder, not a lone "=".
  if (literal || text === '') {
    view.textContent = text;
    return view;
  }
  view.append('=');
  for (const t of formulaTokens(text)) view.append(el('span', { class: `re-tok-${t.kind}` }, [t.text]));
  return view;
}

export function createCells(deps: CellsDeps): Cells {
  const { state, menu, bar } = deps;
  /** Result cells of the current pane and how to re-read them from `monitor`. */
  const liveCells = new Map<HTMLElement, () => string | undefined>();

  /**
   * A text cell with spreadsheet commit semantics. The model changes, and
   * validation runs, only when the edit is committed: Enter, Tab, or leaving
   * the cell (the `change` event). Escape restores the committed value.
   */
  function textInput(value: string, onCommit: (v: string) => void, o: TextOptions): HTMLInputElement {
    let committed = value;
    // autocomplete=off: no browser autofill strip over the sheet on a phone.
    const input = el('input', { type: 'text', value, placeholder: o.placeholder ?? '', 'aria-label': o.label, autocomplete: 'off' });
    const commit = (): void => {
      menu.close();
      if (input.value === committed) return;
      committed = input.value;
      onCommit(committed);
      deps.refresh();
    };
    input.addEventListener('input', () => { o.onDraft?.(input.value); if (o.formula) menu.maybe(input); });
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      // An open menu takes the arrows, Enter, Tab and Escape first.
      if (o.formula && menu.key(input, e)) return;
      if (e.key === 'Enter') { commit(); input.blur(); }
      else if (e.key === 'Escape') { input.value = committed; o.onDraft?.(committed); input.blur(); }
    });
    if (o.formula) {
      input.addEventListener('click', () => menu.maybe(input));
      input.addEventListener('blur', () => { if (menu.isOpenFor(input)) menu.close(); });
    }
    return o.prose ? input : identifierAttrs(input);
  }

  /** A cell; `loc` lets the marking pass find it, `info` lets the bar edit it. */
  function cell(cls: string, label: string, loc: Loc | null, children: Array<Node | string>, info: Partial<CellInfo> = {}): HTMLElement {
    const c = el('div', { class: `re-cell ${cls}`, 'data-label': label }, children);
    if (loc) c.dataset.loc = locKey(loc);
    bar.register(c, { address: info.address ?? label, input: info.input, formula: info.formula, remove: info.remove, removeLabel: info.removeLabel });
    return c;
  }

  /**
   * A formula cell: the input holds the text; the view over it colours the
   * tokens until the cell is focused. `thenField` cells are literal text
   * unless the value starts with "=".
   */
  function formulaCell(value: string, onInput: (v: string, input: HTMLInputElement) => void, o: FormulaOptions): HTMLElement {
    const literal = (v: string) => Boolean(o.thenField) && !isFormula(v);
    let view = formulaView(value, literal(value));
    // Excel habit: a typed leading "=" is the cell's own prefix, not formula text.
    const strip = (raw: string): string => (!o.thenField && raw.startsWith('=') ? raw.slice(1) : raw);
    // The model updates inside textInput's commit, before it refreshes; the
    // coloured view follows every keystroke.
    const input = textInput(value, (raw) => {
      const v = strip(raw);
      if (v !== raw) input.value = v;
      onInput(v, input);
    }, {
      label: o.label,
      placeholder: o.placeholder,
      prose: o.prose ?? false,
      formula: true,
      onDraft: (raw) => {
        const v = strip(raw);
        if (v !== raw) input.value = v;
        const next = formulaView(v, literal(v));
        view.replaceWith(next);
        view = next;
      },
    });
    if (o.thenField) menu.markThenInput(input);
    // The body holds the view and the input over it; a message can follow below, uncovered.
    const body = el('div', { class: 're-cell-body' }, [view, input]);
    return cell('re-cell-formula', o.column, o.loc, [body], { address: o.address, input, formula: true, remove: o.remove, removeLabel: o.removeLabel });
  }

  const resultCell = (label: string, value: string | null | undefined, info: Partial<CellInfo> = {}): HTMLElement =>
    cell('re-cell-result', label, null, value ? [value] : [], info);

  /**
   * A result cell fed by `monitor`; `refreshValues()` re-reads it in place.
   * `ref` is a function, so a renamed variable is asked for under its new name.
   */
  function liveCell(label: string, ref: () => MonitorRef, info: Partial<CellInfo>): HTMLElement {
    const read = (): string | undefined => state.monitor?.(ref());
    const c = resultCell(label, read(), info);
    liveCells.set(c, read);
    return c;
  }

  const gutter = (n: number): HTMLElement => el('span', { class: 're-gutter' }, [String(n)]);

  function addRow(n: number, label: string, fn: () => void, disabledWhy?: string): HTMLElement {
    const btn = el('button', { class: 're-add', type: 'button', onclick: fn }, [label]);
    if (disabledWhy) {
      btn.disabled = true;
      btn.title = disabledWhy;
    }
    return el('div', { class: 're-row re-row-add' }, [gutter(n), btn]);
  }

  function sheetHead(cols: string[], titles: string[] = []): HTMLElement {
    return el('div', { class: 're-sheet-head' }, [
      el('span', { class: 're-gutter-head' }),
      ...cols.map((c, i) => el('span', titles[i] ? { title: titles[i] } : {}, [c])),
      el('span'),
    ]);
  }

  /** A sheet title with a help toggle that reveals its paragraph on tap. */
  function sheetTitle(cls: string, help: string, children: Array<Node | string>, sheet: string): { title: HTMLElement; help: HTMLElement } {
    const text = el('p', { class: 're-help', hidden: true }, [help]);
    const info = el('button', {
      class: 're-info',
      type: 'button',
      'aria-expanded': 'false',
      'aria-label': `Help on ${sheet}`,
      title: help,
      onclick: () => {
        text.hidden = !text.hidden;
        info.setAttribute('aria-expanded', String(!text.hidden));
      },
    }, ['ⓘ']);
    return { title: el('div', { class: `re-sheet-title ${cls}` }, [...children, info]), help: text };
  }

  return {
    textInput,
    cell,
    formulaCell,
    resultCell,
    liveCell,
    refreshValues: () => { for (const [c, read] of liveCells) c.textContent = read() ?? ''; },
    resetLive: () => liveCells.clear(),
    removeBtn: (title, fn) => el('button', { class: 're-remove', type: 'button', title, 'aria-label': title, onclick: fn }, [icon(ICON_TRASH)]),
    gutter,
    addRow,
    sheetHead,
    sheetTitle,
  };
}
