# Rules engine: one Go library for three services

This document is a plan. It records what the rule engines of tsend2mqtt,
iolinkmaster2mqtt and modbus2mqtt do today, and where they differ. It defines
what one shared library must do, and how each service adopts it. The library lives in this
repository under `rules-engine/`. It evaluates the v0.3 formula language of
the editor. No service evaluates that language today.

## 1. The decision in short

- One Go module, `github.com/o16s/rules-editor/rules-engine`, with three
  packages: `rules`, `rulesxml` and `formula`.
- The seed is the modbus2mqtt code: `internal/rules` and `internal/rulesxml`.
  It is the newest copy and the only one with structural validation.
- Two fixes exist only in tsend2mqtt and move into the seed: `Reset()` on
  reconnect, and the re-arm of `changed` with `edge="rising"`.
- `schema/rules.xsd` and its fixtures become the shared test input of the
  editor and the engine. The vendored copy in modbus2mqtt goes away.
- New code: a formula compiler and evaluator, from a Go port of
  `src/formula.ts`. The registry `FUNCTIONS` is the list of functions to
  implement.
- Each service keeps a thin adapter. The adapter builds a field catalog, fills
  a value slot array, calls `Eval`, and publishes the results.

## 2. The three engines today

### 2.1 Lineage

- tsend2mqtt `internal/rules` (2026-07-10) is the original. It received two
  fixes later: resolve on reconnect (`Reset()`, 2026-07-10) and `changed` with
  `edge="rising"` (2026-07-12, commit `3949b2f`).
- iolinkmaster2mqtt `internal/rules` (2026-07-10) is a rewrite of the original
  around a flat value array. It did not receive the fix of 2026-07-12.
- modbus2mqtt `internal/rules` (2026-08-26) is a copy of the iolinkmaster2mqtt
  package plus `Action.Rule` and `IncidentMsg.RuleName()`. Its
  `internal/rulesxml` (2026-09-03) is new. It validates the structure of the
  file and reports every problem with a path. A parity test holds it to
  `rules.xsd` v0.2.0.

Note on the bl335 repository: `modbus2mqtt/` exists only on `origin/main`. The
branch `claude/multiple-repo-access-ejg59x` was cut from an older commit and
does not contain it. This plan reads the code from `origin/main`.

### 2.2 Identical in all three

- The XML vocabulary of v0.2: `rule` with `name`, `cooldown`, `edge`. One
  top-level condition. `cond` with `tag`, `op`, `value`. Groups `and` and `or`
  to depth 4 with 16 children. `actions` with `publish`. `incident` with
  `severity` and `summary`.
- The condition tree: `LeafCond`, `AndCond`, `OrCond`, the `Op` and `ValKind`
  enumerations, short-circuit evaluation with a loop bound of 16.
- `CondFieldRefs`, an iterative walk with a stack of 64.
- `toInt64` and `toFloat64`. tsend2mqtt lacks the `int` case.
- `parseOp` (lower-cased, with aliases), `parseEdge`, `parseCooldown`.
- The engine skeleton: a `rulesByField` index, a `changedSet`, an `evalSet`,
  preallocated result slices. A rule evaluates only when one of its fields
  changed.
- The limits: 1000 rules, depth 4, 16 children.
- The Power of Ten coding rules and the test style.

The `rules` packages of iolinkmaster2mqtt and modbus2mqtt are the same file
set. modbus2mqtt adds `Action.Rule`, `IncidentMsg.RuleName()`, and one test.

### 2.3 Differences

| Concern | tsend2mqtt | iolinkmaster2mqtt | modbus2mqtt |
|---|---|---|---|
| Input to `Eval` | raw frame, `[]udt.Field`, changed indices | `[]any` slots and `now` | same as iolinkmaster2mqtt |
| Change detection | caller, `decode.ChangeDetector` | engine, `!=` on the previous slots | engine |
| Clock | `time.Now()` inside `Eval` | parameter | parameter |
| Field address in `<cond>` | `tag` only, `device` ignored | `device` and `tag`, both required | same |
| Value type source | S7 type from the `.udt` | JSON Schema type string | same |
| `changed` with `edge="rising"` | fires on every change | fires once, then never again | same |
| Resolve after a trigger that cooldown suppressed | sent, without a trigger | not sent, `incidentActive` | same |
| `<incident>` and `edge` | forces `rising`, rejects `none` | independent of `edge` | same |
| Incident output | `Incident` struct, the caller builds JSON | `IncidentMsg`, JSON-ready | same, plus `RuleName()` |
| Incident `source` | not in the XML, service identity | attribute, must name a device | same |
| `Reset()` on reconnect | yes, emits resolves | no | no |
| Values of an offline device | not applicable | kept | cleared to `nil` |
| Actions per rule | maximum 16 | unbounded | unbounded |
| Structural validation | none, first error only | none | `rulesxml`, every problem with a path |
| Summary length | no limit | bytes | bytes in `rules`, characters in `rulesxml` |
| Severity | lower-cased | exact | exact |
| `cooldown="0"` | accepted | accepted | `rulesxml` rejects |
| Eval cadence | per frame | per poll cycle, all ports | per device report |
| Loads a v0.3 file | no | no | no |

### 2.4 Findings of the review

1. Regression in the ports. `changed` with `edge="rising"` fires once in
   iolinkmaster2mqtt and modbus2mqtt (`internal/rules/engine.go:119-124`). The
   fix in tsend2mqtt commit `3949b2f` (`HasChanged` re-arm,
   `engine.go:127-134`) never reached the ports. No test in the ports makes
   sure that a second change fires (`engine_test.go:163`).
2. tsend2mqtt sends a resolve for a trigger that cooldown suppressed
   (`engine.go:136-143`). The forwarder ignores it. It is still noise. The
   ports track `incidentActive` and do not send it.
3. tsend2mqtt reads `time.Now()` inside `Eval` (`engine.go:77`). Cooldown is
   not testable with a fixed clock.
4. The ports compare slots with `!=` on `any` (`engine.go:81`). A slot with a
   non-comparable dynamic type panics at runtime. Drivers return scalars
   today, so the defect is latent.
5. The ports allocate a map and format a time string for every incident
   (`engine.go:153-171`). This is on the hot path and contradicts rule 3 of
   the coding guidelines. Incidents are rare, so the cost is small.
6. The ports count the summary in bytes (`parse.go:394`). The XSD and
   `rulesxml` count characters.
7. tsend2mqtt has no `source` on `<incident>`. The XSD requires it.
   `tsend2mqtt/examples/rules.xml` does not validate against the published
   schema. tsend2mqtt ignores the attribute when a file carries it.
8. `rulesxml` rejects `cooldown="0"` on purpose. The XSD accepts it. One file
   gets two verdicts.
9. tsend2mqtt ignores `device`. A file written for one service loads on another
   service with a different meaning.
10. No engine loads a v0.3 file. The parsers fail with
    `<cond> missing tag attribute`. `rulesxml` reports
    `unknown attribute expr on <cond>` (`schema.go:46-55`).
11. All three share one `lastFired` between the actions and the incident
    trigger. A rising edge inside the cooldown is consumed without a firing.
    All three document this pitfall and the two-rule workaround. This is a
    product decision, not a defect. The plan keeps the behavior.

## 3. Where the library lives

```
rules-editor/
  schema/
    rules.xsd                the schema, as today
    fixtures/                NEW: the XSD fixtures as files, from src/xsd.test.ts
      valid/  invalid/  app-level/  xsd-stricter/
    formula-cases.json       NEW: parse, print and error cases, from src/formula.test.ts
    formula-functions.json   NEW: the function registry, from FUNCTIONS in src/formula.ts
  rules-engine/
    go.mod                   module github.com/o16s/rules-editor/rules-engine, go 1.24
    README.md                the rules reference: the generic part of the three docs/rules.md
    rules/                   Catalog, Load, Rule, Engine, Action, Incident
    rulesxml/                structural validation, moved from modbus2mqtt
    formula/                 tokenizer, parser, compiler, evaluator
```

Rules for the module:

- A Go module in a subdirectory is tagged `rules-engine/vX.Y.Z`. The command
  `go get github.com/o16s/rules-editor/rules-engine@v0.3.0` resolves that tag.
  The npm tags `vX.Y.Z` stay as they are.
- The module version follows the schema version. `rules-engine/v0.3.x`
  implements schema 0.3.
- The `go` directive is `1.24`. tsend2mqtt is on 1.24.3. The other two are on
  1.25 and can require a 1.24 module.
- Standard library only. The library has no dependencies.
- The Power of Ten rules of the three services apply to the library.
- 32-bit ARM is a target (BL335). Do not use 64-bit atomics. Do not use `int`
  for a value of more than 2^31.
- The Go tests read `../../schema/...` with `os.ReadFile`. `//go:embed` cannot
  reach a parent directory.
- The npm package lists `dist` and `schema` in `files`. The new fixture files
  ship with it. They are small. Add them to `.npmignore` if that is not
  wanted.
- CI gets a Go job in `.github/workflows/`: `gofmt -l`, `go vet ./...`,
  `go test ./...`, and a cross-compile for `GOARCH=arm GOARM=7` and `arm64`.
  The job installs `libxml2-utils` and makes sure that the parity test ran.
  modbus2mqtt `.github/workflows/image.yml` has the step to copy.
- If the repository is private, consumers set `GOPRIVATE=github.com/o16s` and
  give CI a git credential.

## 4. The contract

### 4.1 Packages

- `rulesxml` examines the structure of the document and reports every problem
  with a path such as `rules/rule[2]/and/cond[1]@expr`. It knows the 0.3
  vocabulary. It needs no device set.
- `formula` turns text into an AST and does the static checks. It holds the
  function registry, compiles an AST to a program, and evaluates a program.
- `rules` binds a document to a `Catalog`, and operates the `Engine`.

### 4.2 API

```go
package rules

// Type is the value type of a field, named as JSON Schema names it.
type Type uint8

const (
	Bool Type = iota + 1
	Integer
	Number
	String
)

// Field is one value a service exposes to rules. Device is "" for a
// service with one implicit source, such as tsend2mqtt.
type Field struct {
	Device string
	Tag    string
	Type   Type
}

// Catalog is what the service knows at startup. Slot i of the value
// array passed to Eval holds the value of Fields[i].
type Catalog struct {
	Fields      []Field
	Sources     []string      // the names an <incident source> can use
	TopicPrefix string        // source ID = TopicPrefix + "/" + source; "" gives source ID = source
	Period      time.Duration // expected time between Eval calls; sizes the history of RATE, AVG, STALE
}

// TypeFromJSONSchema maps "boolean", "integer", "number" and "string".
func TypeFromJSONSchema(name string) (Type, bool)

// Problem is one fault in the file, structural or binding.
type Problem struct {
	Path    string // rules/rule[2]/and/cond[1]@expr
	Rule    string // the rule name, when known
	Message string
}

// Load validates the structure, then binds names, types and formulas.
// It reports every problem it can find. A non-empty list means that
// no rule was built.
func Load(data []byte, cat Catalog) ([]Rule, []Problem)

// Parse is Load for callers that want one error. Tests use it.
func Parse(r io.Reader, cat Catalog) ([]Rule, error)

// NewEngine preallocates every buffer from the rules and the catalog.
func NewEngine(rules []Rule, cat Catalog) *Engine

// Eval reads the slots, detects changes, evaluates the rules whose
// inputs changed or whose formulas depend on time, and returns what
// fired. The next call reuses the returned slices.
func (e *Engine) Eval(values []any, now time.Time) ([]Action, []Incident)

// Reset clears the edge state of every rule, resolves the active
// incidents, and keeps the cooldown timers. Call it on reconnect.
func (e *Engine) Reset(now time.Time) []Incident

func (e *Engine) RuleCount() int

// Action is one MQTT publish to an absolute topic.
type Action struct {
	Rule    string
	Topic   string
	Payload []byte
}

// Incident is one lifecycle event. Message renders the wire format.
type Incident struct {
	Rule      string
	Trigger   bool
	Source    string
	DedupKey  string
	Severity  string
	Summary   string
	FirstStep string
	Cause     string
}

const IncidentTopic = "incidents/"

type IncidentMsg struct {
	Action    string         `json:"action"`
	DedupKey  string         `json:"dedup_key"`
	Source    string         `json:"source"`
	Severity  string         `json:"severity,omitempty"`
	Summary   string         `json:"summary,omitempty"`
	FirstStep string         `json:"first_step,omitempty"`
	Cause     string         `json:"cause,omitempty"`
	Time      string         `json:"time"`
	Data      map[string]any `json:"data"`
}

// Message builds the JSON structure. It allocates, so the engine does
// not call it. The publisher does, once per incident.
func (i Incident) Message(now time.Time) IncidentMsg
```

### 4.3 Slot values

The dynamic type of `values[i]` must be one of: `nil`, `bool`, a signed or
unsigned integer type, `float32`, `float64`, `string`. `nil` means unknown.
A comparison with an unknown value is false. Change detection uses a type
switch and never `!=` on `any`. The engine is not safe for concurrent use.
One goroutine owns the slot array and calls `Eval`.

### 4.4 Evaluation semantics

These are the merged semantics. Each line names the service the behavior
comes from.

1. A rule evaluates when one of its slots changed (all three). A rule with a
   time function (`STALE`, `RATE`, `AVG`) also evaluates on every `Eval` call
   (new). The service must call `Eval` on a timer, not only on data.
2. `edge="none"` fires on every evaluation where the condition is true.
   `edge="rising"` fires on the change from false to true (all three).
3. `changed` and `CHANGED()` are a pulse. After a true result the rule
   re-arms, so the next change is a new rising edge (tsend2mqtt).
4. Cooldown applies to actions and to the incident trigger. It never applies
   to a resolve. Actions and trigger share one timer (all three, see finding
   11).
5. The incident triggers on a rising edge outside the cooldown and becomes
   active. It resolves on a falling edge only when active
   (iolinkmaster2mqtt). The incident lifecycle does not depend on `edge`
   (iolinkmaster2mqtt). tsend2mqtt loses its error on `edge="none"` with an
   incident.
6. `Reset` resolves the active incidents, clears the edge state, and keeps
   the cooldown timers (tsend2mqtt).
7. A `nil` slot makes every comparison false. A service that sets the slots
   of an offline device to `nil` resolves the incidents of that device
   (modbus2mqtt). The pattern is now available to all three.
8. A rule has at most 64 actions. Add `maxOccurs="64"` to the XSD and
   `LIMITS.maxActions` to `model.ts`, so all layers agree (decision 7).
9. Severity matches exactly. The summary has at most 120 characters, counted
   as code points. `cooldown="0"` means no cooldown and is accepted, as in the
   XSD. This removes the one divergence of `rulesxml`.
10. A `<cond>` without `device` resolves against the fields with
    `Device == ""`. When no such field exists, `Load` reports
    `device is required`. `<incident source>` must be one of
    `Catalog.Sources`.
11. The returned slices are valid until the next `Eval` or `Reset` call.

### 4.5 The formula language at runtime

Compile at `Load`, evaluate at `Eval`. Nothing is parsed on the hot path.

Compile steps, per formula:

1. Parse the text with the Go port of the parser in `src/formula.ts`.
2. Do the static checks that the editor does: unknown functions, argument counts,
   unresolved variables, cycles, `condition.description` only in Then fields.
3. Inline the variables of the rule. They are acyclic and at most 64.
4. Resolve every `TAG(...)` to a slot index and take its type from the
   catalog. Report an unknown device or tag as a problem.
5. Do a type check with the catalog types, as `inferType` does in the editor. A
   condition must be a boolean.
6. Linearize to a post-order instruction array. `Eval` walks the array with a
   value stack of fixed size. There is no recursion at runtime, and every
   bound is known at `Load`.

The runtime value is a small struct with a kind, a `bool`, an `int64`, a
`float64` and a `string`. Strings come from string fields, string literals,
`&` and the argument of `HEX2DEC`.

| Function | Runtime meaning |
|---|---|
| `TAG(tag)`, `TAG(device, tag)` | the slot value, of the catalog type |
| `AND(a, b, ...)`, `OR(a, b, ...)` | 2 to 16 arguments, short-circuit, as `AndCond` and `OrCond` today |
| `NOT(a)` | the opposite of a boolean |
| `CHANGED(x)` | true in the cycle where the value of `x` differs from the previous cycle. The engine keeps the previous value per `CHANGED` node, so `x` can be an expression |
| `STALE(x, d)` | true when `x` is `nil`, or when `x` did not change for `d` (see decision 5) |
| `RATE(x, w)` | last minus first sample in the window, divided by the window in hours |
| `AVG(x, w)` | mean of the samples in the window |
| `BITAND`, `BITOR`, `BITXOR` | on `int64`. A non-integer operand is a compile problem when literal, and a false result at runtime |
| `HEX2DEC("FF")` | `int64` of a hex string. Constant-folded when literal |
| `+ - * /`, unary `-` | on `float64` |
| `= != < <= > >=` | numeric when both sides are numbers, string when both are strings, boolean when both are booleans. Mixed types are false |
| `&` | string join. Numbers print with `strconv.FormatFloat(f, 'g', -1, 64)`, booleans as `true` or `false` |

Time windows: for each pair of slot and window, the engine keeps a ring of 64
buckets of width `window / 64`. Each bucket holds first, last, sum, count and
time. The memory is fixed at `NewEngine`. For `STALE`, the engine keeps the
time of the last change per slot.

Then fields: a `topic`, `payload`, `source`, `summary`, `first_step` or
`cause` that starts with `=` is compiled like a condition. At fire time the
engine renders it into a byte buffer of 4 KiB that belongs to the rule. The
returned `Action` and `Incident` reference that buffer until the next `Eval`.
`condition.description` is the description of the first true row that has
one, in document order. A `source` formula changes the dedup key, so the
engine stores the key of the trigger and uses it for the resolve.

Parity with the editor: `schema/formula-cases.json` holds cases of text,
canonical print and error column. `schema/formula-functions.json` holds the
registry. `vitest` and `go test` both read the two files. A change in
`formula.ts` without its mirror in Go fails the Go test on the same commit.

### 4.6 What stays in each service

- Build the `Catalog` from its own discovery: `.udt` fields in tsend2mqtt,
  `driver.DiscoverFieldTypes` in iolinkmaster2mqtt, the driver field types in
  modbus2mqtt.
- Own the `[]any` slot array. When data arrives, write the value. When a device goes
  offline, write `nil`.
- Call `Eval` from one goroutine, on data and on a timer.
- Publish the actions with QoS 0 to the absolute topic, and the incidents with
  `Message(now)` and QoS 1 to `IncidentTopic`. Keep the 10 ms spacing and the
  cap of 100 per cycle.
- Call `Reset` on a transport reconnect. tsend2mqtt does this today.
- Logging, the status page hooks of modbus2mqtt, and the file location rules.

### 4.7 Wire format

- `IncidentMsg` keeps the fields `action`, `dedup_key`, `source`, `severity`,
  `summary`, `time` and `data.rule`. It adds `first_step` and `cause` on a
  trigger, both optional. This is an additive change to
  `tsend2mqtt/docs/events-protocol.md` (decision 3).
- The dedup key of iolinkmaster2mqtt and modbus2mqtt stays
  `{topic_prefix}/{source}-{rule}`.
- The dedup key of tsend2mqtt today is `{topic_prefix}-{rule}`. To keep it,
  tsend2mqtt sets `TopicPrefix: ""` and `Sources: []string{cfg.MQTT.TopicPrefix}`,
  and its rules files carry `source="<topic_prefix>"` on each `<incident>`.
  The XSD requires that attribute anyway (finding 7).

## 5. Extraction, step by step

### 5.1 Build the library in rules-editor

1. Create `rules-engine/go.mod` with the module path and `go 1.24`.
2. Copy `modbus2mqtt/internal/rules/*.go` from `origin/main` of the bl335
   repository into `rules-engine/rules/`.
3. Copy `modbus2mqtt/internal/rulesxml/*.go` into `rules-engine/rulesxml/`.
   Do not copy `testdata/`.
4. Write a small script that exports the fixture tables of `src/xsd.test.ts`
   to `schema/fixtures/`. Make `src/xsd.test.ts` read the files from disk.
5. Point `parity_test.go` at `../../schema/rules.xsd` and
   `../../schema/fixtures/`. Do the test. Expect the 0.3 fixtures to fail.
6. Add the 0.3 vocabulary to `rulesxml/schema.go` and `rulesxml/attrs.go`.
   Add the elements `variables` and `var`. Add the attributes `expr`,
   `description`, `first_step` and `cause`. Add the either-or check on
   `<cond>`, the identifier pattern, the 240-character texts, and the limit
   of 64 variables. Drop the `cooldown="0"` divergence. Make the parity test
   green.
7. Write the red tests for the merged semantics of section 4.4. Port the
   tsend2mqtt engine tests to slots: `Reset`, the three `ChangedWithRisingEdge`
   tests, `CooldownDoesNotSuppressResolve`. Add tests for the `nil` type
   switch, the summary in characters, and the exact severity. Add tests for
   the optional `device`, an incident with `edge="none"`, the action cap, and
   the clock parameter.
8. Make the tests green. `Rule` gains `HasChanged`. `Engine` gains `Reset`.
   `Incident` replaces `IncidentMsg` in the engine output. `Load` returns the
   problem list.
9. Port `src/formula.ts` to `rules-engine/formula/`: tokenizer, Pratt parser,
   printer, references, `checkFunctions`, `inferType`. Export the cases of
   `src/formula.test.ts` to `schema/formula-cases.json`. Make both test
   suites read it.
10. Write the compiler: AST to program, `TAG` binding, variable inlining, type
    check.
11. Write the evaluator: the stack machine, `AND`, `OR`, `NOT`, `CHANGED`,
    `BITAND`, `BITOR`, `BITXOR`, `HEX2DEC`, the operators and `&`.
12. Add the time functions `STALE`, `RATE` and `AVG` with the bucket rings.
    Make time-dependent rules evaluate on every call.
13. Add the Then fields and `condition.description`.
14. Write `rules-engine/README.md` from the generic parts of the three
    `docs/rules.md`. The service-specific sections stay in each service.
15. Add the CI job. Tag `rules-engine/v0.3.0`.

### 5.2 Migrate modbus2mqtt

This is the smallest change. The code already uses slots, `now` and
structural validation.

1. Add the module with `go get github.com/o16s/rules-editor/rules-engine@v0.3.0`.
2. Delete `internal/rules/` and `internal/rulesxml/`, with the vendored
   `testdata/`. Delete the CI step `Schema parity really ran`. The parity
   test moves to the CI of rules-editor.
3. In `cmd/modbus2mqtt/setup.go`, make `ruleFields` build a `rules.Catalog`
   with `Fields`, `Sources` (the device names), `TopicPrefix` and `Period`.
   Keep `fieldsByDevice`. Replace `checkAndParseRules` with `rules.Load`.
   Replace `rules.NewEngine(parsed, idx)` with `rules.NewEngine(parsed, cat)`.
4. In `cmd/modbus2mqtt/aggregator.go`, publish `incidents[i].Message(now)`
   and read `incidents[i].Rule` instead of `RuleName()`. Add a timer event
   that calls `evalRules` without a report.
5. Keep the modbus-specific sections of `docs/rules.md`. Link the language
   reference to the library README.
6. Before step 2, record a golden file with the old engine. Load
   `examples/rules.xml`, feed a scripted value sequence, and save the actions
   and incidents. After the migration, a replay test must produce the same
   output.

### 5.3 Migrate iolinkmaster2mqtt

Same as modbus2mqtt, plus:

1. `loadRules` in `cmd/iolinkmaster2mqtt/main.go` calls `rules.Load` and logs
   every problem before it exits. This is new behavior for this service.
2. `poll()` already calls `Eval` once per cycle. That cycle is the timer.
3. Set the slots of a port to `nil` when `portMiss` takes the port offline
   (decision 9). Today the last value stays.

### 5.4 Migrate tsend2mqtt

This is the largest change. The engine no longer decodes the frame.

1. Add the module with `go get`. Delete `internal/rules/`.
2. In `loadRules`, build the catalog from `layout.Fields`:
   `Field{Device: "", Tag: f.Name, Type: typeOf(f.Type)}`. `typeOf` maps
   `TypeBool` to `Bool`, and `TypeReal` and `TypeLReal` to `Number`. It maps
   `TypeString` and `TypeWString` to `String`, and every other S7 type to
   `Integer`. Set
   `Sources: []string{cfg.MQTT.TopicPrefix}` and `TopicPrefix: ""`.
3. Own `ruleValues := make([]any, len(layout.Fields))`. On the first frame of
   a connection, decode every field into the slots with `decode.DecodeField`.
   On each later frame, set `ruleValues[c.Index] = c.Value` for each changed
   tag. Then call `Eval(ruleValues, time.Now())`.
4. Replace `publishIncident` with `json.Marshal(inc.Message(now))` and
   `pub.PublishIncident`. Keep `Reset(now)` on reconnect.
5. Add `source="<topic_prefix>"` to each `<incident>` in `examples/rules.xml`
   and in the deployed files. Update `docs/rules.md`.
6. Add a 1 s timer that calls `Eval` without a frame. The reader loop blocks
   in `sc.Scan()`. Protect `Eval` and the slot array with a mutex, or move the
   timer into the reader goroutine.
7. Two behaviors change for this service. Incident rules with `edge="none"`
   now load. A suppressed trigger no longer produces a resolve.

## 6. Decisions to make before the work starts

| # | Question | Recommendation |
|---|---|---|
| 1 | Module path and package names | `github.com/o16s/rules-editor/rules-engine` with packages `rules`, `rulesxml`, `formula`. If the editor and the engine need separate release cadences, move the module to a sibling repository later. |
| 2 | The dedup key of tsend2mqtt | Keep it. Use `TopicPrefix: ""` and `source="<topic_prefix>"` as in section 4.7. A key change orphans the incidents that are active at cutover. |
| 3 | `first_step` and `cause` on the wire | Add them as optional trigger fields. Update `events-protocol.md` and the forwarder. |
| 4 | Cooldown consumes the rising edge (finding 11) | Keep the behavior in v0.3. Revisit with the users of the two-rule workaround. |
| 5 | Meaning of `STALE` | Time since the last change, or `nil`. A constant value counts as no update. If you need a per-slot freshness signal, add an `Eval` variant that takes the refreshed slots in a later version. |
| 6 | Go version floor | `go 1.24`, so tsend2mqtt needs no toolchain change. |
| 7 | Actions per rule | Cap at 64 in the XSD, `model.ts` and the engine. Today the XSD says unbounded. |
| 8 | Repository visibility | If private, document `GOPRIVATE` in the three service READMEs. |
| 9 | `nil` slots for an offline device in iolinkmaster2mqtt | Adopt the modbus2mqtt behavior. It resolves incidents of a device that went silent. |
| 10 | Editor `device` optional versus service requirement | The library rule of section 4.4 item 10. modbus2mqtt and iolinkmaster2mqtt keep their requirement through the catalog. |

## 7. Size

- Code that moves: about 1,300 lines of Go in `rules` and `rulesxml`, and
  about 2,400 lines of tests across the three services. The union of the
  tests is the target suite.
- New code: the formula port, compiler and evaluator, about 1,500 to 2,000
  lines with tests. `src/formula.ts` is 451 lines.
- Adapters: about 50 changed lines in modbus2mqtt, 80 in iolinkmaster2mqtt,
  and 120 in tsend2mqtt.
