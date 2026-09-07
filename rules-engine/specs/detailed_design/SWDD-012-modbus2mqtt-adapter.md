---
id: "SWDD-012"
type: software_detailed_design
name: "modbus2mqtt adapter"
description: >
  Changes in setup.go and aggregator.go, and the deletion of two internal
  packages.
satisfies:
  - "SWREQ-014"
---

# Software Implementation: modbus2mqtt adapter

## Overview

About 50 changed lines in `cmd/modbus2mqtt/`.

## Static View (Structure)

```go
// setup.go
type rulesRuntime struct {
    eng            *rules.Engine
    values         []any
    fieldMap       map[string]int      // "device.tag" -> slot
    fieldsByDevice map[string][]int
}
func ruleFields(devices []*deviceRuntime, cfg *config.Config) (rules.Catalog, map[string]int, map[string][]int)
func loadRules(path string, cfg *config.Config, devices []*deviceRuntime) *rulesRuntime
```

## Dynamic View (Logic)

`loadRules`: read the file (1 MiB cap), `rules.Load(data, cat)`. On problems,
log each `Path`, `Rule`, `Message`, then `os.Exit(1)`. Else
`rules.NewEngine(parsed, cat)`.

`aggregator.handleReport`: unchanged. `evalRules(now)`: publish
`incidents[i].Message(now)`, record `incidents[i].Rule`. `aggregator.run`:
add `case <-ticker.C: a.evalRules(time.Now())` with the ticker at
`cat.Period`.

## Interface & API Definitions

The `publisher` interface of the aggregator is unchanged.

## Error Handling & Edge Cases

- An absent `/svc/rules.xml` still disables rules with one warning.
- The `-rules` flag for local operation is unchanged.

## Notes

The CI step `Schema parity really ran` moves to rules-editor.
