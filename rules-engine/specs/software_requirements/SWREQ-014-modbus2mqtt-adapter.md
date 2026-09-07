---
id: "SWREQ-014"
type: software_requirement
name: "modbus2mqtt adapter"
description: >
  modbus2mqtt replaces its internal packages with the module and keeps its
  behavior.
specification: >
  modbus2mqtt must build a `Catalog` from its device field types and call
  `rules.Load`. It must keep its slot array and `fieldsByDevice` map, and call
  `Eval` on each device report and on a timer. It must publish through
  `Incident.Message`, and delete `internal/rules` and `internal/rulesxml`.
derives_from:
  - "SYSARCH-002"
depends_on:
  - "SWREQ-002"
  - "SWREQ-005"
---

# Software Requirement: modbus2mqtt adapter

## Requirement Specification

> modbus2mqtt must build a `Catalog` from its device field types and call `rules.Load`. It must keep its slot array and `fieldsByDevice` map, and call `Eval` on each device report and on a timer. It must publish through `Incident.Message`, and delete `internal/rules` and `internal/rulesxml`.

## Rationale

modbus2mqtt is the closest to the module. Its change is the smallest.

## Logic & Interface Details

- `cmd/modbus2mqtt/setup.go`: `ruleFields` returns `rules.Catalog{Fields, Sources, TopicPrefix, Period}` and `fieldsByDevice`. `Fields` is built per device in the configuration order, with `TypeFromJSONSchema` on the driver field type. `Sources` is the device names. `Period` is the shortest poll interval.
- `checkAndParseRules` becomes `rules.Load(data, cat)`. The problem loop logs `Path`, `Rule` and `Message`.
- `rulesRuntime` keeps `eng`, `values`, `fieldMap` (device.tag to slot) and `fieldsByDevice`.
- On a device report, the adapter writes each reported field into its slot, and `nil` into every other slot of that device (SYSREQ-011).
- `cmd/modbus2mqtt/aggregator.go`: `evalRules` publishes `incidents[i].Message(now)` with `PublishQoS1Absolute`, and records `incidents[i].Rule` in the status page firing. A `time.Ticker` event in the aggregator loop calls `evalRules(now)`.
- The CI step `Schema parity really ran` and the vendored `testdata/` are removed.

### What must not change

- The MCAP writer keeps its own input. It logs the report as it arrived, or the raw frame. The slot array never reaches it, so a `nil` written for an offline device or an absent field does not enter the log.
- The timer that calls `Eval` without new data must not write to MCAP. A log row means a poll happened.

## Acceptance Criteria

- `go build ./...` with no `internal/rules` and no `internal/rulesxml`.
- The aggregator tests pass with the module types.
- The replay test of SWREQ-017 matches the golden file.
- `examples/rules.xml` loads with zero problems.

- A test drives one poll cycle and one timer tick, and checks that MCAP received one message, not two.
- A test takes a device offline and checks that the MCAP message of the last real report is unchanged.

## Verification Plan

- **Method**: test.
- **Procedure**: The service test suite and the replay test.

## Notes

The rules file stays at `/svc/rules.xml`, and an absent file still disables rules with one warning.
