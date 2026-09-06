import { type EditorState } from './state.js';
import type { Bar } from './bar.js';
import type { Cells } from './cells.js';
import type { Rail } from './rail.js';
export interface SheetsDeps {
    state: EditorState;
    pane: HTMLElement;
    /** Unique per editor, for the tab and panel ids. */
    uid: number;
    cells: Cells;
    bar: Bar;
    rail: Rail;
    render: () => void;
    refresh: () => void;
}
export interface Sheets {
    /** Rebuild the pane for the selected rule. */
    render(): void;
    /** In narrow mode only the active sheet shows; wider, all three stack. */
    applyVisibility(): void;
    /** Recompute every Then result preview; runs on each refresh. */
    updatePreviews(): void;
}
export declare function createSheets(deps: SheetsDeps): Sheets;
//# sourceMappingURL=sheets.d.ts.map