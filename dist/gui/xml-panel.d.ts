import type { RulesModel } from '../model.js';
export interface XmlPanelDeps {
    /** The current model serialized. */
    xml: () => string;
    /** A parsed import: replace the model and re-render. */
    onImport: (model: RulesModel) => void;
}
export interface XmlPanel {
    element: HTMLElement;
    /** Copy and Download: gated while the file has issues. */
    copyBtn: HTMLButtonElement;
    exportBtn: HTMLButtonElement;
    /** Open the panel with the current file, or close it. */
    toggle(): void;
    /** Follow the model while the panel is open and not being edited. */
    sync(xml: string): void;
    /** Disable Copy and Download while there are issues. */
    gate(issues: number): void;
}
export declare function createXmlPanel(deps: XmlPanelDeps): XmlPanel;
//# sourceMappingURL=xml-panel.d.ts.map