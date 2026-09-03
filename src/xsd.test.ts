// Keeps schema/rules.xsd in sync with the package.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Resolve through the file path, not `new URL(x, import.meta.url)`: Vite
// rewrites that literal pattern to a dev-server URL inside vitest.
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const XSD = readFileSync(resolve(ROOT, 'schema', 'rules.xsd'), 'utf8');
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { version: string };

describe('schema/rules.xsd', () => {
  it('carries the package.json version', () => {
    const m = XSD.match(/<xs:schema\b[^>]*\bversion="([^"]+)"/);
    expect(m, 'xs:schema has no version attribute').not.toBeNull();
    expect(m![1]).toBe(PKG.version);
  });
});
