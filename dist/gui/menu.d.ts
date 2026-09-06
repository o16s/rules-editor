import { type EditorState } from './state.js';
export interface MenuDeps {
    root: HTMLElement;
    state: EditorState;
    /** Where the menu goes for the bar's input: inside the bar, above its input line. Null for a cell input. */
    inline: (input: HTMLInputElement) => {
        container: HTMLElement;
        before: HTMLElement;
    } | null;
    /** The in-cell input an input stands for: the bar's input maps to the selected cell's. */
    cellInputOf: (input: HTMLInputElement) => HTMLInputElement | undefined;
}
export interface Menu {
    element: HTMLElement;
    /** Open, refresh or close the menu for the caret position in `input`. */
    maybe(input: HTMLInputElement): void;
    /** Keys the open menu consumes; false when the menu is closed for this input. */
    key(input: HTMLInputElement, e: KeyboardEvent): boolean;
    close(): void;
    isOpenFor(input: HTMLInputElement): boolean;
    /** A Then-field input: text unless the value starts with "=", so names complete only in a formula. */
    markThenInput(input: HTMLInputElement): void;
    destroy(): void;
}
export declare function createMenu(deps: MenuDeps): Menu;
//# sourceMappingURL=menu.d.ts.map