export type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
export type Opt = {
    value: string;
    label: string;
};
export declare const clone: <T>(v: T) => T;
export declare function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, children?: Array<Node | string>): HTMLElementTagNameMap[K];
/** An inline icon from a static path list (never from user input). */
export declare function icon(paths: string): HTMLElement;
export declare const ICON_TRASH = "<path d=\"M2.5 4h9M5.5 4V2.5h3V4M4 4v7.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/>";
export declare const ICON_COPY = "<rect x=\"1.5\" y=\"1.5\" width=\"8\" height=\"8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><rect x=\"4.5\" y=\"4.5\" width=\"8\" height=\"8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/>";
/**
 * Identifiers must survive a phone keyboard: iOS otherwise capitalises the
 * first letter and autocorrects, so `alert_temp` is stored as `Alert_temp`
 * and no longer matches the field it names. Prose fields keep the defaults.
 */
export declare const identifierAttrs: <T extends HTMLElement>(input: T) => T;
export declare function selectInput(value: string, options: Opt[], onChange: (v: string) => void, label: string): HTMLSelectElement;
/**
 * A choice shown as text with a caret, styled like the text around it. The
 * native select sits on top, transparent and 16px, so a tap opens the
 * picker without iOS zooming and without the visible text changing size.
 */
export declare function pickInput(value: string, options: Opt[], onChange: (v: string) => void, label: string): HTMLElement;
//# sourceMappingURL=dom.d.ts.map