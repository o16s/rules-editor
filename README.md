# @octanis/rules-editor

A framework-free editor for the octaview Edge Hub **`rules.xml`** format, plus the
parse / serialize / validate core and the formula language. Vanilla TypeScript,
**zero runtime dependencies**, self-injecting scoped styles.

## Install

```bash
# HTTPS release tarball — works everywhere, including CI (no SSH key required)
npm install "https://github.com/o16s/rules-editor/archive/refs/tags/v0.3.0.tar.gz"
```

Prefer the tarball: prebuilt `dist/` is committed, so there is **no build step on
install** and **zero runtime dependencies** are pulled in.

<details>
<summary>git shorthand (needs SSH configured)</summary>

```bash
npm install github:o16s/rules-editor#v0.3.0
```

Convenient for local dev, but npm resolves `github:` to a `git+ssh://` URL, so it
requires an SSH key. It **fails in CI** (for example Cloudflare Pages) where none is
configured. Use the tarball URL there.
</details>

The package ships built ESM (`dist/*.js`) + type declarations (`dist/*.d.ts`).

## What the editor looks like

The editor is a spreadsheet. A rail on the left lists the rules. The pane on the
right shows the selected rule as three sheets:

| Sheet | Columns | One row is |
|-------|---------|------------|
| Variables | Name · Formula · Formula result · Description | a named formula, for example `temp = TAG("vibration1", "temperature")` |
| When | Condition · Condition result · Description | a formula that must be true, for example `temp > 50` |
| Then | Action · Field · Formula · Formula result | one field of an action: an MQTT topic or payload, or the alarm's source, title, first step, or cause |

The When heading reads "When **any** of these **becomes true**". The first
control is the match mode (`any` or `all`). The second is the trigger
(`becomes true` fires once on the false-to-true change, `is true` fires on every
cycle while true). The Then sheet ends with the cooldown: "Actions are fired at
most once every `45s`".

The result columns show live values when the host supplies them (see `monitor`
below). Without a host value the cell shows a dash. A Then field that is plain
text shows itself as its result. A Then field that is a formula shows a
preview: constants are folded and `condition.description` is read from the
first condition.

## Use the editor

Mount it into any element. It injects its own scoped styles (`.re-*`) and reads
the host's design tokens (`--accent`, `--ink`, `--font-body`, …) with fallbacks,
so it looks native inside octaview and works standalone.

```ts
import { initRulesEditor } from '@octanis/rules-editor';

const editor = initRulesEditor(document.getElementById('app')!, {
  // start from a file on disk — parse errors are reported, not thrown:
  initialXml: await (await fetch('/rules.xml')).text(),
  onChange: ({ xml, errors }) => {
    if (errors.length === 0) save(xml);
  },
  // live values for the result columns, when you have them:
  monitor: (ref) => ref.kind === 'variable' ? liveVariables[ref.name] : liveConditions[ref.index],
});

editor.getXml();     // current rules.xml
editor.getModel();   // deep copy of the model
editor.getErrors();  // validation messages ([] = valid)
editor.setModel(m);  // replace + re-render
editor.destroy();    // tear down
```

### Options (`RulesEditorOptions`)

| Option | Type | Notes |
|--------|------|-------|
| `initialXml` | `string` | Parsed internally. A **malformed** file does not throw: the editor opens empty and the parse error is surfaced through `onChange`'s `errors` (and the status line). Takes precedence over `initialModel`. A v0.2 file opens as formula rows. |
| `initialModel` | `RulesModel` | Start from a model instead of XML. Cloned; your object is not mutated. |
| `onChange` | `(s: { model, xml, errors }) => void` | Fires on mount and after every edit. |
| `monitor` | `(ref: MonitorRef) => string \| undefined` | Live values for the "Formula result" and "Condition result" cells. `ref` is `{ rule, kind: 'variable', name }` or `{ rule, kind: 'condition', index }`. Return `undefined` for a cell with no value. Called on every render. |

### Handle (`RulesEditorHandle`)

`getModel()` · `getXml()` · `getErrors()` · `setModel(model)` · `destroy()`

### Small screens

The editor works down to 320px wide. It adapts to **its own container**, not
just to the window, so it also reflows when embedded in a narrow column on a
wide screen. Below 900px the rule rail folds into a select above the sheets.

Below 560px the editor follows the phone model of Google Sheets. The sheet
stays a sheet: columns keep their widths, the sheet scrolls sideways inside
its frame, and the row numbers stay frozen on the left. Tabs show one sheet
at a time (Variables, When, Then). A tap selects a cell. A formula bar at the
bottom of the editor shows the cell's address and content; you edit there,
and confirm with the tick or cancel with the cross. The bar also offers
"Delete row" and shows the cell's validation message. Choice cells (Action,
match, trigger) open the native picker in place. Every control a finger can
focus is 16px or larger, and the small ones have a 44px touch target.

Two things are the host page's job, because a component cannot do them:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

- Without that tag a phone renders the page at about 980px and scales it down,
  so none of the above applies.
- Do not add `user-scalable=no` or `maximum-scale=1`. That blocks pinch zoom,
  which fails WCAG 1.4.4, and the editor does not need it.

Each sheet has a help button (ⓘ) that reveals its text, and validation messages
appear in the cell they belong to, so both work without a mouse hover.

## Formulas

A formula is Excel-style text. The editor shows it with a leading `=`. In the
XML, `<var formula="…">` and `<cond expr="…">` hold the formula without the `=`.
A Then attribute (`topic`, `payload`, `source`, `summary`, `first_step`, `cause`)
is plain text unless it starts with `=`; then it is a formula.

| Element | Example |
|---------|---------|
| Number, string, boolean | `50`, `3.6`, `"open"`, `true` |
| Duration | `30s`, `30min`, `2h`, `500ms` |
| Variable | `temp` (defined in the same rule) |
| Field | `TAG("tag")` or `TAG("device", "tag")` |
| Comparison | `=` `!=` `<` `<=` `>` `>=` (`<>` and `==` are accepted) |
| Arithmetic | `+` `-` `*` `/`, and unary `-` |
| Text | `&` joins strings; `""` inside a string is one quote |
| Context | `condition.description`, the description of the condition that fired. Then fields only. |

Functions, with the number of arguments:

| Function | Result |
|----------|--------|
| `TAG(tag)`, `TAG(device, tag)` | the current value of a decoded field |
| `AND(a, b, …)`, `OR(a, b, …)`, `NOT(a)` | boolean logic, 2 to 16 arguments for AND and OR |
| `CHANGED(x)` | true in the cycle where `x` changed |
| `STALE(x, 4h)` | true when `x` did not update within the duration |
| `RATE(x, 30min)` | change of `x` per hour over the window |
| `AVG(x, 10min)` | mean of `x` over the window |
| `BITAND(x, mask)`, `BITOR(x, mask)`, `BITXOR(x, mask)` | bitwise operations on integers |
| `HEX2DEC("FF")` | the integer value of a hex string |

Precedence, lowest first: `&`, comparisons, `+ -`, `* /`, unary `-`. Function
names are case-insensitive and print upper-case.

`validate()` checks that every formula parses, that every function exists with
the right number of arguments, that every name resolves to a variable of the
same rule, that variables do not refer to each other in a cycle, and that a
condition is a boolean (a comparison, a logic function, or a field of unknown
type), not a number or a string.

The editor does not evaluate formulas. The gateway does. `FUNCTIONS` in
`formula.ts` is the registry the gateway must implement.

## Use the core without the UI

The same entry exports the pure functions:

```ts
import { parse, serialize, validate, RulesParseError } from '@octanis/rules-editor';
import type { RulesModel } from '@octanis/rules-editor';

const model: RulesModel = parse(xml);   // throws RulesParseError on malformed input
const errors = validate(model);         // string[]; [] means valid
const xml = serialize(model);           // back to rules.xml
```

The model of one rule:

```ts
interface Rule {
  name: string;
  cooldown?: string;              // Go duration, e.g. '30s'
  edge?: 'rising' | 'none';       // default 'none'
  variables: { name: string; formula: string; description?: string }[];
  match: 'any' | 'all';           // any → <or>, all → <and>
  conditions: { expr: string; description?: string }[];
  actions: { topic: string; payload?: string }[];
  incident: { source: string; severity: Severity; summary: string; firstStep?: string; cause?: string } | null;
}
```

`validateIssues(model)` runs the same checks and returns the same messages, each
with the place it belongs to: the rule index, the field, and the index of the
variable, condition, or action. The editor uses it to mark the cell at fault; a
host can use it for the same purpose.

```ts
import { validateIssues } from '@octanis/rules-editor';

validateIssues(model);
// [{ message: 'Rule "r": condition 2: "temp" is not a variable of this rule.',
//    rule: 0, field: 'expr', condition: 1 }]
```

The formula functions are exported too: `parseFormula`, `printFormula`,
`formulaTokens`, `formulaRefs`, `inferType`, `checkFunctions`, `FUNCTIONS`.

> `parse()` uses the browser `DOMParser` global, so it runs in a browser (or a
> jsdom test environment), not bare Node. `serialize` / `validate` / the formula
> functions / the model types have no such requirement.

### Breaking changes in 0.3

- The model is flat. `Rule.condition` (a tree of `Cond` and `Group`) became
  `Rule.match` plus `Rule.conditions`, a list of formula rows. `Group`,
  `Condition`, `isGroup`, and `ValidationIssue.path` are gone.
- `Rule.variables` is required (an empty array is fine).
- `serialize()` writes `<cond expr="…"/>`. It never writes `tag`/`op`/`value`.
  A v0.2 file opens fine and is saved in the v0.3 form.
- Today's gateways do not evaluate `expr`. A v0.3 file with formula rows fails
  to load on them with `<cond> missing tag attribute`. The gateway update is a
  separate release.

## Schema

The file `schema/rules.xsd` is the XML Schema for `rules.xml`. It is the single
source of truth for the format. This editor and edge-hub share it: edge-hub
validates every uploaded `rules.xml` against it on the server, and the tests in
`src/xsd.test.ts` keep it in sync with `parse()` and `validate()`.

The XSD is XSD 1.0 and uses no namespace, so a plain `<rules>` file validates
as is. Its `version` attribute equals the package version.

Read it from `node_modules` through the exported path:

```ts
import { readFileSync } from 'node:fs';
import { RULES_XSD_PATH } from '@octanis/rules-editor';

const xsd = readFileSync(new URL(RULES_XSD_PATH), 'utf8'); // file: URL in Node
```

### What is new in 0.3

```xml
<rule name="alarm-camera" cooldown="45s" edge="rising">
  <variables>
    <var name="temp" formula='TAG("vibration1", "temperature")' description="Press motor housing temperature"/>
    <var name="temp_rate" formula="RATE(temp, 30min)"/>
  </variables>
  <or>
    <cond expr="temp &gt; 50" description="Housing above 50 °C"/>
    <cond expr="temp_rate &gt; 4" description="Housing heating faster than 4 °C/h"/>
  </or>
  <actions>
    <publish topic="camera/record" payload='{"duration":40}'/>
  </actions>
  <incident source="Cell 3 press" severity="critical"
            summary="Press guard alarm on cell 3"
            first_step="Watch the 40 s camera clip before you open the cell."
            cause='=condition.description &amp; ". The press PLC set its own alarm bit."'/>
</rule>
```

- `<variables>` with up to 64 `<var name formula description/>`. Names are
  `[A-Za-z_][A-Za-z0-9_]*` and unique within the rule.
- `<cond expr="…" description="…"/>`. The 0.2 attributes `tag`, `op`, `value`,
  `device` are still accepted as input. `description` is also allowed on
  `<and>` and `<or>`.
- `<incident first_step="…" cause="…"/>`. `summary` is the alarm title and keeps
  its 120-character cap. `first_step`, `cause`, and every `description` hold at
  most 240 characters.
- A Then attribute that starts with `=` is a formula.

### Application-level checks

XSD 1.0 cannot express these rules. `validate()` and `parse()` check them, and
edge-hub must check them too:

- A `<cond>` carries either `expr`, or `tag` and `op`, never both and never
  neither. An attribute cannot depend on another attribute in XSD.
- `<cond value="…">` is required, and must not be empty, for every 0.2
  operator except `changed`.
- A formula parses, its functions exist with the right argument count, its
  names resolve to variables of the same rule, no variable cycle exists, a
  condition is a boolean, and `condition.description` appears only in Then
  fields. The schema cannot parse a formula.

### What the Go validator must support

The schema uses two features that lightweight validators sometimes leave out.
Check them before choosing a library on the hub side:

- `xs:unique`, which enforces unique rule names and unique variable names per
  rule. Without it, both must stay application-level checks.
- `maxOccurs="1000"` on `<rule>` and `maxOccurs="64"` on `<var>`, which enforce
  the limits.

A libxml2-backed validator supports both.

### Where the XSD is stricter than the editor

The XSD rejects these, but `parse()` and `validate()` accept them. The
serializer never produces them.

- `<actions>` needs at least one `<publish>`. The parser maps an empty
  `<actions/>` to no actions.
- The children of `<rule>` come in the documented order: `<variables>`, the
  condition, then `<actions>`, then `<incident>`. The parser accepts any order.
- Only the documented attributes are allowed. The parser ignores attributes it
  does not know.
- `edge`, `cooldown`, and `device` must not be empty strings. The parser treats
  an empty attribute as absent.
- No text inside `<rules>`, `<rule>`, `<and>`, `<or>`, or `<actions>`, and no
  child elements inside `<cond>`. The parser skips text and never looks inside
  `<cond>`.
- `op` must match exactly. The parser trims surrounding whitespace.

### Nesting depth

The editor writes at most one level: a bare `<cond>`, or one `<and>`/`<or>`
with `<cond>` rows. Files from 0.2 can nest groups up to four levels deep.
`parse()` folds a nested group into one row whose formula is `AND(…)` or
`OR(…)`. The XSD unrolls the content model into four named levels to enforce
that depth; a fifth level has no matching type. A description on a leaf inside
a folded group is dropped.

## Develop

```bash
npm install
npm run build      # -> dist/*.js + *.d.ts (commit the result)
npm test           # vitest (jsdom)
npm run typecheck
```

See the schema reference at [octaview.ai/en/docs/edge-hub/rules](https://octaview.ai/en/docs/edge-hub/rules/).
