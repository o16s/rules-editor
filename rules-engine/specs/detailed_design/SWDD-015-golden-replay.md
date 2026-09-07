---
id: "SWDD-015"
type: software_detailed_design
name: "Service behavior test harness"
description: >
  The two data files and the test that drives one service adapter through a
  scripted sequence of values.
satisfies:
  - "SWREQ-017"
---

# Software Implementation: Service behavior test harness

## Overview

One test file per service, `internal/replay/replay_test.go`, and two data
files: `testdata/steps.json` and `testdata/expected.json`.

## Static View (Structure)

```json
{ "steps": [ { "t_ms": 0, "values": { "pool1.flow_signal": 0 } } ] }
```

```json
{ "steps": [ { "rule": "pool1-flow-bypass", "actions": [],
               "incidents": [ { "action": "trigger", "dedup_key": "modbus/pool1-pool1-flow-bypass",
                                "severity": "critical", "summary": "Hydrolysis flow detection bypassed (ALWAYS_ON)" } ] } ] }
```

## Dynamic View (Logic)

The test builds the catalog with the same function the service uses at
startup, so a change to the discovery breaks the test. It loads
`examples/rules.xml`, applies each step to the slot array, calls `Eval` with
the step time, and compares the actions and incidents with the expected file.
A step with no values is a timer tick.

## Interface & API Definitions

Test only. The catalog builder is the one of the service, exported inside the
package or called through the setup function.

## Error Handling & Edge Cases

- tsend2mqtt has no device in its keys, so a step names the tag alone.
- A `null` value writes `nil` into the slot, which is what the service writes for an offline device.

## Notes

SWREQ-017. There is no recording step: no old engine and no deployed 0.3 file
exist to record from.
