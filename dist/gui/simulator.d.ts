import type { Rule } from '../model.js';
import type { TagCatalog } from '../catalog.js';
import { type Simulation } from '../simulate.js';
export interface SimulatorState {
    /** Signal formula per tag key ("device/tag" or "tag"). */
    signals: Record<string, string>;
    /** Length of the run, seconds. */
    stop: number;
    /** Seconds between samples. */
    step: number;
    /** Where the value column reads, seconds. */
    cursor: number;
}
export interface SimulatorOptions {
    rule: Rule;
    /** Units and default values for the tags. */
    catalog?: TagCatalog | (() => TagCatalog);
    /** Signal formulas to start with. A tag without one holds its catalog value, or reads nothing. */
    signals?: Record<string, string>;
    /** Default 600. */
    stop?: number;
    /** Default 1. */
    step?: number;
    /** Default: the first fire, else the middle of the run. */
    cursor?: number;
    /** Shows "← rule name" at the top left and runs when it is clicked. */
    onBack?: () => void;
    /** After every run: a signal, the stop time, the step or the cursor changed. */
    onChange?: (state: SimulatorState, simulation: Simulation) => void;
}
export interface SimulatorHandle {
    /**
     * Run again with the current signals and settings. The engine answers
     * asynchronously, and the page has already redrawn when the promise
     * settles.
     */
    run(): Promise<Simulation>;
    /**
     * The first run. The engine loads once, so a host that wants to draw only
     * when there is something to draw awaits this.
     */
    ready(): Promise<Simulation>;
    /** The last answer. It is an empty run until the first one arrives. */
    getSimulation(): Simulation;
    getState(): SimulatorState;
    /**
     * Replace the rule and run. Signals for tags it still reads are kept. The
     * promise settles when the page has redrawn.
     */
    setRule(rule: Rule): Promise<Simulation>;
    setCursor(seconds: number): void;
    destroy(): void;
}
export declare function initSimulator(root: HTMLElement, opts: SimulatorOptions): SimulatorHandle;
/** Seconds from "600 s", "600", "2.5", or a Go duration such as "10m" or "1m30s". */
export declare function parseSeconds(text: string): number | null;
//# sourceMappingURL=simulator.d.ts.map