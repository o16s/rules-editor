/** One field a device exposes. `value` and `stale` are live data the host may bind. */
export interface TagEntry {
    tag: string;
    /** Engineering unit, shown beside the live value: "°C", "l/min". */
    unit?: string;
    description?: string;
    /** The current reading, as text, when the host has one. */
    value?: string;
    /** True when the host has not heard from this tag lately. */
    stale?: boolean;
}
/** A device and its tags. Omit `device` for a source with one implicit device (a PLC). */
export interface DeviceEntry {
    device?: string;
    description?: string;
    tags: TagEntry[];
}
export interface TagCatalog {
    devices: DeviceEntry[];
}
/** The caret sits inside a string argument of TAG(...). */
export interface TagContext {
    /** 0: the first argument (a device, or a tag of the implicit device); 1: the tag of `device`. */
    arg: 0 | 1;
    /** What is typed so far inside the quotes, before the caret. */
    prefix: string;
    /** The first argument's literal, when `arg` is 1. */
    device?: string;
    /** The string literal being typed, quotes included: `text.slice(start, end)`. */
    start: number;
    end: number;
}
export type TagChoice = {
    kind: 'device';
    device: string;
    entry: DeviceEntry;
} | {
    kind: 'tag';
    device?: string;
    entry: TagEntry;
};
/**
 * Where the caret is, when it is inside a string argument of TAG(...).
 * Scans `text` up to `caret`, tracking strings and the stack of open calls.
 */
export declare function tagContext(text: string, caret: number): TagContext | null;
/** The catalog entries that fit the context, best matches first. */
export declare function tagChoices(catalog: TagCatalog, ctx: TagContext): TagChoice[];
/**
 * The text after picking a choice: a device becomes `"device", "` with the
 * caret ready for the tag; a tag becomes `"tag"` and closes the call when
 * nothing does. `more` is true when the menu has a next step.
 */
export declare function applyTagChoice(text: string, ctx: TagContext, choice: TagChoice): {
    text: string;
    caret: number;
    more: boolean;
};
//# sourceMappingURL=catalog.d.ts.map