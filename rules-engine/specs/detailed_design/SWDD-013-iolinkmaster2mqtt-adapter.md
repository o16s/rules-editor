---
id: "SWDD-013"
type: software_detailed_design
name: "iolinkmaster2mqtt adapter"
description: >
  Changes in main.go: Load with problems, Catalog, nil slots on offline,
  Message at publish.
satisfies:
  - "SWREQ-015"
---

# Software Implementation: iolinkmaster2mqtt adapter

## Overview

About 80 changed lines in `cmd/iolinkmaster2mqtt/main.go`.

## Static View (Structure)

```go
func loadRules(path string, devices []config.DeviceConfig, portFieldTypes map[string]map[string]string,
    topicPrefix string, period time.Duration) (*rules.Engine, []any, map[string]int, map[string][]int)
```

The fourth return value maps a sensor name to its slots, for the offline case.

## Dynamic View (Logic)

`poll()`: per port, write decoded fields into `ruleValues`. On `portMiss`
that crosses the threshold, write `nil` into the slots of the port. After all
ports, `Eval(ruleValues, now)` once. The poll cycle is the timer, so no extra
ticker is needed. Incidents publish `incidents[i].Message(now)`.

## Interface & API Definitions

Unchanged for the rest of the service.

## Error Handling & Edge Cases

- A master that is unreachable marks every port as a miss. After the threshold, every slot is `nil` and every incident resolves. This is the intended behavior (ADR-010).

## Notes

`docs/rules.md` keeps the IO-Link field table and links to the module README for the language.
