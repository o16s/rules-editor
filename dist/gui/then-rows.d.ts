import type { Rule } from '../model.js';
import type { ValidationIssue } from '../parse.js';
export type ThenField = 'topic' | 'payload' | 'source' | 'summary' | 'firstStep' | 'cause';
export type ThenRow = {
    kind: 'publish';
    index: number;
    field: 'topic' | 'payload';
} | {
    kind: 'incident';
    field: 'source' | 'summary' | 'firstStep' | 'cause';
};
export declare const THEN_LABEL: Record<ThenField, string>;
/** The `field` name in a ValidationIssue for each Then field. */
export declare const THEN_ISSUE_FIELD: Record<ThenField, ValidationIssue['field']>;
export declare function thenRows(rule: Rule): ThenRow[];
export declare function thenGet(rule: Rule, row: ThenRow): string;
export declare function thenSet(rule: Rule, row: ThenRow, value: string): void;
/**
 * What a Then field shows as its result: literal text as is; a formula folded
 * as far as constants go, with condition.description read from the first
 * condition as a preview. Anything that needs live data gives null.
 */
export declare function previewThen(text: string, rule: Rule): string | null;
//# sourceMappingURL=then-rows.d.ts.map