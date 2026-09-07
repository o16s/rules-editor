# Adapters: the three services on the shared engine

This document is a plan. `PLAN.md` records how the engine was built, and
`specs/` holds its requirements. This one covers the work in the three service
repositories: tsend2mqtt, iolinkmaster2mqtt and modbus2mqtt.

No service runs the shared engine yet, and no rule file in the field uses the
0.3 format. There is no legacy to protect, so nothing here is a fallback. Each
service drops its own engine, adopts the module, and moves its rule files to
the current schema in one change.

## 1. What every service does

The same six steps, in the same order.

1. **Require the module.** `go get github.com/o16s/rules-editor/rules-engine@rules-engine/v0.3.1`.
2. **Delete its own engine.** `internal/rules/`, and `internal/rulesxml/` in modbus2mqtt, with their tests and their vendored fixtures.
3. **Build a catalog** from the discovery it already has, and call `rules.Load`. Log every problem with its path and its rule, then exit.
4. **Own a slot array.** Write a value when data arrives. Write `nil` when a device goes offline, and when a report lacks a field it used to carry.
5. **Call `Eval`** on data and on a timer, from one goroutine. Publish the actions with QoS 1 to their absolute topics, then the incidents with QoS 1 to `incidents/`.
6. **Move its rule file and its documentation to the current schema.**

### What must not change

- The MCAP writer keeps its own input: the report as it arrived, or the raw frame. The slot array never reaches it, so a `nil` written for an offline device or an absent field does not enter the log.
- The timer that calls `Eval` without new data must not write to MCAP. A log row means a poll happened.
- Discovery, the status topics, the command handlers and the configuration contract stay as they are.

### One incident identity

Every service sets a topic prefix and every incident names a device, so every
key is `{topic_prefix}/{source}-{rule}` (ADR-019). tsend2mqtt changes here:
its incidents gain a `source`, which the schema requires anyway.

## 2. modbus2mqtt (smallest, do it first)

It already uses slots, a clock parameter and structural validation, so the
change is about 50 lines.

| File | Change |
|------|--------|
| `go.mod` | Require the module |
| `internal/rules/`, `internal/rulesxml/` | Delete, with `testdata/` |
| `cmd/modbus2mqtt/setup.go` | `ruleFields` returns a `rules.Catalog` and `fieldsByDevice`. `checkAndParseRules` becomes `rules.Load`, and the engine is `NewEngine(parsed, cat)` |
| `cmd/modbus2mqtt/aggregator.go` | Publish `incidents[i].Message(now)`. Read `incidents[i].Rule` for the status page. Write `nil` into the slots of a device for every field its report lacks. Add a ticker case that calls `evalRules` |
| `.github/workflows/ci.yml` | Drop the schema parity step, which now runs in rules-editor |
| `examples/rules.xml`, `docs/rules.md` | To the current schema, see section 5 |

Watch: `handleReport` writes MCAP before it evaluates rules. Keep that order,
and keep `r.Values` as the MCAP input.

## 3. iolinkmaster2mqtt

About 80 lines, plus two behavior changes it gains from the module.

| File | Change |
|------|--------|
| `go.mod` | require the module |
| `internal/rules/` | Delete |
| `cmd/iolinkmaster2mqtt/main.go` | `loadRules` builds the catalog from `portFieldTypes`, calls `rules.Load`, logs every problem, then exits. `poll()` writes `nil` into the slots of a port whose report lacks a field, and into every slot of a port that went offline. Incidents publish through `Message` |
| `examples/rules.xml`, `docs/rules.md` | To the current schema |

Two changes an operator will notice, both intended:

- A `CHANGED` rule now fires on every change, not only on the first (ADR-018 and the fix this service never received).
- A device that goes offline resolves its incident instead of holding it (ADR-010).

The poll cycle is the timer, so no extra ticker is needed.

## 4. tsend2mqtt (largest)

About 120 lines. Its engine decodes frames today, and the module does not.

| File | Change |
|------|--------|
| `go.mod` | require the module |
| `internal/rules/` | delete |
| `cmd/tsend2mqtt/main.go` | `loadRules` builds the catalog from `layout.Fields` with `Device` empty, and `typeOf` maps the S7 types. A `ruleState` holds the engine, the slots and a mutex. The first frame of a connection decodes every field into the slots, and each later frame writes the changed tags. A 1 s ticker calls `Eval`. `publishIncident` becomes `json.Marshal(inc.Message(now))`, and a reconnect calls `Reset(now)` |
| `examples/rules.xml`, `docs/rules.md`, `docs/events-protocol.md` | To the current schema. The protocol gains `first_step` and `cause` (ADR-007) |

The S7 type map is: `Bool` to boolean, `Real` and `LReal` to number, `String`
and `WString` to string, and every other type to integer. `Date` and `TOD` are not
decoded today, so their slots stay `nil` and a rule on them never matches.

Watch: the frame loop blocks in `sc.Scan()`. The ticker and the reader must
hold one mutex around the slots and the engine, or the ticker must post into
the reader goroutine.

## 5. The rule files and the documentation

Each service ships `examples/rules.xml`. They move to the current schema,
because that is what the editor writes and what the hub validates:

- Conditions become `<cond expr="…"/>`, with a `description` on each row.
- A rule that repeats a value gains a `<variables>` block.
- Every `<incident>` carries `source`, and gains `first_step` and `cause` where an operator needs them.
- Nested `<and>`/`<or>` groups fold into one row per group, which is what the editor writes on the next save.

Each `docs/rules.md` keeps only what is specific to its service. That is the
field table of its drivers, where the rules file lives, and how the service
maps its data to fields. Everything about the language, the operators, the limits and
the lifecycle links to the module README, so one text describes one behavior.

## 6. Order of the work

1. Merge the engine branch in rules-editor and tag `rules-engine/v0.3.1`.
2. Let edge-hub adopt schema 0.3.1, so the hub and the services agree on what a file may hold (SYSREQ-016).
3. modbus2mqtt, then iolinkmaster2mqtt, then tsend2mqtt. Each is one pull request: adapter, rule file, documentation and the behavior test of SWREQ-017.
4. Deploy one service, watch its incidents for a day, then the next.

## 7. Tests each service adds

- The behavior test of SWREQ-017: a scripted sequence of values, and the actions and incidents it must produce.
- One test that a timer tick without new data writes no MCAP message.
- One test that a device going offline clears its slots, resolves its incident, and leaves the last MCAP message untouched.
- For tsend2mqtt: one test under `-race` that the ticker and the reader do not touch the slots at once.

## 8. What is not in this plan

- Persisting cooldown timers or incident state across a restart. The engine resolves what it cannot confirm, and that is enough (ADR-014).
- Reloading a rules file without a restart.
- Any change to discovery, MCAP, the status page or the configuration contract.
