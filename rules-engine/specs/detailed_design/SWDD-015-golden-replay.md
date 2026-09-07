---
id: "SWDD-015"
type: software_detailed_design
name: "Golden replay test per service"
description: >
  A scripted value sequence, a recorder against the old engine, and a replay
  against the module.
satisfies:
  - "SWREQ-017"
---

# Software Implementation: Golden replay test per service

## Overview

One test file per service, `internal/replay/replay_test.go`, plus two data
files: `testdata/replay-steps.json` and `testdata/replay-golden.json`.

## Static View (Structure)

```json
{ "steps": [ { "t_ms": 0,    "values": { "pump1.error_code": 0,  "pump1.temperature": 40.0 } },
             { "t_ms": 1000, "values": { "pump1.error_code": 5 } },
             { "t_ms": 2000, "values": { "pump1.error_code": null } } ] }
```

```json
{ "steps": [ { "actions": [], "incidents": [] },
             { "actions": [ { "topic": "modbus/pump1/param/set_running", "payload": "{\"value\": false}" } ],
               "incidents": [ { "action": "trigger", "dedup_key": "modbus/pump1-pump1-fault", "severity": "error", "summary": "BADU pump reports a fault" } ] },
             { "actions": [], "incidents": [ { "action": "resolve", "dedup_key": "modbus/pump1-pump1-fault" } ] } ] }
```

## Dynamic View (Logic)

Recorder (before migration): load `examples/rules.xml` with the old engine and
the field index of the example configuration. Apply each step, call the old
`Eval`, serialize the outputs. Commit the golden file. Delete the recorder
with the old engine.

Replay (after migration): load the same file with `rules.Load` and the same
catalog. Apply each step, call `Eval`, compare with the golden file. Steps
that differ on purpose carry an `"expect_after_migration"` override in the
golden file, with the ID of the requirement that explains the change.

## Interface & API Definitions

Test-only.

## Error Handling & Edge Cases

- tsend2mqtt has no `device` in its keys: the step values use the tag name alone.
- A `null` value writes `nil` into the slot.

## Notes

SWREQ-017 lists the accepted differences.
