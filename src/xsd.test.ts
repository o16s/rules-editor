// Keeps schema/rules.xsd in sync with the editor core (parse + validate).
//
// The contract: for every fixture below, the XSD verdict must equal the
// editor verdict (parse() succeeds and validate() returns no errors), except
// for two explicit lists:
//   - APP_LEVEL:     the editor rejects but XSD 1.0 cannot express the rule
//   - XSD_STRICTER:  the XSD rejects but the editor does not check
// Every entry in those lists carries the reason, and the README lists them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

const rule = (name: string, body: string, attrs = ''): string => `<rule name="${name}"${attrs}>${body}</rule>`;
const rules = (...inner: string[]): string => `<rules>${inner.join('')}</rules>`;
const COND = '<cond tag="a" op="eq" value="1"/>';
const EXPR = '<cond expr="TAG(&quot;a&quot;) = 1"/>';
const ACTIONS = '<actions><publish topic="t"/></actions>';
const INCIDENT = '<incident source="plc1" severity="info" summary="s"/>';
const VARS = `<variables><var name="temp" formula='TAG("vibration1", "temperature")' description="Housing"/><var name="hot" formula="temp &gt; 50"/></variables>`;

/** A leaf wrapped in `n` nested <and> groups. */
function nested(n: number): string {
  let s = COND;
  for (let i = 0; i < n; i++) s = `<and>${s}</and>`;
  return s;
}

// ---- fixtures ------------------------------------------------------------

/** XML the editor accepts (parse + validate). Includes the parse.test.ts fixtures that are complete rules. */
const VALID: Record<string, string> = {
  'empty document (serialize of no rules)': '<rules>\n</rules>\n',
  'parse.test: actions and incident':
    `<rules><rule name="r"><cond tag="a" op="eq" value="true"/><actions><publish topic="camera/record" payload='{"duration":40}'/><publish topic="t"/></actions><incident source="plc1" severity="critical" summary="Boom"/></rule></rules>`,
  'device, cooldown, edge': rules(
    rule('r', '<cond device="vibration1" tag="temperature" op="gt" value="50.0"/>' + ACTIONS, ' cooldown="30s" edge="rising"')
  ),
  'operator alias &gt;=': rules(rule('r', '<cond tag="a" op="&gt;=" value="5"/>' + ACTIONS)),
  'every canonical operator and alias': rules(
    ...['eq', 'neq', 'lt', 'leq', 'gt', 'geq', '=', '==', '!=', '&lt;', '&lt;=', '&gt;', '&gt;='].map((op, i) =>
      rule(`r${i}`, `<cond tag="a" op="${op}" value="1"/>` + ACTIONS)
    )
  ),
  'changed operator without value': rules(rule('r', '<cond tag="AlarmCode" op="changed"/>' + ACTIONS)),
  'nested and/or groups': rules(
    rule(
      'r',
      '<or><and><cond tag="a" op="eq" value="true"/><cond tag="b" op="gt" value="1"/></and><cond tag="c" op="eq" value="true"/></or>' +
        ACTIONS
    )
  ),
  'incident only': rules(rule('r', COND + INCIDENT)),
  'actions only': rules(rule('r', COND + ACTIONS)),
  'edge none explicitly': rules(rule('r', COND + ACTIONS, ' edge="none"')),
  'cooldown forms from the reference': rules(
    ...['30s', '1m', '1m30s', '500ms', '0', '1.5s', '2h'].map((cd, i) => rule(`r${i}`, COND + ACTIONS, ` cooldown="${cd}"`))
  ),
  'summary of 120 astral characters': rules(
    rule('r', COND + `<incident source="s" severity="info" summary="${'\u{1F600}'.repeat(LIMITS.maxSummary)}"/>`)
  ),
  'summary of exactly 120 characters': rules(
    rule('r', COND + `<incident source="s" severity="warning" summary="${'x'.repeat(LIMITS.maxSummary)}"/>`)
  ),
  'group with exactly 16 children': rules(rule('r', `<and>${COND.repeat(LIMITS.maxChildren)}</and>` + ACTIONS)),
  'nesting at the maximum depth (leaf at level 4)': rules(rule('r', nested(LIMITS.maxDepth - 1) + ACTIONS)),
  'exactly 1000 rules': rules(...Array.from({ length: LIMITS.maxRules }, (_, i) => rule(`r${i}`, COND + ACTIONS))),
  // ---- v0.3 ----
  'formula condition': rules(rule('r', EXPR + ACTIONS)),
  'formula condition with description': rules(rule('r', '<cond expr="TAG(&quot;a&quot;)" description="PLC alarm bit"/>' + ACTIONS)),
  'variables and conditions over them': rules(rule('r', VARS + '<or><cond expr="hot"/><cond expr="temp &gt; 60" description="hot"/></or>' + ACTIONS)),
  'empty variables block': rules(rule('r', '<variables/>' + EXPR + ACTIONS)),
  'exactly 64 variables': rules(
    rule('r', `<variables>${Array.from({ length: LIMITS.maxVariables }, (_, i) => `<var name="v${i}" formula="${i}"/>`).join('')}</variables>` + EXPR + ACTIONS)
  ),
  'description on a group': rules(rule('r', `<or description="either">${EXPR}${EXPR}</or>` + ACTIONS)),
  'description of exactly 240 characters': rules(rule('r', `<cond expr="TAG(&quot;a&quot;) = 1" description="${'x'.repeat(LIMITS.maxText)}"/>` + ACTIONS)),
  'incident with first_step and cause': rules(
    rule('r', EXPR + `<incident source="s" severity="critical" summary="Press guard alarm on cell 3" first_step="Watch the clip." cause='=condition.description &amp; ". The PLC set its own bit."'/>`)
  ),
  'formula Then fields': rules(rule('r', EXPR + `<actions><publish topic='="a/" &amp; "b"' payload="=condition.description"/></actions>`)),
  'mixed v0.2 leaves and v0.3 rows in one group': rules(rule('r', `<and>${COND}${EXPR}</and>` + ACTIONS)),
  'the 13a rule': `<rules>
  <rule name="alarm-camera" cooldown="45s" edge="rising">
    <variables>
      <var name="alarm_active" formula='TAG("plc1", "AlarmActive")' description="Cell 3 PLC has set its own alarm bit"/>
      <var name="temp" formula='TAG("vibration1", "temperature")' description="Press motor housing temperature"/>
      <var name="temp_rate" formula="RATE(temp, 30min)" description="How fast the housing is heating, over 30 min"/>
      <var name="milk_temp" formula='TAG("bulk1", "milk_temperature")'/>
      <var name="door_changed" formula='CHANGED(TAG("bulk1", "door_state"))'/>
      <var name="status_word" formula='TAG("plc1", "StatusWord")'/>
      <var name="guard_open" formula="BITAND(status_word, 4) != 0"/>
      <var name="in_manual" formula='BITAND(status_word, HEX2DEC("10")) != 0'/>
      <var name="alarm_byte" formula='TAG("plc1", "AlarmFlags")'/>
      <var name="any_plc_alarm" formula='BITAND(alarm_byte, HEX2DEC("FF")) != 0'/>
    </variables>
    <or>
      <cond expr="alarm_active" description="Cell 3 PLC raised its own alarm"/>
      <cond expr="temp &gt; 50" description="Housing above 50 °C"/>
      <cond expr="temp_rate &gt; 4" description="Housing heating faster than 4 °C/h"/>
      <cond expr="AND(milk_temp &gt; 3.6, door_changed)" description="Milk warm while the tank door moved"/>
      <cond expr="any_plc_alarm" description="Cell 3 PLC reports an alarm"/>
    </or>
    <actions>
      <publish topic="camera/record" payload='{"duration":40}'/>
    </actions>
    <incident source="Cell 3 press" severity="critical" summary="Press guard alarm on cell 3"
              first_step="Watch the 40 s camera clip before you open the cell."
              cause='=condition.description &amp; ". The press PLC set its own alarm bit. We read that bit and nothing upstream of it, so the reason sits in the PLC."'/>
  </rule>
</rules>`,
  'reference example: IO-Link': `<rules>
  <!-- Action + incident: vibration max alarm while running warm. -->
  <rule name="vibration1-alarm" cooldown="45s" edge="rising">
    <or>
      <and>
        <cond device="vibration1" tag="alert_vrms_max" op="eq" value="true"/>
        <cond device="vibration1" tag="temperature" op="gt" value="40.0"/>
      </and>
      <cond device="vibration1" tag="alert_acc_peak" op="eq" value="true"/>
    </or>
    <actions>
      <publish topic="sensingcam/sick1/trigger" payload='{"event_name":"alarm"}'/>
      <publish topic="iolink/vibration1/param/reset_alerts" payload='{}'/>
    </actions>
    <incident source="vibration1" severity="warning"
              summary="Vibration1 alarm triggered"/>
  </rule>
</rules>`,
  'reference example: PLC': `<rules>
  <rule name="alarm-camera" cooldown="45s" edge="rising">
    <cond tag="AlarmActive" op="eq" value="true"/>
    <actions>
      <publish topic="camera/record" payload='{"duration":40}'/>
    </actions>
    <incident source="plc1" severity="critical"
              summary="Machine alarm active"/>
  </rule>
  <rule name="alarm-hot" cooldown="30s" edge="rising">
    <and>
      <cond tag="AlarmActive" op="eq" value="true"/>
      <cond tag="Temperature" op="geq" value="85.0"/>
    </and>
    <incident source="plc1" severity="critical"
              summary="Alarm active while temperature high"/>
  </rule>
  <rule name="new-alarm-code" cooldown="5s" edge="rising">
    <and>
      <cond tag="AlarmCode" op="changed"/>
      <cond tag="AlarmCode" op="neq" value="0"/>
    </and>
    <actions>
      <publish topic="alerts/alarm_code" payload='{"event":"new_code"}'/>
    </actions>
  </rule>
</rules>`,
};

/** XML the editor rejects and the XSD must reject too. */
const INVALID: Record<string, string> = {
  'parse.test: leaf condition, no actions or incident':
    `<rules><rule name="alarm"><cond tag="AlarmActive" op="eq" value="true"/></rule></rules>`,
  'parse.test: device/cooldown/edge, no actions or incident':
    `<rules><rule name="r" cooldown="30s" edge="rising"><cond device="vibration1" tag="temperature" op="gt" value="50.0"/></rule></rules>`,
  'parse.test: alias, no actions or incident': `<rules><rule name="r"><cond tag="a" op="&gt;=" value="5"/></rule></rules>`,
  'parse.test: changed, no actions or incident': `<rules><rule name="r"><cond tag="AlarmCode" op="changed"/></rule></rules>`,
  'parse.test: nested groups, no actions or incident':
    `<rules><rule name="r"><or><and><cond tag="a" op="eq" value="true"/><cond tag="b" op="gt" value="1"/></and><cond tag="c" op="eq" value="true"/></or></rule></rules>`,
  'parse.test: malformed XML': '<rules><rule name="r"></rules>',
  'parse.test: root is not <rules>': '<config/>',
  'parse.test: unknown operator': `<rules><rule name="r"><cond tag="a" op="between" value="1"/>${ACTIONS}</rule></rules>`,
  'rule without name': rules(`<rule>${COND}${ACTIONS}</rule>`),
  'rule with empty name': rules(rule('', COND + ACTIONS)),
  'duplicate rule names': rules(rule('dup', COND + ACTIONS), rule('dup', COND + ACTIONS)),
  'invalid edge': rules(rule('r', COND + ACTIONS, ' edge="falling"')),
  'rule without condition': rules(rule('r', ACTIONS)),
  'rule with two top-level conditions': rules(rule('r', COND + COND + ACTIONS)),
  'unexpected element in rule': rules(rule('r', COND + ACTIONS + '<foo/>')),
  'cond with empty tag': rules(rule('r', '<cond tag="" op="eq" value="1"/>' + ACTIONS)),
  'cond with empty expr': rules(rule('r', '<cond expr=""/>' + ACTIONS)),
  'unexpected element in group': rules(rule('r', '<and><foo/></and>' + ACTIONS)),
  'empty group': rules(rule('r', '<and/>' + ACTIONS)),
  'empty nested group': rules(rule('r', '<and><or/></and>' + ACTIONS)),
  'group with 17 children': rules(rule('r', `<or>${COND.repeat(LIMITS.maxChildren + 1)}</or>` + ACTIONS)),
  'nested group with 17 children': rules(rule('r', `<and><or>${COND.repeat(LIMITS.maxChildren + 1)}</or></and>` + ACTIONS)),
  'nesting one level too deep (leaf at level 5)': rules(rule('r', nested(LIMITS.maxDepth) + ACTIONS)),
  'validate.test: nesting deeper than 4 levels': rules(rule('r', nested(5) + ACTIONS)),
  'publish without topic': rules(rule('r', COND + '<actions><publish payload="{}"/></actions>')),
  'publish with empty topic': rules(rule('r', COND + '<actions><publish topic=""/></actions>')),
  'non-publish element in actions': rules(rule('r', COND + '<actions><foo topic="t"/></actions>')),
  'incident without source': rules(rule('r', COND + '<incident severity="info" summary="s"/>')),
  'incident without severity': rules(rule('r', COND + '<incident source="s" summary="s"/>')),
  'incident with invalid severity': rules(rule('r', COND + '<incident source="s" severity="fatal" summary="s"/>')),
  'incident without summary': rules(rule('r', COND + '<incident source="s" severity="info"/>')),
  'incident with empty summary': rules(rule('r', COND + '<incident source="s" severity="info" summary=""/>')),
  'summary over 120 characters': rules(
    rule('r', COND + `<incident source="s" severity="info" summary="${'x'.repeat(LIMITS.maxSummary + 1)}"/>`)
  ),
  'first_step over 240 characters': rules(rule('r', COND + `<incident source="s" severity="info" summary="s" first_step="${'x'.repeat(LIMITS.maxText + 1)}"/>`)),
  'cause over 240 characters': rules(rule('r', COND + `<incident source="s" severity="info" summary="s" cause="${'x'.repeat(LIMITS.maxText + 1)}"/>`)),
  'description over 240 characters': rules(rule('r', `<cond expr="a = 1" description="${'x'.repeat(LIMITS.maxText + 1)}"/>` + ACTIONS)),
  'cooldown that is not a Go duration': rules(rule('r', COND + ACTIONS, ' cooldown="5d"')),
  'cooldown with a sign': rules(rule('r', COND + ACTIONS, ' cooldown="-30s"')),
  '1001 rules': rules(...Array.from({ length: LIMITS.maxRules + 1 }, (_, i) => rule(`r${i}`, COND + ACTIONS))),
  'var without name': rules(rule('r', '<variables><var formula="1"/></variables>' + EXPR + ACTIONS)),
  'var without formula': rules(rule('r', '<variables><var name="x"/></variables>' + EXPR + ACTIONS)),
  'var with empty formula': rules(rule('r', '<variables><var name="x" formula=""/></variables>' + EXPR + ACTIONS)),
  'var name starting with a digit': rules(rule('r', '<variables><var name="1x" formula="1"/></variables>' + EXPR + ACTIONS)),
  'var name with a space': rules(rule('r', '<variables><var name="milk temp" formula="1"/></variables>' + EXPR + ACTIONS)),
  'duplicate var names': rules(rule('r', '<variables><var name="x" formula="1"/><var name="x" formula="2"/></variables>' + EXPR + ACTIONS)),
  '65 variables': rules(
    rule('r', `<variables>${Array.from({ length: LIMITS.maxVariables + 1 }, (_, i) => `<var name="v${i}" formula="${i}"/>`).join('')}</variables>` + EXPR + ACTIONS)
  ),
  'non-var element in variables': rules(rule('r', '<variables><foo/></variables>' + EXPR + ACTIONS)),
};

/**
 * The editor rejects these, but XSD 1.0 cannot express the rule. They stay
 * application-level checks in validate() or parse(). The XSD must ACCEPT them.
 */
const APP_LEVEL: Record<string, { xml: string; reason: string }> = {
  'comparison operator without value': {
    xml: rules(rule('r', '<cond tag="a" op="gt"/>' + ACTIONS)),
    reason: 'value is required for every op except changed; XSD 1.0 cannot make one attribute depend on another',
  },
  'comparison operator with empty value': {
    xml: rules(rule('r', '<cond tag="a" op="eq" value=""/>' + ACTIONS)),
    reason: 'same as above: the value constraint depends on op',
  },
  'cond without tag or expr': {
    xml: rules(rule('r', '<cond op="eq" value="1"/>' + ACTIONS)),
    reason: 'a cond needs expr, or tag and op; XSD 1.0 cannot require one attribute or another',
  },
  'cond with tag but no op': {
    xml: rules(rule('r', '<cond tag="a" value="1"/>' + ACTIONS)),
    reason: 'same as above: op is required only in the tag form',
  },
  'cond with both expr and tag': {
    xml: rules(rule('r', '<cond expr="a" tag="a" op="eq" value="1"/>' + ACTIONS)),
    reason: 'the two forms are exclusive; XSD 1.0 cannot forbid an attribute combination',
  },
  'formula that does not parse': {
    xml: rules(rule('r', '<cond expr="temp &gt;"/>' + ACTIONS)),
    reason: 'the schema cannot parse a formula',
  },
  'unknown function': {
    xml: rules(rule('r', '<cond expr="NOPE(1)"/>' + ACTIONS)),
    reason: 'the function registry lives in formula.ts',
  },
  'unresolved variable reference': {
    xml: rules(rule('r', '<cond expr="temp &gt; 50"/>' + ACTIONS)),
    reason: 'a name must resolve inside the rule; XSD 1.0 has no keyref into attribute text',
  },
  'variable cycle': {
    xml: rules(rule('r', '<variables><var name="a" formula="b"/><var name="b" formula="a"/></variables><cond expr="a"/>' + ACTIONS)),
    reason: 'cycle detection needs the formula graph',
  },
  'reserved variable name': {
    xml: rules(rule('r', '<variables><var name="TAG" formula="1"/></variables>' + EXPR + ACTIONS)),
    reason: 'the reserved list is the function registry',
  },
  'condition that is a number': {
    xml: rules(rule('r', '<cond expr="1 + 1"/>' + ACTIONS)),
    reason: 'type inference happens in validate()',
  },
  'condition.description outside a Then field': {
    xml: rules(rule('r', '<cond expr="condition.description = &quot;x&quot;"/>' + ACTIONS)),
    reason: 'the context object is only defined while an action fires',
  },
  'Then field formula that does not parse': {
    xml: rules(rule('r', EXPR + '<actions><publish topic="=("/></actions>')),
    reason: 'the schema cannot parse a formula',
  },
};

/**
 * The XSD rejects these, but the editor does not check them. Listed so the
 * difference is explicit. The XSD must REJECT them; the editor accepts them.
 */
const XSD_STRICTER: Record<string, { xml: string; reason: string }> = {
  'empty <actions/> next to an incident': {
    xml: rules(rule('r', COND + '<actions/>' + INCIDENT)),
    reason: '<actions> holds one or more <publish>; parse() maps an empty <actions/> to no actions',
  },
  'children out of documented order': {
    xml: rules(rule('r', INCIDENT + ACTIONS + COND)),
    reason: 'the XSD fixes the order variables, condition, actions, incident; parse() accepts any order and serialize() always emits this order',
  },
  'variables after the condition': {
    xml: rules(rule('r', EXPR + '<variables/>' + ACTIONS)),
    reason: 'same as above: <variables> comes first in the XSD; parse() accepts it anywhere',
  },
  'unknown attribute': {
    xml: rules(rule('r', '<cond tag="a" op="eq" value="1" x="y"/>' + ACTIONS, ' foo="bar"')),
    reason: 'the XSD allows only the documented attributes; parse() ignores attributes it does not know',
  },
  'empty optional attributes': {
    xml: rules(rule('r', '<cond device="" tag="a" op="eq" value="1"/>' + ACTIONS, ' cooldown="" edge=""')),
    reason: 'the XSD rejects "" for edge, cooldown, and device; parse() treats an empty attribute as absent',
  },
  'stray content the parser ignores': {
    xml: rules(rule('r', '<and>text<cond tag="a" op="eq" value="1"><foo/></cond><cond expr="TAG(&quot;b&quot;)"/></and>' + ACTIONS)),
    reason: 'the XSD allows no text in groups and no children in <cond>; parse() skips text nodes and never looks inside <cond>',
  },
  'operator with surrounding whitespace': {
    xml: rules(rule('r', '<cond tag="a" op=" eq " value="1"/>' + ACTIONS)),
    reason: 'the XSD enumeration is exact; canonicalOp() trims the token',
  },
  'description on a folded nested leaf': {
    xml: rules(rule('r', '<and><or><cond expr="TAG(&quot;a&quot;)" description="kept?"/><cond expr="TAG(&quot;b&quot;)"/></or><cond expr="TAG(&quot;c&quot;)"/></and>' + ACTIONS)),
    reason: 'the XSD allows a description on every <cond>; parse() folds a nested group into one row and drops the descriptions of its leaves. Accepted by both, listed here because the round-trip is lossy',
  },
};

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

  it('is reachable through RULES_XSD_PATH', () => {
    expect(RULES_XSD_PATH.startsWith('file:')).toBe(true);
    expect(fileURLToPath(RULES_XSD_PATH)).toBe(XSD_FILE);
    expect(readFileSync(fileURLToPath(RULES_XSD_PATH), 'utf8')).toBe(XSD);
  });

  describe('accepts what the editor accepts', () => {
    for (const [name, xml] of Object.entries(VALID)) {
      it(name, async () => {
        expect(editorErrors(xml), 'fixture must be editor-valid').toEqual([]);
        expect(await xsdErrors(xml)).toEqual([]);
      });
    }
  });

  describe('rejects what the editor rejects', () => {
    for (const [name, xml] of Object.entries(INVALID)) {
      it(name, async () => {
        expect(editorErrors(xml), 'fixture must be editor-invalid').not.toEqual([]);
        expect(await xsdErrors(xml)).not.toEqual([]);
      });
    }
  });

  describe('application-level checks the XSD cannot express', () => {
    for (const [name, { xml, reason }] of Object.entries(APP_LEVEL)) {
      it(`${name} (${reason})`, async () => {
        expect(editorErrors(xml), 'editor must reject').not.toEqual([]);
        expect(await xsdErrors(xml), 'XSD cannot express this, must accept').toEqual([]);
      });
    }
  });

  describe('checks where the XSD is stricter than the editor', () => {
    for (const [name, { xml, reason }] of Object.entries(XSD_STRICTER)) {
      it(`${name} (${reason})`, async () => {
        expect(editorErrors(xml), 'editor does not check this').toEqual([]);
        if (name.startsWith('description on a folded')) return; // accepted by both, see reason
        expect(await xsdErrors(xml), 'XSD must reject').not.toEqual([]);
      });
    }
  });

  describe('serialize() output validates', () => {
    for (const [name, xml] of Object.entries(VALID)) {
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
