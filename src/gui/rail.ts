// The rule rail: one row per rule with its severity square, name, trigger
// and issue count, a filter, and the duplicate and delete actions.

import { clone, el, icon, identifierAttrs, ICON_COPY, ICON_TRASH } from './dom.js';
import { EDGE_META } from './labels.js';
import type { EditorState } from './state.js';
import type { ValidationIssue } from '../parse.js';

export interface RailDeps {
  state: EditorState;
  /** The pane, for the rule select that stands in for the rail below 900px. */
  pane: HTMLElement;
  /** Rebuild everything, for a structural change. */
  render: () => void;
  /** Rebuild the pane only, for a change of selection. */
  renderSelected: () => void;
}

export interface Rail {
  element: HTMLElement;
  render(): void;
  /** Issue counts and names in the rail, without re-rendering it. */
  mark(issues: ValidationIssue[]): void;
  /** Show another rule. The rail is not rebuilt: its rows only change class. */
  select(index: number): void;
  duplicate(index: number): void;
  remove(index: number): void;
}

const squareClass = (rule: EditorState['model']['rules'][number]): string =>
  `re-square ${rule.incident ? `is-${rule.incident.severity}` : 'is-hollow'}`;

export function createRail(deps: RailDeps): Rail {
  const { state } = deps;
  const rail = el('aside', { class: 're-rail', 'aria-label': 'Rules' });
  const rows = (): HTMLElement[] => Array.from(rail.querySelectorAll<HTMLElement>('.re-rail-row'));

  function render(): void {
    rail.replaceChildren();
    const filterInput = identifierAttrs(el('input', {
      type: 'search',
      value: state.filter,
      placeholder: 'Filter',
      'aria-label': 'Filter rules',
      oninput: (e) => { state.filter = (e.target as HTMLInputElement).value; applyFilter(); },
    }));
    rail.append(el('div', { class: 're-filter' }, [filterInput]));
    const list = el('div', { class: 're-rail-list', role: 'list' });
    state.model.rules.forEach((rule, index) => {
      const row = el('div', {
        class: `re-rail-row${index === state.selected ? ' is-selected' : ''}`,
        role: 'listitem',
        tabindex: '0',
        'data-rule': String(index),
        onclick: () => select(index),
        onkeydown: (e) => { if ((e as KeyboardEvent).key === 'Enter') select(index); },
      }, [
        el('span', {}, [el('span', { class: squareClass(rule) })]),
        el('div', { class: 're-rail-text' }, [
          el('div', { class: 're-rail-name' }, [
            el('span', { class: 're-rail-name-text' }, [rule.name || 'unnamed']),
            el('span', { class: 're-rail-issues' }),
          ]),
          el('div', { class: 're-rail-meta' }, [EDGE_META[rule.edge ?? 'none']]),
        ]),
        el('span', { class: 're-rail-actions' }, [
          el('button', { class: 're-icon-btn', type: 'button', title: 'Duplicate', 'aria-label': `Duplicate ${rule.name}`, onclick: (e) => { e.stopPropagation(); duplicate(index); } }, [icon(ICON_COPY)]),
          el('button', { class: 're-icon-btn', type: 'button', title: 'Delete', 'aria-label': `Delete ${rule.name}`, onclick: (e) => { e.stopPropagation(); remove(index); } }, [icon(ICON_TRASH)]),
        ]),
      ]);
      list.append(row);
    });
    rail.append(list);
    applyFilter();
  }

  function applyFilter(): void {
    const q = state.filter.trim().toLowerCase();
    for (const row of rows()) {
      const rule = state.model.rules[Number(row.dataset.rule)];
      row.hidden = q !== '' && !(rule?.name ?? '').toLowerCase().includes(q);
    }
  }

  function mark(issues: ValidationIssue[]): void {
    const counts = new Map<number, number>();
    for (const i of issues) if (i.rule !== undefined) counts.set(i.rule, (counts.get(i.rule) ?? 0) + 1);
    for (const row of rows()) {
      const index = Number(row.dataset.rule);
      const n = counts.get(index) ?? 0;
      const count = row.querySelector('.re-rail-issues');
      if (count) count.textContent = n ? `${n} issue${n === 1 ? '' : 's'}` : '';
      row.classList.toggle('is-invalid', n > 0);
      const rule = state.model.rules[index];
      if (!rule) continue;
      const name = row.querySelector('.re-rail-name-text');
      if (name) name.textContent = rule.name || 'unnamed';
      const meta = row.querySelector('.re-rail-meta');
      if (meta) meta.textContent = EDGE_META[rule.edge ?? 'none'];
      const square = row.querySelector('.re-square');
      if (square) square.className = squareClass(rule);
    }
    const select = deps.pane.querySelector<HTMLSelectElement>('.re-rail-select');
    if (select) {
      for (const o of Array.from(select.options)) {
        const rule = state.model.rules[Number(o.value)];
        if (rule) o.textContent = rule.name || 'unnamed';
      }
    }
  }

  function select(index: number): void {
    if (index === state.selected || !state.model.rules[index]) return;
    state.selected = index;
    for (const row of rows()) row.classList.toggle('is-selected', Number(row.dataset.rule) === index);
    deps.renderSelected();
  }

  function duplicate(index: number): void {
    const copy = clone(state.model.rules[index]);
    const names = new Set(state.model.rules.map((r) => r.name));
    let name = `${copy.name}-copy`;
    for (let n = 2; names.has(name); n++) name = `${copy.name}-copy${n}`;
    copy.name = name;
    state.model.rules.splice(index + 1, 0, copy);
    state.selected = index + 1;
    deps.render();
  }

  function remove(index: number): void {
    state.model.rules.splice(index, 1);
    // Keep showing the same rule when one before it goes.
    if (index < state.selected) state.selected--;
    if (state.selected >= state.model.rules.length) state.selected = Math.max(0, state.model.rules.length - 1);
    deps.render();
  }

  return { element: rail, render, mark, select, duplicate, remove };
}
