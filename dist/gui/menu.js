// The formula autocomplete menu. One menu for the whole editor. Inside a
// TAG("…") string it offers devices, then tags, from the host's catalog. In a
// bare name it offers the rule's variables and the functions. On a desktop it
// floats under the cell being typed into (position: fixed, so the sheet's own
// scrolling never clips it); on a phone it sits inside the bar, above the input.
import { FUNCTIONS, isFormula } from '../formula.js';
import { applyNameChoice, applyTagChoice, nameChoices, nameContext, tagChoices, tagContext, } from '../catalog.js';
import { el } from './dom.js';
import { resolveCatalog } from './state.js';
/** What a row shows: the name, the muted detail, and a tooltip. */
function describeChoice(choice) {
    switch (choice.kind) {
        case 'device':
            return {
                main: choice.device,
                meta: [...(choice.entry.description ? [choice.entry.description] : []), `${choice.entry.tags.length} tag${choice.entry.tags.length === 1 ? '' : 's'}`],
                key: `d:${choice.device}`,
            };
        case 'tag': {
            const meta = [];
            if (choice.entry.value !== undefined)
                meta.push(`${choice.entry.value}${choice.entry.unit ? ` ${choice.entry.unit}` : ''}`);
            else if (choice.entry.unit)
                meta.push(choice.entry.unit);
            if (choice.entry.stale)
                meta.push('stale');
            return { main: choice.entry.tag, meta, title: choice.entry.description, stale: choice.entry.stale, key: `t:${choice.device ?? ''}/${choice.entry.tag}/${choice.entry.value ?? ''}/${choice.entry.stale ? 1 : 0}` };
        }
        case 'variable':
            return { main: choice.name, meta: choice.value !== undefined ? [choice.value] : [], title: choice.description, key: `v:${choice.name}/${choice.value ?? ''}` };
        case 'function':
            return { main: `${choice.entry.name}(`, meta: [choice.entry.signature], title: choice.entry.doc, key: `f:${choice.entry.name}` };
    }
}
export function createMenu(deps) {
    const { state } = deps;
    const menu = el('div', { class: 're-menu', role: 'listbox', hidden: true });
    let menuFor = null;
    let menuItems = [];
    let menuIndex = 0;
    let menuState = null;
    /** A key for the current list, so an unchanged list keeps its DOM (and its scroll position). */
    let menuKeyOf = '';
    const thenInputs = new WeakSet();
    /** True when `input` holds a formula right now (a Then field only when it starts with "="). */
    function isFormulaInput(input) {
        const cellInput = deps.cellInputOf(input);
        if (!cellInput)
            return false;
        return thenInputs.has(cellInput) ? isFormula(input.value) : true;
    }
    function maybe(input) {
        // On a phone the bar is the only place to type; a cell input never anchors the menu.
        if (state.narrow && !deps.inline(input))
            return;
        const text = input.value;
        const caret = input.selectionStart ?? text.length;
        const catalog = resolveCatalog(state);
        let next = null;
        let items = [];
        const tagCtx = tagContext(text, caret);
        if (tagCtx) {
            if (catalog) {
                next = { mode: 'tag', ctx: tagCtx };
                items = tagChoices(catalog, tagCtx);
            }
        }
        else if (isFormulaInput(input)) {
            const nameCtx = nameContext(text, caret);
            if (nameCtx) {
                const rule = state.model.rules[state.selected];
                const variables = (rule?.variables ?? []).map((v) => ({
                    name: v.name,
                    description: v.description,
                    value: state.monitor?.({ rule: state.selected, kind: 'variable', name: v.name }),
                }));
                next = { mode: 'name', ctx: nameCtx };
                items = nameChoices(nameCtx, variables, FUNCTIONS);
            }
        }
        if (!next || items.length === 0) {
            close();
            return;
        }
        menuFor = input;
        menuState = next;
        menuItems = items.slice(0, 40);
        menuIndex = 0;
        draw();
        place();
    }
    function draw() {
        const rows = menuItems.map(describeChoice);
        const key = rows.map((r) => r.key).join('\n');
        if (key !== menuKeyOf || menu.children.length !== menuItems.length) {
            menuKeyOf = key;
            menu.replaceChildren(...rows.map(({ main, meta, title, stale }, i) => {
                const item = el('div', {
                    class: `re-menu-item${stale ? ' is-stale' : ''}`,
                    role: 'option',
                    // mousedown is prevented so the input keeps its focus and caret. On a
                    // touchscreen that is the compatibility event after a tap, so a drag
                    // still scrolls the list; the pick itself waits for the click.
                    onmousedown: (e) => e.preventDefault(),
                    onclick: () => pick(i),
                }, [
                    el('span', { class: 're-menu-main' }, [main]),
                    el('span', { class: 're-menu-meta' }, [meta.join(' · ')]),
                ]);
                if (title)
                    item.title = title;
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
    function place() {
        if (!menuFor)
            return;
        const host = deps.inline(menuFor);
        if (host) {
            menu.classList.add('re-menu-inline');
            menu.removeAttribute('style');
            if (menu.parentElement !== host.container)
                host.container.insertBefore(menu, host.before);
            return;
        }
        menu.classList.remove('re-menu-inline');
        if (menu.parentElement !== deps.root)
            deps.root.append(menu);
        const r = menuFor.getBoundingClientRect();
        const height = Math.min(240, menu.scrollHeight || 240);
        const below = window.innerHeight - r.bottom >= height + 8;
        menu.style.left = `${Math.round(r.left)}px`;
        menu.style.minWidth = `${Math.round(Math.max(r.width, 260))}px`;
        menu.style.top = below ? `${Math.round(r.bottom)}px` : '';
        menu.style.bottom = below ? '' : `${Math.round(window.innerHeight - r.top)}px`;
    }
    function pick(i) {
        const input = menuFor;
        const current = menuState;
        const choice = menuItems[i];
        if (!input || !current || !choice)
            return;
        const r = current.mode === 'tag' && (choice.kind === 'device' || choice.kind === 'tag')
            ? applyTagChoice(input.value, current.ctx, choice)
            : current.mode === 'name' && (choice.kind === 'variable' || choice.kind === 'function')
                ? applyNameChoice(input.value, current.ctx, choice)
                : null;
        if (!r)
            return;
        input.value = r.text;
        input.setSelectionRange(r.caret, r.caret);
        // The input event redraws the view and, when there is a next step, reopens the menu.
        close();
        input.dispatchEvent(new Event('input'));
        if (!r.more)
            close();
    }
    function key(input, e) {
        if (menu.hidden || menuFor !== input)
            return false;
        switch (e.key) {
            case 'ArrowDown':
                menuIndex = (menuIndex + 1) % menuItems.length;
                draw();
                break;
            case 'ArrowUp':
                menuIndex = (menuIndex + menuItems.length - 1) % menuItems.length;
                draw();
                break;
            case 'Enter':
            case 'Tab':
                pick(menuIndex);
                break;
            case 'Escape':
                close();
                break;
            default: return false;
        }
        e.preventDefault();
        return true;
    }
    function close() {
        menu.hidden = true;
        menuFor = null;
        menuState = null;
        menuKeyOf = '';
    }
    // A floating menu follows its cell when the page scrolls or resizes, and
    // closes when the cell is no longer being edited.
    let frame = 0;
    const follow = () => {
        if (menu.hidden || !menuFor || deps.inline(menuFor))
            return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            if (document.activeElement !== menuFor)
                close();
            else
                place();
        });
    };
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow, { passive: true });
    return {
        element: menu,
        maybe,
        key,
        close,
        isOpenFor: (input) => menuFor === input,
        markThenInput: (input) => { thenInputs.add(input); },
        destroy: () => {
            window.removeEventListener('scroll', follow, { capture: true });
            window.removeEventListener('resize', follow);
        },
    };
}
//# sourceMappingURL=menu.js.map