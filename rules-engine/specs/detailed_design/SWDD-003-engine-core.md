---
id: "SWDD-003"
type: software_detailed_design
name: "Engine core: scheduling, edge and cooldown state"
description: >
  The engine of iolinkmaster2mqtt with the HasChanged re-arm of tsend2mqtt, a
  type-switch equality and a time-rule list.
satisfies:
  - "SWREQ-003"
  - "SWREQ-006"
---

# Software Implementation: Engine core: scheduling, edge and cooldown state

## Overview

The structure is the current `engine.go` of the polling services:
`rulesByField`, `changedSet`, `changedBuf`, `evalSet`, `evaled`,
`prevValues`, and preallocated result slices. Three additions: a
`timeRules []int` list, the `HasChanged` re-arm, and `equalValue`.

## Static View (Structure)

```mermaid
graph TD
    E[Engine] --> RBF["rulesByField [][]int"]
    E --> TR["timeRules []int"]
    E --> CS["changedSet []bool, changedBuf []int"]
    E --> ES["evalSet []bool, evaled []int"]
    E --> PV["prevValues []any, lastChange []time.Time"]
    E --> W["windows []ring (SWDD-008)"]
    E --> OUT["actions []Action, incidents []Incident"]
    E --> ENV["formula.Env (slots, changedSet, windows, now, context)"]
```

## Dynamic View (Logic)

```mermaid
stateDiagram-v2
    [*] --> Idle: prev=false
    Idle --> Active: result true (rising)
    Active --> Idle: result false (falling)
    Active --> Idle: HasChanged and result true (re-arm after the edge)
    Idle --> Idle: result false
    Active --> Active: result true, no CHANGED
```

Per `Eval`: phase 1 detects changes with `equalValue` and records
`lastChange[i] = now`. Phase 2 evaluates the rules of changed slots, then the
time rules, each at most once (`evalSet`). Phase 3 copies the values and
clears the touched flags. The rule evaluation is the logic of SWREQ-003 with
`fireActions` and the incident machine of SWDD-004.

## Interface & API Definitions

`NewEngine(rules []Rule, cat Catalog) *Engine`, `Eval`, `Reset`, `RuleCount`.
`NewEngine` panics on a nil rules slice, on `len(cat.Fields) < 0`, and on a
rule whose `FieldRefs` exceed the field count. Every other fault is a `Load`
problem.

## Error Handling & Edge Cases

- `values` shorter than the catalog: the missing slots count as `nil`.
- `values` longer than the catalog: the extra slots are ignored.
- A `NaN` float compares as changed on every call. This is documented.
- The action loop per rule is bounded by `MaxActions = 64`.

## Notes

The shared `lastFired` between actions and trigger stays (ADR-004). The slot
model is ADR-003. The action cap is ADR-009.
