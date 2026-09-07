import type { RulesModel } from './model.js';
import type { TagCatalog } from './catalog.js';
export declare class RulesParseError extends Error {
}
/**
 * Parse rules.xml text into a model. Throws RulesParseError on invalid input.
 *
 * With a catalog, a v0.2 `<cond tag op value>` is rewritten as the formula the
 * gateway evaluates: the value is read as the type of its field. Without one,
 * the shape of the value decides.
 */
export declare function parse(xml: string, catalog?: TagCatalog): RulesModel;
/**
 * A validation message plus where it belongs, so an editor can point at the
 * input that needs fixing. `rule` is an index into `model.rules`; `variable`,
 * `condition` and `action` are indexes into the rule's lists.
 */
export interface ValidationIssue {
    /** Human-readable message — the text `validate()` returns. */
    message: string;
    /** Index in `model.rules`, absent for a whole-file issue. */
    rule?: number;
    /** The input at fault, absent when the issue is about the rule as a whole. */
    field?: 'name' | 'cooldown' | 'variable' | 'formula' | 'condition' | 'expr' | 'description' | 'topic' | 'payload' | 'source' | 'summary' | 'first_step' | 'cause';
    /** Index in `rule.variables`, for a variable issue. */
    variable?: number;
    /** Index in `rule.conditions`, for a condition row issue. */
    condition?: number;
    /** Index in `rule.actions`, for a publish issue. */
    action?: number;
}
/** Semantic checks beyond well-formedness. Returns human-readable messages. */
export declare function validate(model: RulesModel): string[];
/** The same checks as `validate()`, each with the location of the problem. */
export declare function validateIssues(model: RulesModel): ValidationIssue[];
//# sourceMappingURL=parse.d.ts.map