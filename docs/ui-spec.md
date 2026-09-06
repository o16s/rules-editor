# rules-editor — UI specification

A complete description of what this component edits, what it can do today, and
what any redesign must keep true. Written to be handed to a designer working
independently of the codebase.

**Package:** `@octanis/rules-editor` · **Entry:** `initRulesEditor(root, options)`
· **Source of truth for the format:** `schema/rules.xsd` and
[octaview.ai/en/docs/edge-hub/rules](https://octaview.ai/en/docs/edge-hub/rules/)

---

## 1. What this is

A drop-in editor for **`rules.xml`**, the automation rule file for the octaview
**Edge Hub** — a gateway that sits on a factory network, polls a PLC or IO-Link
devices, and reacts to what it reads.

One rule says: **when** some condition on the machine's data is true, **then**
publish one or more MQTT messages and/or raise an incident (which pages someone
via PagerDuty).

The editor is embedded in two places:

- the **octaview website**, as part of a device configuration page;
- **edge-hub** itself, served from the gateway on the local network.

It has no backend. It parses XML in, edits a model, serializes XML out, and
hands the result to whatever host embedded it. The host decides what to do with
the XML (save, upload, download).

### Who uses it, and where

Inferred from the domain and from the mobile work already done — treat as
context, not verified research:

- Automation / maintenance engineers configuring a machine's alarm behaviour.
- Often **on the shop floor, next to the machine**, on a phone or tablet,
  possibly with gloves on — hence the existing 44 px touch targets and the
  320 px support.
- Also at a desk, reviewing or bulk-editing a file with dozens of rules.

They know their PLC tag names and their MQTT topics. They do **not** necessarily
know XML, and should never have to read it.

---

## 2. The data model

This is the complete shape of what is being edited. Nothing else exists.

```
RulesModel
└── rules: Rule[]                       0..1000
     ├── name: string                   REQUIRED, unique across the file
     ├── cooldown?: string              Go duration
     ├── edge?: 'none' | 'rising'       default 'none'
     ├── condition: Condition | null    REQUIRED (exactly one, may be a tree)
     ├── actions: Publish[]             0..N
     │    ├── topic: string             REQUIRED
     │    └── payload?: string
     └── incident: Incident | null      0..1
          ├── source: string            REQUIRED
          ├── severity: 'critical' | 'error' | 'warning' | 'info'
          └── summary: string           REQUIRED, max 120 characters

Condition = Cond | Group
Cond   { device?: string, tag: string, op: Op, value?: string }
Group  { kind: 'and' | 'or', children: Condition[] }   1..16 children
Op     = eq | neq | lt | leq | gt | geq | changed
```

### 2.1 Field reference

| Field | Where | Required | Type / allowed values | Notes for the UI |
|---|---|---|---|---|
| **name** | rule | yes | any non-empty string | Unique per file. Used as the rule id in logs and in the incident dedup key. Identifier-like — must not be autocapitalised or autocorrected. |
| **cooldown** | rule | no | Go duration: `0`, or number+unit pairs. Units `ns us µs ms s m h`. e.g. `30s`, `1m30s`, `500ms` | Minimum time between firings. Blank = no cooldown. Negative values are rejected by the pattern. |
| **edge** | rule | no | `none` (default) \| `rising` | **Labelled "trigger" in the UI.** `rising` = fire once on the false→true transition. `none` = fire on every evaluation cycle while true. Serialized only when `rising`. |
| **device** | condition leaf | no | any non-empty string | IO-Link device name from the hub's `config.yaml` ports. Left blank for a PLC (tsend2mqtt) source. Identifier-like. |
| **tag** | condition leaf | yes | any non-empty string | The field to test — a PLC `.udt` tag or a decoded IO-Link field. **Exact match, and unrestricted: may contain dots, spaces, any character.** Identifier-like. |
| **op** | condition leaf | yes | `eq neq lt leq gt geq changed` | `= ≠` work on any type; `< ≤ > ≥` on numbers only; `changed` means "value differs from last cycle". |
| **value** | condition leaf | conditional | any string, **including empty-looking ones** | Required for every operator **except `changed`**, where it must be absent. Untyped — `50`, `true`, `running` are all just strings; the hub interprets them. |
| **topic** | publish | yes | any non-empty string | Absolute MQTT topic. No prefix is added by the hub. |
| **payload** | publish | no | any string, usually JSON | Defaults to `{}` at runtime when blank. Should be shown in a monospace face. |
| **source** | incident | yes | any non-empty string | The device the incident is attributed to. Builds the dedup key `{prefix}/{source}-{rule}`. |
| **severity** | incident | yes | `critical` \| `error` \| `warning` \| `info` | Maps to PagerDuty urgency. Fixed set — not extensible. |
| **summary** | incident | yes | string, **max 120 characters** (counted as code points, not UTF-16 units) | One-line human-readable alert text. This is **prose** — it is the one field that should keep normal autocapitalise/spellcheck behaviour. |

### 2.2 Hard limits

| Limit | Value | Enforced how |
|---|---|---|
| Rules per file | **1000** | validation message |
| Condition nesting depth | **4** | validation message **and** disabled "add" buttons |
| Children per `and`/`or` group | **16** | validation message **and** disabled "add" buttons |
| Incident summary length | **120 characters** | validation message |

Depth counts the leaf as a level: a bare condition directly under a rule is
depth 1, so **at most three nested groups can sit above a condition**.

---

## 3. Structural rules — what the format allows and forbids

A designer must not invent affordances for things the file format cannot
express. This list is exhaustive.

### Allowed

- 0 to 1000 rules, in document order.
- Exactly **one** top-level condition per rule — which may be a single
  comparison, or an `and`/`or` group containing a tree.
- `and` and `or` groups nested up to depth 4, mixed freely (`and` inside `or`
  inside `and`).
- 0..N publish actions per rule.
- 0 or 1 incident per rule.
- A rule with actions only, an incident only, or both.
- A condition with no `device` (PLC source) or with one (IO-Link source).
- Empty payload (means `{}`), empty cooldown (means none).

### Not allowed — do not design for these

| Not possible | Consequence for the UI |
|---|---|
| **More than one top-level condition** per rule | The "match" control converts between a single condition and a group; it never yields two siblings at the top. |
| **NOT / negation** | There is no `not` group and no negated operator beyond `neq`. Do not offer "invert". |
| **Arithmetic, functions, or expressions** in a value | `value` is compared as-is. No `tagA > tagB`, no `avg()`, no unit conversion. |
| **Comparing two tags** | The right-hand side is always a literal. |
| **Cross-rule references** | Rules cannot depend on, chain to, or trigger each other. |
| **Enable / disable a rule** | No such attribute. "Disabling" means deleting, or the user commenting it out by hand in the XML — which this editor destroys (see §7). |
| **Priority, ordering semantics, or grouping of rules** | Rules keep document order, but the format defines no precedence attribute. Do not design a priority column. |
| **A description, comment, or note on a rule** | There is no such field. XML comments are **not preserved** (see §7). |
| **Tags/labels/categories on rules** | Not in the schema. |
| **Anything but `<publish>` inside actions** | No HTTP calls, no writes back to the PLC, no emails. |
| **More than one incident per rule** | It is a 0-or-1 toggle. |
| **Custom severities** | Exactly the four listed. |
| **Custom edge modes** | Exactly `none` and `rising`. No falling edge, no "both". |
| **Time-of-day, schedules, or calendar conditions** | Not in the schema. |
| **Typed values or units** | Everything is a string. The UI must not imply a number-only input for `value` — `= true` and `= running` are legitimate. |
| **A `changed` condition with a value** | Selecting `changed` must remove the value input entirely, not disable it. |

---

## 4. What the editor does today

### 4.1 Global toolbar

| Control | Behaviour | Notes |
|---|---|---|
| **Add rule** (primary button) | Appends a rule named `new-rule` with one empty condition, no actions, no incident | The only primary-styled control |
| **Import XML** | Opens an inline panel: a paste textarea, a file picker (`.xml`), and an Import button | On success the panel closes and a message reports the rule count. On failure it shows the parse error and stays open. |
| **Export XML** | Downloads `rules.xml` | **Disabled while any validation issue exists**, with a reason on hover |
| **Copy XML** | Copies to clipboard, label flips to "Copied" for ~1.2 s | Same disabled rule as Export. Silently does nothing where the clipboard API is unavailable. |
| **Load example** | Replaces everything with a 2-rule sample | Destructive, currently unconfirmed |
| **Clear** | Empties the file | Destructive, currently unconfirmed |

### 4.2 Status line

Directly under the toolbar, always visible:

- **Valid:** a coloured dot + `Valid · N rules`.
- **Invalid:** a dot + `N issues to resolve`, followed by a bulleted list of
  **every** message in the file.

The list is the only place whole-file issues (e.g. "Too many rules") can appear,
since they belong to no field.

### 4.3 A rule

Rules render as a vertical stack of cards. Each card has:

**Header row** — `rule name` · `cooldown` · `trigger` (select) · **Delete rule**
(pushed to the right).

**"When"** — a `match` select offering *a single condition* / *all of (AND)* /
*any of (OR)*, then the condition area:

- A **condition row**: `device` · `tag` · `operator` (select) · `value` · remove ×.
  The value input **disappears** when the operator is `changed`.
- A **group**: its own match select and remove ×, a left border marking the
  nesting, its children indented, and **Add condition** / **Add group** links.
- Changing `match` from a group back to a single condition **keeps only the
  first child** and discards the rest. This is currently silent.

**"Then publish"** — a section header with an **Add publish** link, then one row
per action: `topic` · `payload` · remove ×.

**"Raise incident"** — a section header with an **enabled** checkbox. When on,
one row: `source` · `severity` (select) · `summary`.

**Empty state:** *"No rules yet — add one, or load the example."*

### 4.4 Limits are enforced by disabling, not by erroring

Inside a group, **Add condition** and **Add group** are disabled — with the
reason as the tooltip — when the next step would break a limit:

- 16 children reached → both disabled, *"A group holds at most 16 conditions."*
- depth 4 reached → **Add condition** disabled, *"Conditions nest at most 4
  levels deep."*
- depth 3 reached → **Add group** disabled (a new group needs room for its own
  condition below it).

**This principle is worth keeping: the UI never offers a step that produces an
invalid file.**

### 4.5 Field help

Every field carries a short explanation, revealed by an **ⓘ** button next to the
label that toggles a paragraph under the control. It is a button, not a hover
tooltip, because **touch devices have no hover** — this was a deliberate fix and
must not be reverted to a title-only tooltip.

The current help strings:

| Field | Text |
|---|---|
| name | Unique rule id — used in the incident dedup_key and logs. |
| cooldown | Min time between firings — a Go duration: 30s, 1m30s, 500ms. Units ns, us, ms, s, m, h. Blank = none. |
| trigger | Rising edge fires once on false→true; every cycle fires each poll while true. |
| match | Combine conditions: a single one, all of them (AND), or any of them (OR). |
| device | IO-Link device name (config.yaml port). Leave blank for tsend2mqtt / PLC. |
| tag | Field to test: a .udt tag (PLC) or decoded device field (IO-Link). Exact match. |
| operator | = ≠ any type; < ≤ > ≥ numbers only; "changed" = value changed since last cycle. |
| value | Value to compare against; type follows the field. Not used with "changed". |
| topic | Absolute MQTT topic to publish to when the rule fires (no prefix added). |
| payload | Message body, usually JSON. Defaults to {} if left blank. |
| source | Device the incident is attributed to; builds the dedup_key {prefix}/{source}-{rule}. |
| severity | Urgency — maps to PagerDuty: critical, error, warning, info. |
| summary | One-line human-readable alert text (max 120 characters). |

### 4.6 Operator labels

The select shows the symbol and the words together; the stored value stays the
canonical token.

`=  equals` · `≠  not equal` · `<  less than` · `≤  at most` ·
`>  greater than` · `≥  at least` · `changed`

---

## 5. Validation and error presentation

Validation runs on **every keystroke**. There is no "validate" button and no
submit step.

### 5.1 Where an error appears

Each issue carries the address of the input at fault, so it is shown in **two
places at once**:

1. in the status-line list at the top, and
2. **as text directly under the field it belongs to**, with the field marked.

Errors under fields are **page text, not tooltips** — same reason as the help
buttons. Do not regress this.

An issue that belongs to no single field lands on the nearest container: a group
issue marks the group, a rule-level issue marks the whole card.

### 5.2 The complete list of validation messages

| Message | Attaches to |
|---|---|
| `Too many rules: N (max 1000).` | whole file (status line only) |
| `A rule is missing a name.` | rule name |
| `Duplicate rule name "X".` | rule name |
| `Rule "X": cooldown "Y" is not a Go duration (e.g. 30s, 1m30s, 500ms).` | cooldown |
| `Rule "X": needs exactly one condition.` | condition area |
| `Rule "X": must have <actions>, an <incident>, or both.` | the rule card |
| `Rule "X": a publish action is missing a topic.` | that action's topic |
| `Rule "X": incident is missing a source.` | incident source |
| `Rule "X": incident is missing a summary.` | incident summary |
| `Rule "X": incident summary exceeds 120 characters.` | incident summary |
| `Rule "X": condition nesting exceeds max depth of 4.` | that group |
| `Rule "X": <and> group is empty.` | that group |
| `Rule "X": <and> has N children (max 16).` | that group |
| `Rule "X": a condition is missing a tag.` | that condition's tag |
| `Rule "X": operator "gt" on tag "t" needs a value.` | that condition's value |

An unnamed rule is referred to as `Unnamed rule` in the message text.

### 5.3 Parse errors are different from validation errors

A malformed or wrong-shaped XML file produces a **parse error**, which is a
single message that stops the file being read at all. These are surfaced:

- in the import panel, if the user pasted it there (the panel stays open);
- in the status line as the first message, if it came in via `initialXml` — in
  which case **the editor opens empty**. It never throws or shows nothing.

Examples: `Malformed XML: …`, `Root element must be <rules>, got <config>`,
`<rule> is missing the required name attribute`, `Rule "r": more than one
top-level condition`, `Rule "r": unknown operator "≈"`,
`Rule "r": <actions> may only contain <publish>, got <http>`.

---

## 6. States the design must cover

1. **Empty** — no rules.
2. **Valid** — one or more rules, no issues, export enabled.
3. **Invalid** — issues in the status list, marks on fields, export/copy disabled.
4. **Failed import** — parse error shown, previous content untouched.
5. **Opened with a broken file** — empty editor + parse error in the status line.
6. **Large file** — up to 1000 rules. There is currently **no** virtualization,
   collapse, search, or pagination; 50 rules is already an uncomfortably long page.
7. **Deep condition** — a 4-level tree, where indentation must stay legible at
   320 px.
8. **Maxed-out group** — 16 children, add buttons disabled with a reason.
9. **Narrow container** — see §8.
10. **`changed` operator selected** — the value input is gone, and the row must
    not look broken.

---

## 7. Behaviours the designer should know about

These are true of the current implementation and affect what users experience.

- **Import → export is not round-trip faithful.** XML comments, attribute order,
  whitespace and unknown attributes are all **dropped**. A user who hand-edited
  their file with comments loses them silently on the next export. This is
  currently unsurfaced and is a real design problem.
- **Every edit is immediate.** There is no save, no dirty state, no undo, no
  confirmation on delete. `Clear`, `Load example`, `Delete rule`, and the
  group→single-condition collapse are all destructive and instant.
- **The host owns persistence.** `onChange` fires on mount and after every edit,
  and carries the XML **even while invalid**, so a host can autosave a draft.
  The editor itself shows no saved/unsaved indication.
- **The editor mutates nothing it is given.** Models passed in are cloned.

### Features that do not exist today

Not prohibited by the format — just not built. Fair game to design:

reorder rules · duplicate a rule · collapse/expand a rule · search or filter ·
undo/redo · tag or topic autocomplete · confirmation on destructive actions ·
a compact/table view · keyboard shortcuts · jump from a status-line message to
the field · bulk edit across rules · dark mode as a built-in (only tokens today)
· a diff or preview of the XML before export.

---

## 8. Non-negotiable technical constraints

Any redesign must hold all of these. They are architectural, not stylistic.

### 8.1 Zero runtime dependencies, framework-free

The component is vanilla TypeScript that builds a DOM tree by hand. **No React,
no Vue, no CSS framework, no icon package, no font download.** It must stay
droppable into any page, including one served from the gateway itself with no
network access.

Practical consequences for design:

- **Icons must be text, inline SVG, or CSS.** Today they are literally `×` and
  `ⓘ`.
- **Fonts must be system fonts or the host's**, never fetched.
- No component library patterns that assume a framework (portals, virtualized
  lists with framework hooks, etc.) unless they are hand-implementable.

### 8.2 Self-injecting scoped styles

All CSS lives in one `<style id="octaview-rules-editor-styles">` injected once
into `<head>`. Every selector is scoped under `.re-root` and every class is
prefixed `re-`. The editor must never leak styles into, or inherit surprises
from, the host page. No global resets beyond the scoped `box-sizing`.

### 8.3 Theming is via host CSS custom properties

The host controls the look by setting these on any ancestor. The editor reads
them with fallbacks and must keep working when none are set.

| Token | Fallback | Used for |
|---|---|---|
| `--accent` | `#FF5C00` | primary button, links, focus ring |
| `--accent-hover` | `#E65200` | primary button hover |
| `--ink` | `#0E0E16` | body text, input text |
| `--surface` | `#ffffff` | cards, inputs |
| `--bg` | `#F7F7F5` | inset areas (import textarea) |
| `--gray-700` | `#3C3C4A` | secondary text |
| `--gray-500` | `#6E6E7C` | labels, help text |
| `--gray-300` | `#B9B9C2` | placeholders, remove ×, disabled |
| `--gray-200` | `#E3E3E8` | borders, dividers |
| `--ok` | `#30A46C` | valid status |
| `--warning` | `#F5B82E` | issues-present status |
| `--incident` | `#E5484D` | field errors, destructive hover |
| `--font-body` | system stack | everything |
| `--font-mono` | system mono | payload, XML |
| `--font-heading` | `--font-body` | rule name, section labels |

**A redesign may add tokens, but must not require them** — the unstyled default
must look finished. It must also not hard-code colours that a themed host would
need to override.

### 8.4 Responsive to its **container**, not the viewport

The editor is embedded and can sit in a narrow column on a wide screen. It
declares `container-type: inline-size` and ships every responsive rule
**twice** — once as `@media`, once as `@container`. Any new breakpoint must be
emitted both ways.

Current breakpoints:

| Width | Behaviour |
|---|---|
| ≤ 560 px | All inputs go to **16 px** (below that, iOS Safari zooms the page on focus). Small controls get **44 × 44 px** targets. Condition/action/incident rows drop to 2 columns. |
| ≤ 430 px | Every field takes a **full row**; the remove button moves to its own column beside the group it removes. |

**Minimum supported width is 320 px.** The layout must not scroll horizontally
at that width.

### 8.5 Accessibility floor

- The 16 px input rule above is not cosmetic — dropping below it breaks iOS.
- Touch targets ≥ 44 px at narrow widths (WCAG 2.5.8 asks 24; 44 is the target here).
- Help and error text are **on the page**, never hover-only.
- The ⓘ buttons carry `aria-expanded` and an `aria-label`.
- Every input has a real `<label>`.
- Pinch zoom must remain available — the README explicitly forbids hosts from
  setting `user-scalable=no` or `maximum-scale=1`.
- Identifier fields (everything except `summary`) set `autocapitalize=off`,
  `autocorrect=off`, `spellcheck=false`, because a phone keyboard silently
  turning `alert_temp` into `Alert_temp` breaks the rule.
- State must never be conveyed by colour alone.

---

## 9. Allowed vs not allowed — for the redesign

### The designer MAY freely change

- All visual design: colour usage, type scale, spacing, radii, borders, shadows,
  density, iconography (within §8.1).
- Layout and information architecture of a rule: card vs table vs list vs
  master-detail vs a compact grid.
- How the condition tree is represented — indentation, connectors, chips, an
  expression field, anything, as long as the whole tree in §2 is reachable.
- Where global actions live: toolbar, header, footer, contextual, overflow menu.
- How errors are surfaced, **provided** they stay visible without hover.
- Adding any of the features listed in §7 as missing.
- Empty, loading, and success states, and copy throughout.
- Adding a compact or table view **alongside** the current form.

### The designer MUST NOT

- Introduce a UI framework, CSS framework, icon font, or web font.
- Move help or error text into hover-only tooltips.
- Break the 320 px floor, or make the layout depend on viewport width alone.
- Take inputs below 16 px at narrow widths, or touch targets below 44 px there.
- Hard-code colours or fonts that bypass the token contract in §8.3.
- Invent controls for anything in the "Not allowed" table of §3.
- Offer an action that would produce an invalid file (see §4.4) — disable it
  with a reason instead.
- Remove the ability to see and export the raw XML: some users need the file.
- Change the meaning of `edge` / "trigger", or relabel severities.
- Assume a host tag list exists. Autocomplete would require new API and a host
  that has one; design it as a progressive enhancement, not a requirement.

### Needs a decision before it can be designed

- **Tag autocomplete** — requires a new option on the public API for the host to
  supply known devices and tags. Worth proposing; not currently possible.
- **Rule enable/disable** — would require a schema change agreed with edge-hub.
- **Comment preservation** — would require parser and serializer work.
- **A formula/expression field for conditions** (e.g.
  `[vibration1] temperature > 50 AND (FanRunning = false OR CoolantFlow < 2.5)`)
  — under consideration as a much more compact alternative to the tree. Note the
  hazard: `tag` may legally contain dots and spaces, so a dotted `device.tag`
  syntax is ambiguous and a bracketed or quoted form is needed.

---

## 10. Known weaknesses — where design help is most valuable

Ranked by how much they hurt:

1. **Vertical cost per rule.** A rule with a two-condition group, one action and
   an incident is a tall card. A 50-rule file is unusable as a page — no
   overview, no way to find a rule, no way to compare two rules.
2. **No overview.** There is no way to see what a file does without scrolling
   through every field of every rule.
3. **The condition tree is heavy** for the common case, which is one comparison.
   The "match" select is shown even when there is a single condition.
4. **Destructive actions are silent and unrecoverable** — Clear, Load example,
   Delete rule, and the group collapse that drops all but the first child.
5. **Errors are shown twice** (status list and inline) with no link between
   them; on a long page the status list names a rule you cannot see.
6. **Import silently discards** comments and unknown attributes.
7. **The empty state teaches nothing** beyond "add one, or load the example".
8. **Density on desktop is identical to density on a phone** — the layout only
   ever gets *looser* as it narrows, never tighter as it widens.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Edge Hub** | The octaview gateway that runs these rules on the factory network. |
| **rules.xml** | The file this editor edits. Validated against `schema/rules.xsd` server-side. |
| **PLC** | Programmable Logic Controller — the machine controller. Its data arrives via `tsend2mqtt`, with a single implicit source, so conditions omit `device`. |
| **IO-Link** | A sensor bus. Data arrives via `iolinkmaster2mqtt`, one named device per port, so conditions carry `device`. |
| **tag** | One named field in the incoming data — a PLC `.udt` tag or a decoded IO-Link field. |
| **MQTT topic** | Where a publish action sends its message. |
| **payload** | The body of that message, usually JSON. |
| **incident** | An alert raised to PagerDuty, deduplicated by `{prefix}/{source}-{rule}`. |
| **cooldown** | Minimum wall-clock time between two firings of the same rule. |
| **rising edge** | Firing only on the false→true transition, rather than continuously while true. |
| **cycle** | One evaluation pass by the hub as it polls the source. |
