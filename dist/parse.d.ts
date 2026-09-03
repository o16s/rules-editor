import type { RulesModel } from './model.js';
export declare class RulesParseError extends Error {
}
/** Parse rules.xml text into a model. Throws RulesParseError on invalid input. */
export declare function parse(xml: string): RulesModel;
/**
 * A validation message plus where it belongs, so an editor can point at the
 * input that needs fixing. `rule` is an index into `model.rules`; `path` is
 * the chain of child indexes from that rule's top-level condition down to the
 * element at fault (`[]` is the top-level condition itself).
 */
export interface ValidationIssue {
    /** Human-readable message — the text `validate()` returns. */
    message: string;
    /** Index in `model.rules`, absent for a whole-file issue. */
    rule?: number;
    /** The input at fault, absent when the issue is about the rule as a whole. */
    field?: 'name' | 'cooldown' | 'condition' | 'tag' | 'value' | 'topic' | 'source' | 'summary';
    /** Child indexes from the rule's top-level condition, for a condition issue. */
    path?: number[];
    /** Index in `rule.actions`, for a publish issue. */
    action?: number;
}
/** Semantic checks beyond well-formedness. Returns human-readable messages. */
export declare function validate(model: RulesModel): string[];
/** The same checks as `validate()`, each with the location of the problem. */
export declare function validateIssues(model: RulesModel): ValidationIssue[];
//# sourceMappingURL=parse.d.ts.map