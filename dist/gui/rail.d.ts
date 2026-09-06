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
export declare function createRail(deps: RailDeps): Rail;
//# sourceMappingURL=rail.d.ts.map