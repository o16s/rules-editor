import type { Menu } from './menu.js';
import type { CellInfo, EditorState } from './state.js';
export interface BarDeps {
    state: EditorState;
    /** The pane the cells live in: taps are handled there, and it gets room under the bar. */
    pane: HTMLElement;
    menu: Menu;
    /** The validation message element shown for a marked node, or null. */
    messageFor: (node: HTMLElement) => HTMLElement | null;
}
export interface Bar {
    element: HTMLElement;
    /** The bar's text input. */
    input: HTMLInputElement;
    /** The input line: the autocomplete menu goes above it. */
    line: HTMLElement;
    /** Tell the bar how to edit a cell. */
    register(cell: HTMLElement, info: CellInfo): void;
    /** The in-cell input of the selected cell, if it has one. */
    selectedInput(): HTMLInputElement | undefined;
    select(cell: HTMLElement): void;
    /** Close the bar. By default the draft is committed first; Cancel and Delete pass false. */
    clear(commit?: boolean): void;
    /** Commit the selected cell's draft (a no-op when nothing changed). */
    commit(): void;
    /** Show the selected cell in the bar, or close the bar when there is none or the editor is wide. */
    update(): void;
    /** Forget the selection without a commit and close the bar; for a rebuild of the pane. */
    reset(): void;
    destroy(): void;
}
export declare function createBar(deps: BarDeps): Bar;
//# sourceMappingURL=bar.d.ts.map