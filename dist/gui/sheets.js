// The pane: the selected rule as three sheets, Variables, When and Then, in
// the spreadsheet style of the design handoff. Wide, the three stack; narrow,
// tabs show one at a time.
import { LIMITS } from '../model.js';
import { isFormula } from '../formula.js';
import { el, pickInput, selectInput } from './dom.js';
import { exampleModel } from './example.js';
import { ACTION_OPTIONS, EDGE_OPTIONS, HELP, MATCH_OPTIONS } from './labels.js';
import { isGroupHead, previewThen, thenGet, thenRows, thenSet, THEN_ISSUE_FIELD, THEN_LABEL, THEN_PROSE } from './then-rows.js';
import { locKey } from './state.js';
export function createSheets(deps) {
    const { state, pane, cells, uid } = deps;
    const { textInput, cell, formulaCell, liveCell, removeBtn, gutter, addRow, sheetHead, sheetTitle } = cells;
    /** Then result cells of the current pane and how to recompute their preview. */
    const previews = new Set();
    function render() {
        pane.replaceChildren();
        cells.resetLive();
        previews.clear();
        const railSelect = selectInput(String(state.selected), state.model.rules.map((r, i) => ({ value: String(i), label: r.name || 'unnamed' })), (v) => deps.rail.select(Number(v)), 'Rule');
        railSelect.className = 're-rail-select';
        if (state.model.rules.length === 0) {
            pane.append(el('p', { class: 're-empty' }, [
                'No rules yet. Add one, or ',
                el('button', { class: 're-link', type: 'button', onclick: () => {
                        state.parseError = null;
                        state.model = exampleModel();
                        state.selected = 0;
                        deps.render();
                    } }, ['Load example']),
                '.',
            ]));
            return;
        }
        if (state.selected >= state.model.rules.length)
            state.selected = 0;
        const index = state.selected;
        const rule = state.model.rules[index];
        pane.append(railSelect);
        const nameInput = textInput(rule.name, (v) => { rule.name = v; }, { label: 'Rule name', placeholder: 'rule-name' });
        nameInput.className = 're-name';
        const head = el('div', { class: 're-pane-head' }, [
            nameInput,
            el('button', { class: 're-link re-danger', type: 'button', onclick: () => deps.rail.remove(index) }, ['Delete']),
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
                'aria-selected': String(key === state.activeSheet),
                onclick: () => { state.activeSheet = key; deps.bar.clear(); applyVisibility(); },
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
        applyVisibility();
    }
    function applyVisibility() {
        for (const b of Array.from(pane.querySelectorAll('.re-sheet-block')))
            b.hidden = state.narrow && b.dataset.sheet !== state.activeSheet;
        for (const t of Array.from(pane.querySelectorAll('.re-tab')))
            t.setAttribute('aria-selected', String(t.dataset.sheet === state.activeSheet));
    }
    /** Add a row, then focus its first field after the render. */
    function addAndFocus(loc) {
        state.focusNext = locKey(loc);
        deps.render();
    }
    function renderVariables(rule, index) {
        const { title, help } = sheetTitle('', HELP.variables, ['Variables'], 'Variables');
        const sheet = el('div', { class: 're-sheet re-sheet-vars' }, [
            sheetHead(['Name', 'Formula', 'Formula result', 'Description'], ['Letters, digits and underscores', 'An Excel-style formula', 'Live value from the gateway', 'What the value means']),
        ]);
        rule.variables.forEach((v, i) => sheet.append(variableRow(v, i, rule, index)));
        const full = rule.variables.length >= LIMITS.maxVariables;
        sheet.append(addRow(rule.variables.length + 1, 'Add', () => {
            rule.variables.push({ name: '', formula: '' });
            addAndFocus({ rule: index, field: 'variable', variable: rule.variables.length - 1 });
        }, full ? `A rule holds at most ${LIMITS.maxVariables} variables.` : undefined));
        const block = el('div', { class: 're-sheet-block' }, [title, help, sheet]);
        block.dataset.loc = locKey({ rule: index, field: 'variable' });
        return block;
    }
    function variableRow(v, i, rule, index) {
        const remove = () => { rule.variables.splice(i, 1); deps.render(); };
        const removeLabel = 'Delete variable';
        const who = v.name || `Row ${i + 1}`;
        const nameInput = textInput(v.name, (val) => { v.name = val; }, { label: `Name of variable ${i + 1}`, placeholder: 'name' });
        const descInput = textInput(v.description ?? '', (val) => { if (val)
            v.description = val;
        else
            delete v.description; }, { label: `Description of variable ${i + 1}`, prose: true });
        return el('div', { class: 're-row' }, [
            gutter(i + 1),
            cell('', 'Name', { rule: index, field: 'variable', variable: i }, [nameInput], { address: `${who} · Name`, input: nameInput, remove, removeLabel }),
            formulaCell(v.formula, (val) => { v.formula = val; }, { label: `Formula of variable ${i + 1}`, column: 'Formula', loc: { rule: index, field: 'formula', variable: i }, placeholder: 'TAG("device", "tag")', address: `${who} · Formula`, remove, removeLabel }),
            liveCell('Formula result', () => ({ rule: index, kind: 'variable', name: v.name }), { address: `${who} · Formula result`, remove, removeLabel }),
            cell('re-cell-text', 'Description', { rule: index, field: 'description', variable: i }, [descInput], { address: `${who} · Description`, input: descInput, remove, removeLabel }),
            removeBtn('Delete variable', remove),
        ]);
    }
    function renderWhen(rule, index) {
        const match = pickInput(rule.match, MATCH_OPTIONS, (v) => { rule.match = v; deps.refresh(); }, 'Match');
        const edge = pickInput(rule.edge ?? 'none', EDGE_OPTIONS, (v) => { if (v === 'none')
            delete rule.edge;
        else
            rule.edge = v; deps.refresh(); }, 'Trigger');
        const { title, help } = sheetTitle('re-when-title', HELP.when, ['When', match, 'of these', edge], 'When');
        const sheet = el('div', { class: 're-sheet re-sheet-when' }, [
            sheetHead(['Condition', 'Condition result', 'Description'], ['A formula that is true or false', 'Live value from the gateway', 'What the row means. The alarm can quote it.']),
        ]);
        rule.conditions.forEach((c, i) => sheet.append(conditionRow(c, i, rule, index)));
        const full = rule.conditions.length >= LIMITS.maxChildren;
        sheet.append(addRow(rule.conditions.length + 1, 'Add', () => {
            rule.conditions.push({ expr: '' });
            addAndFocus({ rule: index, field: 'expr', condition: rule.conditions.length - 1 });
        }, full ? `A rule holds at most ${LIMITS.maxChildren} conditions.` : undefined));
        const block = el('div', { class: 're-sheet-block' }, [title, help, sheet]);
        block.dataset.loc = locKey({ rule: index, field: 'condition' });
        return block;
    }
    function conditionRow(c, i, rule, index) {
        const remove = () => { rule.conditions.splice(i, 1); deps.render(); };
        const removeLabel = 'Delete condition';
        const who = `Row ${i + 1}`;
        const descInput = textInput(c.description ?? '', (val) => { if (val)
            c.description = val;
        else
            delete c.description; }, { label: `Description of condition ${i + 1}`, prose: true });
        return el('div', { class: 're-row' }, [
            gutter(i + 1),
            formulaCell(c.expr, (val) => { c.expr = val; }, { label: `Condition ${i + 1}`, column: 'Condition', loc: { rule: index, field: 'expr', condition: i }, placeholder: 'temp > 50', address: `${who} · Condition`, remove, removeLabel }),
            liveCell('Condition result', () => ({ rule: index, kind: 'condition', index: i }), { address: `${who} · Condition result`, remove, removeLabel }),
            cell('re-cell-text', 'Description', { rule: index, field: 'description', condition: i }, [descInput], { address: `${who} · Description`, input: descInput, remove, removeLabel }),
            removeBtn('Delete condition', remove),
        ]);
    }
    function renderThen(rule, index) {
        const { title, help } = sheetTitle('', HELP.then, ['Then'], 'Then');
        const sheet = el('div', { class: 're-sheet re-sheet-then' }, [
            sheetHead(['Action', 'Field', 'Formula'], ['What happens when the rule fires', 'The field of the action', 'Text as sent, or a formula when it starts with =']),
        ]);
        const rows = thenRows(rule);
        rows.forEach((row, i) => sheet.append(thenRow(row, i, rule, index)));
        sheet.append(addRow(rows.length + 1, 'Add', () => {
            rule.actions.push({ topic: '' });
            addAndFocus({ rule: index, field: 'topic', action: rule.actions.length - 1 });
        }));
        const cooldown = textInput(rule.cooldown ?? '', (v) => { if (v)
            rule.cooldown = v;
        else
            delete rule.cooldown; }, { label: 'Cooldown', placeholder: '0s' });
        cooldown.title = 'A time: 30s, 1m30s, 500ms. Units: ns, us, ms, s, m, h. Leave it blank to fire every time.';
        const cool = el('div', { class: 're-cool' }, ['Actions are fired at most once every', cooldown]);
        cool.dataset.loc = locKey({ rule: index, field: 'cooldown' });
        sheet.append(cool);
        return el('div', { class: 're-sheet-block' }, [title, help, sheet]);
    }
    function thenRow(row, i, rule, index) {
        const current = row.kind === 'publish' ? 'publish' : rule.incident.severity;
        const value = thenGet(rule, row);
        const loc = row.kind === 'publish'
            ? { rule: index, field: THEN_ISSUE_FIELD[row.field], action: row.index }
            : { rule: index, field: THEN_ISSUE_FIELD[row.field] };
        const placeholder = row.field === 'topic' ? 'camera/record' : row.field === 'payload' ? '{}' : row.field === 'summary' ? 'Lead with the fix, in a few words' : '';
        const remove = () => {
            if (row.kind === 'publish')
                rule.actions.splice(row.index, 1);
            else
                rule.incident = null;
            deps.render();
        };
        // Every row of an action goes with it, so the button never says "row".
        const removeLabel = row.kind === 'publish' ? 'Delete action' : 'Delete alarm';
        const who = THEN_LABEL[row.field];
        const formula = formulaCell(value, (v) => thenSet(rule, row, v), { label: `${THEN_LABEL[row.field]} of row ${i + 1}`, column: 'Formula', loc, thenField: true, prose: THEN_PROSE.has(row.field), placeholder, address: `${who} · Formula`, remove, removeLabel });
        // A formula shows what it resolves to as a line under the value; literal
        // text is sent as written and needs no preview. Recomputed on every
        // refresh: the preview also reads condition 1's description.
        const preview = el('p', { class: 're-preview', hidden: true });
        formula.append(preview);
        const updatePreview = () => {
            const text = thenGet(rule, row);
            const shown = isFormula(text) ? previewThen(text, rule) : null;
            preview.hidden = shown === null;
            preview.textContent = shown ?? '';
        };
        updatePreview();
        previews.add(updatePreview);
        // One Action cell and one delete button per action, like merged cells: the
        // first row holds them, the rows under it continue the cells. Delete
        // removes the whole action, so one button says so.
        const head = isGroupHead(row);
        const action = head
            ? cell('re-cell-pick', 'Action', null, [pickInput(current, ACTION_OPTIONS, (v) => setAction(row, v, rule), `Action of row ${i + 1}`)], { address: `${who} · Action`, remove, removeLabel })
            : el('div', { class: 're-cell-merged', 'aria-hidden': 'true' });
        const trash = head
            ? removeBtn(removeLabel, remove)
            : el('div', { class: 're-cell-merged re-cell-merged-end', 'aria-hidden': 'true' });
        return el('div', { class: 're-row' }, [
            gutter(i + 1),
            action,
            cell('re-cell-field', 'Field', null, [THEN_LABEL[row.field]], { address: `${who} · Field`, remove, removeLabel }),
            formula,
            trash,
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
                deps.refresh();
                return;
            }
            rule.actions.splice(row.index, 1);
            if (rule.incident)
                rule.incident.severity = severity;
            else
                rule.incident = { source: '', severity, summary: '' };
        }
        deps.render();
    }
    return {
        render,
        applyVisibility,
        updatePreviews: () => { for (const update of previews)
            update(); },
    };
}
//# sourceMappingURL=sheets.js.map