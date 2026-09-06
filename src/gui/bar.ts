// Cell selection and the formula bar of the phone layout. A tap selects a
// cell; the bar at the bottom shows its address and edits its content, with
// Cancel and Done, like Google Sheets on a phone. The in-cell inputs are
// display only while the editor is narrow.

import { el } from './dom.js';
import type { Menu } from './menu.js';
import type { CellInfo, EditorState } from './state.js';

export interface BarDeps {
  state: EditorState;
  /** The pane the cells live in: taps are handled there, and it gets room under the bar. */
  pane: HTMLElement;
  menu: Menu;
  /** The validation message element shown for a marked node, or null. */
  messageFor: (node: HTMLElement) => HTMLElement | null;
}

export interface Bar {
  element: HTMLElement;
  /** The bar's text input. */
  input: HTMLInputElement;
  /** The input line: the autocomplete menu goes above it. */
  line: HTMLElement;
  /** Tell the bar how to edit a cell. */
  register(cell: HTMLElement, info: CellInfo): void;
  /** The in-cell input of the selected cell, if it has one. */
  selectedInput(): HTMLInputElement | undefined;
  select(cell: HTMLElement): void;
  /** Close the bar. By default the draft is committed first; Cancel and Delete pass false. */
  clear(commit?: boolean): void;
  /** Commit the selected cell's draft (a no-op when nothing changed). */
  commit(): void;
  /** Show the selected cell in the bar, or close the bar when there is none or the editor is wide. */
  update(): void;
  /** Forget the selection without a commit and close the bar; for a rebuild of the pane. */
  reset(): void;
  destroy(): void;
}

export function createBar(deps: BarDeps): Bar {
  const { state, pane, menu } = deps;
  const cellInfo = new WeakMap<HTMLElement, CellInfo>();
  let selectedCell: HTMLElement | null = null;
  /** The value the selected cell had when it was tapped, for Cancel. */
  let selectedOriginal = '';
  const infoOf = (): CellInfo | undefined => (selectedCell ? cellInfo.get(selectedCell) : undefined);

  const address = el('span', { class: 're-bar-address' });
  const deleteBtn = el('button', { class: 're-link re-danger', type: 'button', onclick: () => {
    const info = infoOf();
    clear(false);
    info?.remove?.();
  } }, ['Delete row']);
  const input = el('input', {
    type: 'text',
    'aria-label': 'Cell content',
    autocomplete: 'off',
    // The phone keyboard's action key reads "done" and commits, like the tick.
    enterkeyhint: 'done',
    oninput: () => {
      const info = infoOf();
      if (!info?.input) return;
      // A draft: the in-cell input and its coloured view follow, the model does not.
      info.input.value = input.value;
      info.input.dispatchEvent(new Event('input'));
      if (info.formula) menu.maybe(input);
    },
    onclick: () => { if (infoOf()?.formula) menu.maybe(input); },
    onkeydown: (e) => {
      if (menu.key(input, e as KeyboardEvent)) return;
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter') done();
      else if (k === 'Escape') cancel.click();
    },
  });

  function commit(): void {
    infoOf()?.input?.dispatchEvent(new Event('change'));
  }

  /** Tick or Enter: commit; stay open with the message when the cell is now invalid. */
  function done(): void {
    commit();
    if (selectedCell?.classList.contains('is-invalid')) {
      selectedOriginal = input.value;
      updateMessage();
      // Stay in the bar so the fix can be typed at once.
      input.focus();
      return;
    }
    clear(false);
  }

  const cancel = el('button', { class: 're-bar-btn', type: 'button', 'aria-label': 'Cancel', title: 'Cancel', onclick: () => {
    const info = infoOf();
    if (info?.input && info.input.value !== selectedOriginal) {
      info.input.value = selectedOriginal;
      info.input.dispatchEvent(new Event('input'));
    }
    clear(false);
  } }, ['✕']);
  const ok = el('button', { class: 're-bar-btn re-bar-ok', type: 'button', 'aria-label': 'Done', title: 'Done', onclick: () => done() }, ['✓']);
  const message = el('p', { class: 're-msg', hidden: true });
  const line = el('div', { class: 're-bar-line' }, [input, cancel, ok]);
  const bar = el('div', { class: 're-bar', 'aria-label': 'Formula bar' }, [
    el('div', { class: 're-bar-head' }, [address, deleteBtn]),
    line,
    message,
  ]);

  function select(c: HTMLElement): void {
    if (selectedCell && selectedCell !== c) {
      // Moving on commits the draft, as in a spreadsheet.
      commit();
      selectedCell.classList.remove('is-selected');
    }
    selectedCell = c;
    c.classList.add('is-selected');
    const info = cellInfo.get(c);
    selectedOriginal = info?.input ? info.input.value : (c.textContent ?? '');
    update();
  }

  function clear(commitFirst = true): void {
    if (commitFirst) commit();
    menu.close();
    selectedCell?.classList.remove('is-selected');
    selectedCell = null;
    bar.classList.remove('is-open');
    place();
  }

  /**
   * Keep the bar above the on-screen keyboard. iOS shrinks the visual viewport
   * under the keyboard but not the layout viewport a sticky element sticks to,
   * so the bar is lifted by however much of it the keyboard covers.
   */
  const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
  let lift = 0;
  function place(): void {
    const open = bar.classList.contains('is-open');
    let covered = 0;
    if (open && viewport) {
      const rect = bar.getBoundingClientRect();
      // Measure where the bar would sit without the lift it already has.
      covered = Math.max(0, Math.round(rect.bottom + lift - (viewport.offsetTop + viewport.height)));
    }
    // Only move for a real change: the keyboard animation fires many events.
    if (covered !== lift) {
      lift = covered;
      bar.style.transform = covered > 0 ? `translate3d(0, -${covered}px, 0)` : '';
    }
    // Room under the last row, so it can scroll above the bar (and the keyboard).
    const room = open ? `${bar.offsetHeight + covered}px` : '';
    if (pane.style.paddingBottom !== room) pane.style.paddingBottom = room;
  }
  // One measurement per frame, however often the viewport reports.
  let frame = 0;
  const placeSoon = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };
  viewport?.addEventListener('resize', placeSoon);
  viewport?.addEventListener('scroll', placeSoon);

  function update(): void {
    const c = selectedCell;
    const info = c ? cellInfo.get(c) : undefined;
    if (!state.narrow || !c || !info) { bar.classList.remove('is-open'); return; }
    address.textContent = info.address;
    deleteBtn.hidden = !info.remove;
    if (info.input) {
      input.readOnly = false;
      input.value = info.input.value;
      input.placeholder = info.input.placeholder;
      // Same keyboard behaviour as the cell: identifiers off, prose on.
      for (const a of ['autocapitalize', 'autocorrect', 'spellcheck']) {
        const v = info.input.getAttribute(a);
        if (v === null) input.removeAttribute(a);
        else input.setAttribute(a, v);
      }
      ok.hidden = false;
      cancel.hidden = false;
    } else {
      input.readOnly = true;
      input.value = c.textContent?.trim() ?? '';
      input.placeholder = '';
      ok.hidden = true;
      cancel.hidden = true;
    }
    updateMessage();
    menu.close();
    bar.classList.add('is-open');
    place();
  }

  /** The selected cell's validation message, shown in the bar where the keyboard cannot hide it. */
  function updateMessage(): void {
    const msg = (selectedCell && deps.messageFor(selectedCell)?.textContent) || '';
    message.textContent = msg;
    message.hidden = !msg;
  }

  // A tap on a cell selects it; on a choice cell the native picker opens instead.
  pane.addEventListener('click', (e) => {
    if (!state.narrow) return;
    const c = (e.target as HTMLElement).closest<HTMLElement>('.re-cell');
    if (!c) { if (!(e.target as HTMLElement).closest('button, select, input')) clear(); return; }
    if (c.querySelector('select')) return;
    select(c);
  });

  return {
    element: bar,
    input,
    line,
    register: (cell, info) => { cellInfo.set(cell, info); },
    selectedInput: () => infoOf()?.input,
    select,
    clear,
    commit,
    update,
    reset: () => {
      selectedCell = null;
      bar.classList.remove('is-open');
      place();
    },
    destroy: () => {
      viewport?.removeEventListener('resize', placeSoon);
      viewport?.removeEventListener('scroll', placeSoon);
    },
  };
}
