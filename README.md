# @octanis/rules-editor

A framework-free editor for the octaview Edge Hub **`rules.xml`** format, plus the
underlying parse / serialize / validate core. Vanilla TypeScript, **zero runtime
dependencies**, self-injecting scoped styles.

## Install

```bash
# HTTPS release tarball — works everywhere, including CI (no SSH key required)
npm install "https://github.com/o16s/rules-editor/archive/refs/tags/v0.2.0.tar.gz"
```

Prefer the tarball: prebuilt `dist/` is committed, so there's **no build step on
install** and **zero runtime dependencies** are pulled in.

<details>
<summary>git shorthand (needs SSH configured)</summary>

```bash
npm install github:o16s/rules-editor#v0.2.0
```

Convenient for local dev, but npm resolves `github:` to a `git+ssh://` URL, so it
requires an SSH key — it **fails in CI** (e.g. Cloudflare Pages) where none is
configured. Use the tarball URL there.
</details>

The package ships built ESM (`dist/*.js`) + type declarations (`dist/*.d.ts`).

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
| `initialXml` | `string` | Parsed internally. A **malformed** file does not throw — the editor opens empty and the parse error is surfaced through `onChange`'s `errors` (and the status line). Takes precedence over `initialModel`. |
| `initialModel` | `RulesModel` | Start from a model instead of XML. Cloned; your object is not mutated. |
| `onChange` | `(s: { model, xml, errors }) => void` | Fires on mount and after every edit. |

### Handle (`RulesEditorHandle`)

`getModel()` · `getXml()` · `getErrors()` · `setModel(model)` · `destroy()`

## Use the core without the UI

The same entry exports the pure functions:

```ts
import { parse, serialize, validate, RulesParseError } from '@octanis/rules-editor';
import type { RulesModel } from '@octanis/rules-editor';

const model: RulesModel = parse(xml);   // throws RulesParseError on malformed input
const errors = validate(model);         // string[]; [] means valid
const xml = serialize(model);           // back to rules.xml
```

> `parse()` uses the browser `DOMParser` global, so it runs in a browser (or a
> jsdom test environment), not bare Node. `serialize` / `validate` / the model
> types have no such requirement.

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

### Application-level checks

XSD 1.0 cannot express these rules. `validate()` checks them, and edge-hub
must check them too:

- `<cond value="…">` is required, and must not be empty, for every operator
  except `changed`. An attribute cannot depend on another attribute in XSD.
- The 120-character limit on `summary` is counted differently. The XSD counts
  Unicode code points. `validate()` counts UTF-16 code units, so a summary of
  120 emoji passes the XSD and fails the editor. Plain text is not affected.

### Where the XSD is stricter than the editor

The XSD rejects these, but `parse()` and `validate()` accept them. The
serializer never produces them.

- `cooldown` must match the Go duration pattern (for example `30s`, `1m30s`,
  `500ms`). The editor does not inspect the value.
- `<actions>` needs at least one `<publish>`. The parser maps an empty
  `<actions/>` to no actions.
- The children of `<rule>` come in the documented order: the condition, then
  `<actions>`, then `<incident>`. The parser accepts any order.
- Only the documented attributes are allowed. The parser ignores attributes it
  does not know.
- `edge`, `cooldown`, and `device` must not be empty strings. The parser treats
  an empty attribute as absent.
- No text inside `<rules>`, `<rule>`, `<and>`, `<or>`, or `<actions>`, and no
  child elements inside `<cond>`. The parser skips text and never looks inside
  `<cond>`.
- `op` must match exactly. The parser trims surrounding whitespace.

### Nesting depth

XSD cannot count depth. The schema unrolls the condition content model into
four named levels. Level 1 is the condition directly under `<rule>`. A group at
level N holds children of level N+1. Level 4 allows only `<cond>`, so a fifth
level has no matching type. This matches `validate()`, which counts the leaf as
a level: at most three nested `<and>`/`<or>` groups fit above a `<cond>`.

## Develop

```bash
npm install
npm run build      # -> dist/*.js + *.d.ts (commit the result)
npm test           # vitest (jsdom)
npm run typecheck
```

See the schema reference at [octaview.ai/en/docs/edge-hub/rules](https://octaview.ai/en/docs/edge-hub/rules/).
