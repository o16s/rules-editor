// The Then sheet shows one row per field of an action: topic and payload of
// each publish, then source, title, first step and cause of the alarm. These
// helpers map a row to the model and back, and preview a Then formula.
import { isFormula, parseFormula } from '../formula.js';
export const THEN_LABEL = { topic: 'topic', payload: 'payload', source: 'source', summary: 'title', firstStep: 'first step', cause: 'cause' };
/** The `field` name in a ValidationIssue for each Then field. */
export const THEN_ISSUE_FIELD = {
    topic: 'topic', payload: 'payload', source: 'source', summary: 'summary', firstStep: 'first_step', cause: 'cause',
};
/** Free-text fields: title, first step and cause. Topic, payload and source are names. */
export const THEN_PROSE = new Set(['summary', 'firstStep', 'cause']);
/**
 * The incident fields the operator may add or drop. Source and title are
 * required; first step and cause show a row only when the incident has them,
 * and the Then sheet offers a control to add either one back.
 */
export const INCIDENT_OPTIONAL = ['firstStep', 'cause'];
/** True for the first row of an action: the one that carries the Action choice. */
export const isGroupHead = (row) => row.field === 'topic' || row.field === 'source';
export function thenRows(rule) {
    const rows = [];
    rule.actions.forEach((_, index) => rows.push({ kind: 'publish', index, field: 'topic' }, { kind: 'publish', index, field: 'payload' }));
    if (rule.incident) {
        rows.push({ kind: 'incident', field: 'source' }, { kind: 'incident', field: 'summary' });
        // First step and cause are optional: a row shows only when the field is set.
        for (const field of INCIDENT_OPTIONAL)
            if (rule.incident[field] !== undefined)
                rows.push({ kind: 'incident', field });
    }
    return rows;
}
export function thenGet(rule, row) {
    if (row.kind === 'publish')
        return rule.actions[row.index][row.field] ?? '';
    return rule.incident?.[row.field] ?? '';
}
export function thenSet(rule, row, value) {
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
export function previewThen(text, rule) {
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
//# sourceMappingURL=then-rows.js.map