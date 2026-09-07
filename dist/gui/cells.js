// The building blocks of a sheet: text and formula cells with spreadsheet
// commit semantics, result cells fed by the host's monitor, and the row and
// header furniture.
import { formulaTokens, isFormula } from '../formula.js';
import { el, icon, identifierAttrs, ICON_TRASH } from './dom.js';
import { locKey } from './state.js';
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
export function createCells(deps) {
    const { state, menu, bar } = deps;
    /** Result cells of the current pane and how to re-read them from `monitor`. */
    const liveCells = new Map();
    /**
     * A text cell with spreadsheet commit semantics. The model changes, and
     * validation runs, only when the edit is committed: Enter, Tab, or leaving
     * the cell (the `change` event). Escape restores the committed value.
     */
    function textInput(value, onCommit, o) {
        let committed = value;
        // autocomplete=off: no browser autofill strip over the sheet on a phone.
        const input = el('input', { type: 'text', value, placeholder: o.placeholder ?? '', 'aria-label': o.label, autocomplete: 'off' });
        const commit = () => {
            menu.close();
            if (input.value === committed)
                return;
            committed = input.value;
            onCommit(committed);
            deps.refresh();
        };
        input.addEventListener('input', () => { o.onDraft?.(input.value); if (o.formula)
            menu.maybe(input); });
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
            // An open menu takes the arrows, Enter, Tab and Escape first.
            if (o.formula && menu.key(input, e))
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
            input.addEventListener('click', () => menu.maybe(input));
            input.addEventListener('blur', () => { if (menu.isOpenFor(input))
                menu.close(); });
        }
        return o.prose ? input : identifierAttrs(input);
    }
    /** A cell; `loc` lets the marking pass find it, `info` lets the bar edit it. */
    function cell(cls, label, loc, children, info = {}) {
        const c = el('div', { class: `re-cell ${cls}`, 'data-label': label }, children);
        if (loc)
            c.dataset.loc = locKey(loc);
        bar.register(c, { address: info.address ?? label, input: info.input, formula: info.formula, remove: info.remove, removeLabel: info.removeLabel });
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
            prose: o.prose ?? false,
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
        if (o.thenField)
            menu.markThenInput(input);
        // The body holds the view and the input over it; a message can follow below, uncovered.
        const body = el('div', { class: 're-cell-body' }, [view, input]);
        return cell('re-cell-formula', o.column, o.loc, [body], { address: o.address, input, formula: true, remove: o.remove, removeLabel: o.removeLabel });
    }
    const resultCell = (label, value, info = {}) => cell('re-cell-result', label, null, value ? [value] : [], info);
    /**
     * A result cell fed by `monitor`; `refreshValues()` re-reads it in place.
     * `ref` is a function, so a renamed variable is asked for under its new name.
     */
    function liveCell(label, ref, info) {
        const read = () => state.monitor?.(ref());
        const c = resultCell(label, read(), info);
        liveCells.set(c, read);
        return c;
    }
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
    function sheetTitle(cls, help, children, sheet) {
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
        refreshValues: () => { for (const [c, read] of liveCells)
            c.textContent = read() ?? ''; },
        resetLive: () => liveCells.clear(),
        removeBtn: (title, fn) => el('button', { class: 're-remove', type: 'button', title, 'aria-label': title, onclick: fn }, [icon(ICON_TRASH)]),
        gutter,
        addRow,
        sheetHead,
        sheetTitle,
    };
}
//# sourceMappingURL=cells.js.map