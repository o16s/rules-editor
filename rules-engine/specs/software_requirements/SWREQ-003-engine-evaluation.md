---
id: "SWREQ-003"
type: software_requirement
name: "Engine evaluation"
description: >
  Engine.Eval detects changed slots, evaluates the affected rules and the
  time-dependent rules, and applies edge and cooldown.
specification: >
  `Engine.Eval` must detect changed slots. It must evaluate each rule that
  references a changed slot or uses a time function, at most once per call. It
  must apply `edge`, `cooldown` and the `CHANGED` re-arm as SYSREQ-003 states.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-006"
  - "SWREQ-009"
---

# Software Requirement: Engine evaluation

## Requirement Specification

> `Engine.Eval` must detect changed slots. It must evaluate each rule that references a changed slot or uses a time function, at most once per call. It must apply `edge`, `cooldown` and the `CHANGED` re-arm as SYSREQ-003 states.

## Rationale

This is the hot path. It operates at 100 Hz on tsend2mqtt.

## Logic & Interface Details

```go
func NewEngine(rules []Rule, cat Catalog) *Engine
func (e *Engine) Eval(values []any, now time.Time) ([]Action, []Incident)
func (e *Engine) RuleCount() int
```

Per call:

1. For each slot `i` less than `len(cat.Fields)`, compare `values[i]` with the previous value with `equalValue`. Record changed slots in `changedSet` and `changedBuf`.
2. For each changed slot, mark each rule in `rulesByField[i]` as due. Mark each rule in `timeRules` as due.
3. Evaluate the due rules in rule index order, which is the document order (ADR-016).
4. Copy `values` into `prevValues`. Clear `changedSet` and `evalSet` for the touched entries only.

Per rule:

- `result` is the value of the compiled condition program.
- `rising = result && !prev`, `falling = !result && prev`, then `prev = result`.
- If the rule contains a `CHANGED` node and `result` is true, set `prev = false` after the edge computation.
- `cooledDown = Cooldown == 0 || lastFired.IsZero() || now.Sub(lastFired) >= Cooldown`.
- `edge="none"`: fire actions when `result && cooledDown`. `edge="rising"`: fire actions when `rising && cooledDown`. A firing sets `lastFired = now`.
- The incident state machine of SWREQ-004 comes after the actions.

## Acceptance Criteria

- Every `TestEngine_*` and `TestEngineEval_*` test of the three services passes.
- A rule with two changed slots in one call is evaluated once.
- Two rules that fire in one call return their actions in document order, whatever the slot order.
- A rule with no changed slot and no time function is not evaluated.
- `Eval(nil, now)` returns `nil, nil`.
- 0 allocs/op in the benchmark of SYSREQ-008.

## Verification Plan

- **Method**: test.
- **Procedure**: The union of the `engine_test.go` files, with a fixed clock. A benchmark with the three `examples/rules.xml` files and a 300-slot array.

## Notes

The engine is not safe for concurrent use.
