// Single entry: the editor component plus the rules.xml core
// (parse / serialize / validate) and the model types.
export * from './gui.js';
/**
 * Absolute `file:` URL of `schema/rules.xsd`, the XML Schema for rules.xml
 * that ships with this package. The schema is not embedded in the bundle;
 * read it from disk in Node:
 *
 *   import { readFileSync } from 'node:fs';
 *   const xsd = readFileSync(new URL(RULES_XSD_PATH), 'utf8');
 *
 * Resolved from a variable on purpose: bundlers rewrite the literal
 * `new URL('…', import.meta.url)` form into an asset URL.
 */
const moduleUrl = import.meta.url;
export const RULES_XSD_PATH = new URL('../schema/rules.xsd', moduleUrl).href;
//# sourceMappingURL=index.js.map