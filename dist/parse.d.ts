import type { RulesModel } from './model.js';
export declare class RulesParseError extends Error {
}
/** Parse rules.xml text into a model. Throws RulesParseError on invalid input. */
export declare function parse(xml: string): RulesModel;
/** Semantic checks beyond well-formedness. Returns human-readable messages. */
export declare function validate(model: RulesModel): string[];
//# sourceMappingURL=parse.d.ts.map