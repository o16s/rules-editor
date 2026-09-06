# rules-editor — UI specification

A description of what this component edits, what it does today, and what any
change must keep true. Written for a designer or developer who works without
the codebase open.

**Package:** `@octanis/rules-editor` · **Entry:** `initRulesEditor(root, options)`
· **Source of truth for the format:** `schema/rules.xsd` and
[octaview.ai/en/docs/edge-hub/rules](https://octaview.ai/en/docs/edge-hub/rules/)
· **Design origin:** the Claude Design handoff "Rules editor UI redesign",
turn 13a (the editor) and turn 14a (the simulator, not built yet).

---

## 1. What this is

A drop-in editor for **`rules.xml`**, the automation rule file for the octaview
**Edge Hub**, a gateway that sits on a factory network, polls a PLC or IO-Link
devices, and reacts to what it reads.

One rule says: define some **variables** from the machine's data, and **when**
any or all of a set of **conditions** on them is true, **then** publish MQTT
messages and/or raise an alarm that pages a person.

The editor is embedded in two places:

- the **octaview website**, as part of a device configuration page;
- **edge-hub** itself, served from the gateway on the local network.

It has no backend. It parses XML in, edits a model, serializes XML out, and
hands the result to whatever host embedded it. The host decides what to do with
the XML (save, upload, download). The host can also feed **live values** into
the editor, so the operator sees what each formula evaluates to right now.

### Who uses it, and where

- Integrators during commissioning, and maintenance engineers afterwards. They
  know their PLC tag names and MQTT topics. They know Excel. They do not need
  to read XML.
- At a laptop for the bulk of the work. On a phone or tablet next to the
  machine for a quick check or a threshold change.

### The metaphor

The editor is a **spreadsheet**. Every rule is three small sheets. A cell holds
either a formula (input) or a live result (output). Excel is the reference for
every interaction question: how a formula reads, how a cell is selected, how a
sheet behaves on a phone (Google Sheets, in that case).

---

## 2. The data model

```
RulesModel
└── rules: Rule[]                       0..1000
     ├── name: string                   REQUIRED, unique across the file
     ├── cooldown?: string              Go duration, e.g. 45s
     ├── edge?: 'none' | 'rising'       default 'none'
     ├── variables: Variable[]          0..64
     │    ├── name: string              REQUIRED, [A-Za-z_][A-Za-z0-9_]*, unique in the rule
     │    ├── formula: string           REQUIRED, a formula
     │    └── description?: string      max 240 characters
     ├── match: 'any' | 'all'           any → <or>, all → <and>
     ├── conditions: Cond[]             1..16
     │    ├── expr: string              REQUIRED, a formula that is true or false
     │    └── description?: string      max 240 characters; quoted as condition.description
     ├── actions: Publish[]             0..N
     │    ├── topic: string             REQUIRED
     │    └── payload?: string          '{}' at runtime when blank
     └── incident: Incident | null      0..1
          ├── source: string            REQUIRED
          ├── severity                  'critical' | 'error' | 'warning' | 'info'
          ├── summary: string           REQUIRED, max 120 characters (the alarm title)
          ├── firstStep?: string        max 240 characters
          └── cause?: string            max 240 characters
```

### 2.1 Field reference

| Field | Where | Required | Allowed values | Notes for the UI |
|---|---|---|---|---|
| **name** | rule | yes | any non-empty string | Unique per file. Identifier-like: no autocapitalise, no autocorrect. |
| **cooldown** | rule | no | Go duration: `0`, or number+unit pairs with units `ns us µs ms s m h` | Shown as "Actions are fired at most once every `45s`". Blank means no cooldown. |
| **edge** | rule | no | `none` (default), `rising` | Shown as the trigger words in the When heading: `becomes true` (rising) or `is true` (none). |
| **variables[].name** | Variables sheet | yes | letters, digits, underscores; not a function name, `true`, `false`, or `condition` | Case-sensitive. |
| **variables[].formula** | Variables sheet | yes | a formula (section 2.3) | Shown with a leading `=`. Stored without it. |
| **match** | When heading | yes | `any`, `all` | `any` fires when one row is true, `all` when every row is true. |
| **conditions[].expr** | When sheet | yes | a formula whose type is boolean or unknown | A number or a string is rejected with a hint. |
| **description** | Variables and When sheets | no | text, max 240 characters | Prose: keep autocapitalise and spellcheck. |
| **topic** | Then sheet, row `topic` | yes | text, or a formula when it starts with `=` | Identifier-like. |
| **payload** | Then sheet, row `payload` | no | text, or a formula when it starts with `=` | Usually JSON. |
| **source** | Then sheet, row `source` | yes | text, or a formula | The device the alarm is attributed to. |
| **summary** | Then sheet, row `title` | yes | text, or a formula; max 120 characters | The 8-word alarm title. Labelled "title" in the UI. Prose. |
| **firstStep** | Then sheet, row `first step` | no | text, or a formula; max 240 characters | What the operator does first. Prose. |
| **cause** | Then sheet, row `cause` | no | text, or a formula; max 240 characters | Why it fired and where the boundary of what we read sits. Prose. |

### 2.2 Hard limits

| Limit | Value | Enforced how |
|---|---|---|
| Rules per file | **1000** | validation message on the status line |
| Variables per rule | **64** | validation message, and the Add row is disabled with a reason |
| Conditions per rule | **16** | validation message, and the Add row is disabled with a reason |
| Description, first step, cause | **240 characters** | validation message |
| Title (`summary`) | **120 characters** | validation message |

### 2.3 The formula language

Excel-style text. The editor displays every formula with a leading `=`.

| Element | Example |
|---|---|
| Number, string, boolean | `50`, `3.6`, `"open"`, `true` |
| Duration | `30s`, `30min`, `2h`, `500ms` |
| Variable | `temp` (defined in the same rule) |
| Field | `TAG("tag")` or `TAG("device", "tag")` |
| Comparison | `=` `!=` `<` `<=` `>` `>=` (`<>` and `==` accepted) |
| Arithmetic | `+` `-` `*` `/`, unary `-` |
| Text | `&` joins strings; `""` inside a string is one quote |
| Context | `condition.description`, Then fields only |
| Functions | `TAG`, `AND`, `OR`, `NOT`, `CHANGED`, `STALE`, `RATE`, `AVG`, `BITAND`, `BITOR`, `BITXOR`, `HEX2DEC` |

The editor parses and checks formulas. It does not evaluate them. The gateway
evaluates them, and the function list is the contract the gateway implements.

---

## 3. Structural rules — what the format allows and forbids

### Allowed

- 0 to 1000 rules, in document order.
- Per rule: 0 to 64 variables, 1 to 16 condition rows combined by `any` or
  `all`, 0..N publish actions, 0 or 1 alarm. A rule with actions only, an
  alarm only, or both.
- A formula can nest logic to any depth (`AND(a, OR(b, c))`), so the old
  condition tree is not needed. A v0.2 file with nested groups opens as one row
  whose formula holds the nesting.
- A Then field is text, or a formula when it starts with `=`.

### Not allowed — do not design for these

| Not possible | Consequence for the UI |
|---|---|
| **Cross-rule references** | A variable belongs to one rule. Do not offer "use variable from rule X". |
| **Enable / disable a rule** | No such attribute. Do not design a toggle. |
| **Priority or ordering semantics** | Rules keep document order. No priority column. |
| **A note or comment on a rule** | Only variables and conditions carry a description. XML comments are not preserved. |
| **Anything but `<publish>` inside actions** | No HTTP calls, no writes back to the PLC. |
| **More than one alarm per rule** | The Then sheet holds one alarm; a second "Raise alarm" row changes the severity of the same alarm. |
| **Custom severities or edge modes** | Exactly the four severities; exactly `becomes true` and `is true`. |
| **Schedules or calendar conditions** | Not in the schema. |
| **Live values from the editor itself** | Result cells show what the host passes in through `monitor`, or a dash. The editor has no data source and no evaluator. |

---

## 4. What the editor does today

### 4.1 The frame

Top bar: the title **Rules**, an **XML** button, and **Add rule** (the only
primary button). Below it a status line that appears only for whole-file
problems (a parse error, too many rules).

**XML** opens a panel with the current file in a textarea, an **Import**
button, a file picker, **Copy XML**, and **Download rules.xml**. Copy and
Download are disabled while any validation issue exists, with the reason on
hover. A failed import shows the parse error and keeps the previous content.

### 4.2 The rail

A 286px column on the left. A **Filter** input, then one row per rule:

- an 8px square: filled in the severity colour when the rule raises an alarm,
  hollow when it only publishes;
- the rule name, with an amber issue count beside it when the rule is invalid;
- a meta line: `rising edge` or `every cycle`;
- **Duplicate** and **Delete** icons, shown on hover and on the selected row.

The selected row sits on the warm ground `#efece5`. Below 900px the rail
becomes a select above the sheets.

### 4.3 The pane

The rule name as an editable 18px title, **Delete** on the right, then three
sheets. Each sheet has a title line with a help button (ⓘ) that reveals one
paragraph of help on tap.

| Sheet | Columns | A row is |
|---|---|---|
| **Variables** | Name · Formula · Formula result · Description | one named formula |
| **When** `any ▾` of these `becomes true ▾` | Condition · Condition result · Description | one formula that must be true |
| **Then** | Action · Field · Formula · Formula result | one field of an action |

Sheet anatomy, from the design: a row-number gutter on `#f2efe9`, a header row
in the same grey, hairline grid lines `#efece7`, 13px cells, 12px headers.
Formula cells colour their tokens: function names grey, strings and the
`condition.description` context in the reading blue `#3b5570`. Result cells sit
on `#f7f6f2` in the reading blue and are read-only. The last row of every sheet
is **Add**. Each row has a trash icon at the far right.

The Then sheet derives its rows from the model: per publish, `topic` and
`payload`; when an alarm exists, `source`, `title`, `first step`, `cause`. The
**Action** cell is a select: `Publish MQTT message`, `Raise critical alarm`,
`Raise error alarm`, `Raise warning alarm`, `Raise info alarm`. Choosing an
alarm on a publish row converts it; choosing it on an alarm row changes the
severity. A Then result cell shows the literal text, or a preview of a formula
with constants folded and `condition.description` read from the first row.

The Then sheet ends with the cooldown footer: "Actions are fired at most once
every `45s`".

### 4.4 Editing

Every cell is an input. Enter commits (blurs). Every keystroke updates the
model, re-validates, and fires `onChange` with the XML. There is no save button
and no dirty state.

Limits are enforced by disabling the **Add** row with the reason as its tooltip,
not by an error after the fact.

---

## 5. Validation and error presentation

### 5.1 Where an error appears

| Kind | Where |
|---|---|
| A cell's own problem (bad formula, unknown name, reserved name, over-long text, bad cooldown) | the cell takes the amber wash `#fbf3e0`, and the message appears as text under its row |
| A whole-sheet problem (no condition rows, too many rows or variables) | the sheet border turns red and the message sits under the sheet |
| A whole-rule problem (no action and no alarm) | under the pane body |
| A whole-file problem (parse error, too many rules) | the status line under the top bar |
| Every rule's count | the rail, beside the name |
| On a phone | the selected cell's message also shows in the formula bar, where the keyboard cannot hide it |

Marks clear as soon as the cell is fixed, without a re-render.

### 5.2 Messages

Every message starts with `Rule "name":` and names the row (`condition 2`,
`variable "temp"`). A formula error carries the column: `The formula is
incomplete. (column 7)`. A non-boolean condition gets a hint: `must be true or
false, but is a number. Compare it, for example "temp + 1 > 0"`. A cycle names
its path: `refers to itself through a → b → c → a`.

### 5.3 Parse errors are different

A file that does not parse never opens. The editor stays empty (or keeps its
previous content on Import) and the parse error goes on the status line.

---

## 6. The phone model (560px and below)

The model is Google Sheets on a phone. The sheet stays a sheet.

- Columns keep their widths. The sheet scrolls sideways inside its own frame.
  The page never scrolls sideways. Row numbers stay frozen on the left.
- Rows keep one height; long text is clipped, not wrapped.
- **Tabs** (`Variables 10 · When 5 · Then 6`) show one sheet at a time.
- Nobody types inside a cell. A **tap selects** a cell (2px reading-blue
  outline). A **formula bar** anchored at the bottom of the editor shows the
  cell's address (`temp_rate · Formula`) and its content. Typing in the bar
  edits the cell live. **✓** keeps, **✕** restores what the cell had when it was
  tapped, **Delete row** removes the row. A result cell opens the bar read-only.
- Choice cells (Action, `any`, `becomes true`) keep their native picker and do
  not open the bar.
- Every control a finger can focus is 16px or larger (below that iOS zooms the
  page). Small controls have 44px targets.

Between 560px and 900px the sheets keep the desktop cells and scroll sideways
when the pane is narrower than a sheet's minimum width.

---

## 7. States the design must cover

1. **Empty**: no rules, "No rules yet. Add one, or Load example."
2. **Valid**: rules, no issues, Download and Copy enabled.
3. **Invalid**: washes, messages, rail counts, Download and Copy disabled.
4. **Failed import**: parse error in the XML panel, previous content untouched.
5. **Opened with a broken file**: empty editor, parse error on the status line.
6. **No live values**: dashes in every result cell.
7. **Large file**: 50 or more rules in the rail; the filter is the way to find one.
8. **Maxed-out sheet**: 64 variables or 16 conditions, Add disabled with a reason.
9. **A v0.2 file**: leaf conditions and nested groups open as formula rows.
10. **Phone**: tabs, sideways scroll, the bar.
11. **Themed host**: the tokens in section 8.3 swapped, including a dark set.

---

## 8. Non-negotiable technical constraints

### 8.1 Zero runtime dependencies, framework-free

Vanilla TypeScript that builds a DOM tree by hand. No React, no Vue, no CSS
framework, no icon package, no font download. It must stay droppable into a
page served from the gateway with no network access.

- Icons are inline SVG paths or text (`ⓘ`, `✓`, `✕`).
- Fonts are the host's or the system's. The fallback stack is Helvetica Neue,
  Helvetica, Arial.

### 8.2 Self-injecting scoped styles

All CSS lives in one `<style id="octaview-rules-editor-styles">` injected once.
Every selector is scoped under `.re-root`, every class is prefixed `re-`.

### 8.3 Theming is via host CSS custom properties

The host sets these on any ancestor. The editor reads them with fallbacks and
must keep working when none are set.

| Token | Fallback | Used for |
|---|---|---|
| `--accent` | `#b8460f` | Add rule, links |
| `--accent-hover` | `#a03d0c` | Add rule hover, Add rule border |
| `--ink` | `#1b1a17` | text, formula text |
| `--gray-700` | `#3b3934` | descriptions, secondary text |
| `--gray-500` | `#6a6660` | headers, muted text, function names |
| `--gray-200` | `#ddd9d2` | frame borders |
| `--grid` | `#efece7` | hairline grid lines |
| `--sheet-head` | `#f2efe9` | header row, row-number gutter |
| `--sheet-result` | `#f7f6f2` | read-only result cells |
| `--selected` | `#efece5` | the selected rail row |
| `--reading` | `#3b5570` | live results, string literals, the selected cell outline |
| `--bg` | `#faf9f6` | top bar, rail, footers, the formula bar |
| `--surface` | `#ffffff` | the pane, inputs |
| `--warning` | `#8a5a00` | issue counts and messages |
| `--incident` | `#a32c1e` | critical severity, Delete, invalid borders |
| `--font-body` | Helvetica Neue stack | everything |

A change may add tokens but must not require them: the unstyled default must
look finished.

### 8.4 Responsive to its container, not the viewport

The editor declares `container-type: inline-size` and ships every responsive
rule twice, as `@media` and as `@container`. Any new breakpoint must be emitted
both ways. Behaviour that CSS cannot express (tabs, the bar) keys off an
`is-narrow` class set from the container width by a `ResizeObserver`.

| Width | Behaviour |
|---|---|
| ≤ 900px | the rail folds into a select |
| ≤ 560px | the phone model of section 6 |
| ≤ 430px | pane padding tightens, the When heading and the footer wrap |

Minimum supported width is **320px**. The page must not scroll sideways there.

### 8.5 Accessibility floor

- 16px on every control a finger can focus below 560px.
- Touch targets of at least 44px at narrow widths.
- Help and error text are on the page, never hover-only.
- The ⓘ buttons carry `aria-expanded` and an `aria-label`. Every input has an
  `aria-label` that names its row (`Formula of variable 3`, `Condition 2`).
- Pinch zoom stays available; hosts must not set `user-scalable=no`.
- Identifier inputs (name, variable names, formulas, topic, cooldown, filter)
  set `autocapitalize=off`, `autocorrect=off`, `spellcheck=false`. Prose
  inputs (descriptions, title, first step, cause) keep the defaults.
- State is never conveyed by colour alone: an invalid cell also carries text,
  a selected rail row also carries weight.

---

## 9. Behaviours to know about

- **Every edit is immediate.** No save, no dirty state, no undo, no confirm on
  Delete.
- **The host owns persistence.** `onChange` fires on mount and after every
  edit, and carries the XML even while invalid, so a host can autosave a draft.
- **The editor mutates nothing it is given.** Models passed in are cloned.
- **A v0.2 file re-saves as v0.3.** `tag`/`op`/`value` become `expr`, nested
  groups fold into one row. XML comments, attribute order, and unknown
  attributes are dropped.
- **Today's gateways do not evaluate `expr`.** A v0.3 file fails to load on
  them with `<cond> missing tag attribute`. The gateway update is a separate
  release.

---

## 10. Open weaknesses

1. No undo, and no confirmation on Delete rule, Delete row, or Import.
2. No tag catalogue: a misspelled tag inside `TAG(...)` is not caught until the
   gateway loads the file.
3. No simulator. Slide 14a of the handoff describes one: a signal generator per
   tag, a timeline tree of condition › variable › tag, and a log. It needs an
   evaluator for the formula language.
4. On a scrolled phone sheet the **Add** row is not frozen, so it can sit off to
   the left.
5. The Then sheet repeats the Action select on every row of the same action.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Edge Hub** | The octaview gateway that runs these rules on the factory network. |
| **rules.xml** | The file this editor edits. Validated against `schema/rules.xsd` server-side. |
| **PLC** | Programmable Logic Controller, the machine controller. Its data arrives via `tsend2mqtt` with a single implicit source, so `TAG("tag")` has one argument. |
| **IO-Link** | A sensor bus. Data arrives via `iolinkmaster2mqtt`, one named device per port, so `TAG("device", "tag")` names both. |
| **tag** | One named field in the incoming data. |
| **variable** | A named formula of one rule, defined in the Variables sheet. |
| **condition** | A formula in the When sheet that must be true. |
| **condition.description** | The description of the condition that fired, available in Then fields. |
| **alarm** | An incident raised to PagerDuty, deduplicated by `{prefix}/{source}-{rule}`. |
| **cooldown** | Minimum wall-clock time between two firings of the same rule. |
| **becomes true** | Rising edge: fire once on the false-to-true change. |
| **is true** | Every cycle: fire on each evaluation pass while true. |
| **cycle** | One evaluation pass by the hub as it polls the source. |
| **result cell** | A read-only cell that shows the live value the host supplies. |
