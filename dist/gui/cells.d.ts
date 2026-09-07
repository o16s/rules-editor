import type { Bar } from './bar.js';
import type { Menu } from './menu.js';
import { type CellInfo, type EditorState, type Loc, type MonitorRef } from './state.js';
export interface CellsDeps {
    state: EditorState;
    menu: Menu;
    bar: Bar;
    /** Validate and notify, after a committed edit. */
    refresh: () => void;
}
export interface TextOptions {
    label: string;
    placeholder?: string;
    /** Prose keeps the phone keyboard's autocorrect; an identifier turns it off. */
    prose?: boolean;
    /** Sees every keystroke, for cosmetic updates only. */
    onDraft?: (v: string) => void;
    /** The autocomplete menu applies. */
    formula?: boolean;
}
export interface FormulaOptions {
    label: string;
    column: string;
    loc: Loc;
    /** Literal text unless the value starts with "=". */
    thenField?: boolean;
    /** Free text: the phone keyboard keeps autocorrect. Off for names, topics and payloads. */
    prose?: boolean;
    placeholder?: string;
    address?: string;
    remove?: () => void;
    /** What the bar's delete button says, when "Delete row" is not what happens. */
    removeLabel?: string;
}
export interface Cells {
    textInput(value: string, onCommit: (v: string) => void, o: TextOptions): HTMLInputElement;
    cell(cls: string, label: string, loc: Loc | null, children: Array<Node | string>, info?: Partial<CellInfo>): HTMLElement;
    formulaCell(value: string, onInput: (v: string, input: HTMLInputElement) => void, o: FormulaOptions): HTMLElement;
    resultCell(label: string, value: string | null | undefined, info?: Partial<CellInfo>): HTMLElement;
    liveCell(label: string, ref: () => MonitorRef, info: Partial<CellInfo>): HTMLElement;
    /** Re-read `monitor` for every result cell, in place. */
    refreshValues(): void;
    /** Forget the result cells of a pane about to be rebuilt. */
    resetLive(): void;
    removeBtn(title: string, fn: () => void): HTMLElement;
    gutter(n: number): HTMLElement;
    addRow(n: number, label: string, fn: () => void, disabledWhy?: string): HTMLElement;
    sheetHead(cols: string[], titles?: string[]): HTMLElement;
    sheetTitle(cls: string, help: string, children: Array<Node | string>, sheet: string): {
        title: HTMLElement;
        help: HTMLElement;
    };
}
export declare function createCells(deps: CellsDeps): Cells;
//# sourceMappingURL=cells.d.ts.map