# rules-engine

The rule engine of the octaview Edge Hub, as one Go module.

An operator writes rules in the [rules editor](../README.md) and saves a
`rules.xml` file. The Edge Hub validates it against `../schema/rules.xsd` and
stores it in the service directory. Every ingestion service loads that file
with this module and evaluates the rules against its decoded data. A rule
publishes MQTT messages, raises an incident, or does both.

The module has no dependency outside the Go standard library.

## Install

```bash
go get github.com/o16s/rules-editor/rules-engine@v0.4.1
```

The module lives in a subdirectory, so its git tag is `rules-engine/v0.4.1`.
Go maps the path suffix to that tag prefix by itself, so the version string
stays `v0.4.1`. Do not write `@rules-engine/v0.4.1`: Go rejects it as an
invalid version. The npm package keeps the plain `vX.Y.Z` tags.

The repository is public, so a build needs no credential. For a private fork,
set `GOPRIVATE=github.com/o16s` and give the build a git credential.

## Use

```go
cat := rules.Catalog{
    Fields: []rules.Field{
        {Device: "pump1", Tag: "error_code", Type: rules.Integer},
        {Device: "pump1", Tag: "temperature", Type: rules.Number},
    },
    Sources:     []string{"pump1"},
    TopicPrefix: "modbus",
    Period:      time.Second,
}

parsed, problems := rules.Load(data, cat)
for _, p := range problems {
    slog.Error("rules problem", "at", p.Path, "rule", p.Rule, "problem", p.Message)
}
if len(problems) > 0 {
    os.Exit(1)
}

eng := rules.NewEngine(parsed, cat)
values := make([]any, len(cat.Fields))

// On every device report, and on a timer at least once per Period:
actions, incidents := eng.Eval(values, time.Now())
for i := range actions {
    pub.PublishRawAbsolute(actions[i].Topic, actions[i].Payload)
}
for i := range incidents {
    pub.PublishQoS1Absolute(rules.IncidentTopic, incidents[i].Message(time.Now()))
}
```

### What the service owns

- The catalog: the fields it decodes, their types, and the names an incident may use as its source.
- The slot array. Slot `i` holds the value of `Fields[i]`. When data arrives, write the value. When a device goes offline, or a report lacks a field, write `nil`.
- The calls to `Eval`, from one goroutine, on data and on a timer.
- The MQTT publishing, the logging and the counters of `Stats`.
- The call to `Reset` when a data connection is established again.

### What a slot may hold

`nil`, `bool`, `string`, `float32`, `float64`, and every Go integer type.
`nil` means unknown. Any other type reads as unknown and increments
`Stats.UnknownSlotTypes`.

### Lifetime of a result

`Eval` and `Reset` return slices the engine reuses, and the strings inside
them can point into a buffer of the rule. They are valid until the next call.
Copy what you keep.

## Semantics

| Subject | Rule |
|---------|------|
| When a rule runs | One of the slots its condition reads changed, or its condition reads a clock, or it has no rising edge. |
| Order | The rules of one evaluation fire in the order of the file. The actions of one rule fire in the order of the document. |
| `edge="none"` | Fires on every evaluation where the condition is true, subject to the cooldown. |
| `edge="rising"` | Fires on the change from false to true. |
| `cooldown` | The minimum time between two firings. It covers the actions and the incident trigger. It never delays a resolve. A rising edge inside the cooldown is consumed, so a rule that resets its own condition needs a second rule without a cooldown. |
| `CHANGED` | True when the value differs from the last known value. The first value after a start is not a change, and neither is a value going unknown. A rule that fires on a pulse re-arms its edge, and only the row that fired decides that. |
| Incident | Triggers on a rising edge outside the cooldown, resolves on a falling edge while it is open, whatever `edge` says. |
| After a restart | Every incident rule starts active. The first evaluation resolves an alarm whose cause is gone, and triggers one whose cause is still there. |
| Unknown values | Every comparison with an unknown value is false. A rule whose device went offline resolves its incident. |
| Then fields | A `topic`, `payload`, `source`, `summary`, `first_step` or `cause` that starts with `=` is a formula, rendered when the rule fires. |

## The formula language

The registry is `../schema/formula-functions.json`, and it carries the help
text and a small example for each function, so the editor and this module
describe a function the same way. `../schema/formula-cases.json` holds the text
both must read the same way, and `../schema/eval-cases.json` the answers this
module must give. The editor runs this module, compiled to WebAssembly, so
there is one implementation and those cases are its specification test
(ADR-024).

### Values and logic

| Function | Result |
|----------|--------|
| `TAG(tag)`, `TAG(device, tag)` | the current value of a field |
| `AND(a, b, …)`, `OR(a, b, …)`, `NOT(a)` | boolean logic, with short-circuit evaluation |
| `BITAND`, `BITOR`, `BITXOR`, `HEX2DEC` | integer operations |

Operators, lowest precedence first: `&`, then `= != < <= > >=`, then `+ -`,
then `* /`, then unary `-`. `&` joins text.

A comparison between kinds that have no common meaning is unknown, which reads
as false in a condition. A boolean compared with `1` or `0` keeps the meaning
of the 0.2 form, and a boolean compared with any other number is false. Two
strings order by code point.

### History

These read what the field did, not only what it reads now.

| Function | Result |
|----------|--------|
| `CHANGED(x)` | true in the evaluation where `x` changed |
| `PREV(x)` | the value `x` held before its last change |
| `SINCE(x)` | seconds since `x` last changed |
| `STALE(x, 4h)` | true when `x` is unknown, or did not change within the duration. Without a duration it uses 4h |

### Over a window

| Function | Result |
|----------|--------|
| `AVG(x, 10min)` | the mean of the readings |
| `MIN(x, 10min)`, `MAX(x, 10min)` | the smallest and the largest reading; a peak one poll would miss |
| `COUNT(x, 1h)` | how many readings the window holds |
| `DELTA(x, 15min)` | the newest reading minus the oldest |
| `RATE(x, 30min)` | the change per hour between those two readings |
| `STDDEV(x, 30min)` | how much the readings spread around their mean |
| `ZSCORE(x, 2h)` | how unusual the current reading is against that spread |
| `SLOPE(x, 1h)` | the trend per hour, fitted through every reading |
| `FORECAST(x, 1h, 8h)` | where the value lands after the horizon, if the trend holds |
| `EWMA(x, 5min)` | a smoothed value; recent readings weigh more |

A window function needs a field, not an expression, and a literal duration.

**A window holds one reading per evaluation, not one per change.** A mean over
ten minutes is the mean of the readings (ADR-022). The history is a ring of at
most 64 buckets per field and duration, allocated once, about 5 KB each and at
most 256 of them. `EWMA` keeps one number instead of a ring, so it costs
almost nothing and answers on the first reading.

`RATE` divides by the time between the two readings it used, not by the width
of the window, so a window that is not yet full reports the rate of what it
holds. The two moments are the starts of their buckets, so the span is exact to
one bucket.

Every one of them answers **unknown, never zero**, when there is nothing to
answer from: a zero would satisfy a threshold such as `< 5` on a service that
has just started. `COUNT` is the exception, because no readings is a number an
operator can compare against.

### A short-circuit and memory

`AND` and `OR` stop at the argument that decides the answer, except when an
argument carries memory. `CHANGED`, `PREV` and `EWMA` answer from what they saw
at every evaluation, so a call containing one runs all of its arguments
(ADR-023). A decided answer still absorbs an unknown after it, so
`AND(false, unknown)` is false.

## In the browser

`npm run build:engine` in the parent directory builds this module for the
browser and writes `dist/rules-engine.wasm` and `dist/wasm_exec.js`. The
editor's Simulator page loads it, so what an operator sees before deploying a
file is what the gateway does with it (ADR-024). `cmd/wasm` is the entry point;
it is not part of a gateway build.

## Limits

| Limit | Value |
|-------|-------|
| Rules per file | 1000 |
| Condition rows per rule, children per group | 16 |
| Condition nesting of a 0.2 file | 4 levels, the leaf included |
| Variables per rule | 64 |
| Publish actions per rule | 64 |
| Incident summary | 120 characters |
| `description`, `first_step`, `cause` | 240 characters |
| Time windows per file | 256 |
| Smoothed values per file | 256 |
| Actions or incidents per evaluation | 100 |
| Rendered Then fields per rule | 4096 bytes |

## Develop

```bash
gofmt -l .                                    # must print nothing
go vet ./...
go test ./... -count=1                        # the parity test needs xmllint
go test -bench . -benchmem ./rules/           # must report 0 allocs/op
GOOS=linux GOARCH=arm GOARM=7 go build ./...  # the BL335 target
GOOS=linux GOARCH=arm64 go build ./...        # the IOT2050 target
```

`PLAN.md` records how the module replaces the three engines the services
carried. `specs/` holds the requirements and the design as a
[SARA](https://github.com/cledouarec/sara) graph; `sara check` validates it.

## Release

The schema version, the npm package version and the module version move
together, so one version number names one language.

1. Change `../schema/rules.xsd`, `../package.json` and the editor. Build the browser module and release the npm package.
2. Let edge-hub adopt the schema version, so the hub and the services agree on what a file may contain.
3. Tag `rules-engine/vX.Y.Z` and `vX.Y.Z` on the same commit.
4. Each service updates one line in its `go.mod` and re-records its replay goldens.
