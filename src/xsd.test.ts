// Keeps schema/rules.xsd in sync with the editor core (parse + validate).
//
// The contract: for every fixture below, the XSD verdict must equal the
// editor verdict (parse() succeeds and validate() returns no errors), except
// for two explicit lists:
//   - APP_LEVEL:     the editor rejects but XSD 1.0 cannot express the rule
//   - XSD_STRICTER:  the XSD rejects but the editor does not check
// Every entry in those lists carries the reason, and the README lists them.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateXML } from 'xmllint-wasm';
import { parse, validate } from './parse.js';
import { serialize } from './serialize.js';
import { COOLDOWN_PATTERN, LIMITS, VARIABLE_NAME_PATTERN } from './model.js';
import { RULES_XSD_PATH } from './index.js';
import type { RulesModel } from './model.js';

// Resolve through the file path, not `new URL(x, import.meta.url)`: Vite
// rewrites that literal pattern to a dev-server URL inside vitest.
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const XSD_FILE = resolve(ROOT, 'schema', 'rules.xsd');
const XSD = readFileSync(XSD_FILE, 'utf8');
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { version: string };

// ---- helpers -------------------------------------------------------------

async function xsdErrors(xml: string): Promise<string[]> {
  const r = await validateXML({
    xml: [{ fileName: 'rules.xml', contents: xml }],
    schema: [{ fileName: 'rules.xsd', contents: XSD }],
  });
  return r.valid ? [] : r.errors.map((e) => e.message);
}

/** The editor's verdict: [] when parse() and validate() both accept. */
function editorErrors(xml: string): string[] {
  try {
    return validate(parse(xml));
  } catch (e) {
    return [String((e as Error).message)];
  }
}

/** The xs:pattern of one named simple type. */
function patternOf(typeName: string): string | null {
  const m = new RegExp(`<xs:simpleType name="${typeName}">[\\s\\S]*?<xs:pattern value="([^"]+)"/>`).exec(XSD);
  return m ? m[1] : null;
}

// ---- fixtures -----------------------------------------------------------
//
// The fixtures live as files under schema/fixtures/, one per case, so this
// suite and the Go engine (rules-engine/rulesxml) hold the same schema to the
// same verdicts. schema/fixtures/reasons.json carries the reason of each
// deliberate divergence.

const FIXTURES = resolve(ROOT, 'schema', 'fixtures');

/** The fixtures of one class, as name to XML, ordered by file name. */
function load(dir: string): [string, string][] {
  return readdirSync(resolve(FIXTURES, dir))
    .filter((f) => f.endsWith('.xml'))
    .sort()
    .map((f) => [f.replace(/\.xml$/, ''), readFileSync(resolve(FIXTURES, dir, f), 'utf8')]);
}

const REASONS = JSON.parse(readFileSync(resolve(FIXTURES, 'reasons.json'), 'utf8')) as Record<string, Record<string, string>>;

const VALID = load('valid');
const INVALID = load('invalid');
const APP_LEVEL = load('app-level');
const XSD_STRICTER = load('xsd-stricter');

// ---- tests ---------------------------------------------------------------

describe('schema/rules.xsd', () => {
  it('carries the package.json version', () => {
    const m = XSD.match(/<xs:schema\b[^>]*\bversion="([^"]+)"/);
    expect(m, 'xs:schema has no version attribute').not.toBeNull();
    expect(m![1]).toBe(PKG.version);
  });

  it('keeps the cooldown pattern identical to model.ts', () => {
    expect(patternOf('goDuration')).toBe(COOLDOWN_PATTERN);
  });

  it('keeps the identifier pattern identical to model.ts', () => {
    expect(patternOf('identifier')).toBe(VARIABLE_NAME_PATTERN);
  });

  it('keeps the limits identical to model.ts', () => {
    expect(XSD).toContain(`<xs:element name="var" type="var" minOccurs="0" maxOccurs="${LIMITS.maxVariables}"/>`);
    expect(XSD).toMatch(new RegExp(`<xs:simpleType name="text">[\\s\\S]*?<xs:maxLength value="${LIMITS.maxText}"/>`));
    expect(XSD).toMatch(new RegExp(`<xs:simpleType name="summary">[\\s\\S]*?<xs:maxLength value="${LIMITS.maxSummary}"/>`));
  });

  it('is well-formed and is itself a valid schema', async () => {
    // xmllint reports schema errors before document errors; a trivially valid
    // document isolates schema problems.
    expect(await xsdErrors('<rules/>')).toEqual([]);
  });

  it('rejects a description on the top-level group, which no row could keep', async () => {
    const xml = readFileSync(resolve(FIXTURES, 'xsd-stricter', 'description-on-the-top-level-group.xml'), 'utf8');
    expect(await xsdErrors(xml)).not.toEqual([]);
  });

  it('is reachable through RULES_XSD_PATH', () => {
    expect(RULES_XSD_PATH.startsWith('file:')).toBe(true);
    expect(fileURLToPath(RULES_XSD_PATH)).toBe(XSD_FILE);
    expect(readFileSync(fileURLToPath(RULES_XSD_PATH), 'utf8')).toBe(XSD);
  });

  describe('accepts what the editor accepts', () => {
    for (const [name, xml] of VALID) {
      it(name, async () => {
        expect(editorErrors(xml), 'fixture must be editor-valid').toEqual([]);
        expect(await xsdErrors(xml)).toEqual([]);
      });
    }
  });

  describe('rejects what the editor rejects', () => {
    for (const [name, xml] of INVALID) {
      it(name, async () => {
        expect(editorErrors(xml), 'fixture must be editor-invalid').not.toEqual([]);
        expect(await xsdErrors(xml)).not.toEqual([]);
      });
    }
  });

  describe('application-level checks the XSD cannot express', () => {
    for (const [name, xml] of APP_LEVEL) {
      it(`${name} (${REASONS['app-level'][name]})`, async () => {
        expect(editorErrors(xml), 'editor must reject').not.toEqual([]);
        expect(await xsdErrors(xml), 'XSD cannot express this, must accept').toEqual([]);
      });
    }
  });

  describe('checks where the XSD is stricter than the editor', () => {
    for (const [name, xml] of XSD_STRICTER) {
      it(`${name} (${REASONS['xsd-stricter'][name]})`, async () => {
        expect(editorErrors(xml), 'editor does not check this').toEqual([]);
        if (name.startsWith('description-on-a-folded')) return; // accepted by both, see reason
        expect(await xsdErrors(xml), 'XSD must reject').not.toEqual([]);
      });
    }
  });

  describe('serialize() output validates', () => {
    for (const [name, xml] of VALID) {
      it(name, async () => {
        const model: RulesModel = parse(xml);
        expect(await xsdErrors(serialize(model))).toEqual([]);
      });
    }

    it('round-trip model from parse.test.ts', async () => {
      const model: RulesModel = {
        rules: [
          {
            name: 'alarm-camera',
            cooldown: '45s',
            edge: 'rising',
            variables: [{ name: 'temp', formula: 'TAG("vibration1", "temperature")', description: 'Housing' }],
            match: 'all',
            conditions: [{ expr: 'TAG("AlarmActive") = true' }, { expr: 'temp >= 85.0', description: 'hot' }],
            actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
            incident: { source: 'plc1', severity: 'critical', summary: 'Machine alarm active', firstStep: 'Look.', cause: '=condition.description' },
          },
        ],
      };
      expect(await xsdErrors(serialize(model))).toEqual([]);
    });

    it('escaped metacharacters in attribute values', async () => {
      const model: RulesModel = {
        rules: [
          {
            name: 'r',
            variables: [{ name: 'v', formula: '"x & y < z" & \'s\'' }],
            match: 'any',
            conditions: [{ expr: 'TAG("a") = "x & y < z ""q"" \'s\'"', description: '<b> & "c"' }],
            actions: [{ topic: 't', payload: '{"a":"<b>"}' }],
            incident: null,
          },
        ],
      };
      expect(await xsdErrors(serialize(model))).toEqual([]);
    });
  });
});
