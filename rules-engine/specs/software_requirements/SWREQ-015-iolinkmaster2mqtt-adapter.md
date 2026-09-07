---
id: "SWREQ-015"
type: software_requirement
name: "iolinkmaster2mqtt adapter"
description: >
  iolinkmaster2mqtt adopts the module, gains structural validation, and clears
  the slots of an offline port.
specification: >
  iolinkmaster2mqtt must build a `Catalog` from `driver.DiscoverFieldTypes`,
  call `rules.Load`, and log every problem. It must call `Eval` once per poll
  cycle, and set the slots of an offline port to `nil`. It must publish
  through `Incident.Message`, and delete `internal/rules`.
derives_from:
  - "SYSARCH-002"
depends_on:
  - "SWREQ-002"
  - "SWREQ-005"
---

# Software Requirement: iolinkmaster2mqtt adapter

## Requirement Specification

> iolinkmaster2mqtt must build a `Catalog` from `driver.DiscoverFieldTypes`, call `rules.Load`, and log every problem. It must call `Eval` once per poll cycle, and set the slots of an offline port to `nil`. It must publish through `Incident.Message`, and delete `internal/rules`.

## Rationale

The service gains the validator and the `CHANGED` fix, and aligns its offline
behavior with modbus2mqtt (ADR-010).

## Logic & Interface Details

- `cmd/iolinkmaster2mqtt/main.go`: `loadRules` builds `Fields` per sensor in the configuration order from `portFieldTypes`, `Sources` from the sensor names, `TopicPrefix` from the configuration, `Period` from `poll_interval_ms`. It calls `rules.Load` and logs every problem before `os.Exit(1)`.
- `poll()` writes the decoded fields into the slots, then calls `Eval(ruleValues, now)` once per cycle. The cycle is the timer.
- `portMiss`, when it takes a port offline, writes `nil` into the slots of that port. `poll()` then evaluates as usual.
- Incidents publish as `incidents[i].Message(now)` with `PublishQoS1Absolute`.

## Acceptance Criteria

- `go build ./...` with no `internal/rules`.
- A test of `portMiss` past the threshold shows `nil` slots and a resolve on the next `Eval`.
- The replay test of SWREQ-017 matches the golden file, except for the documented offline case.

## Verification Plan

- **Method**: test.
- **Procedure**: The service test suite, an offline test, and the replay test.

## Notes

The behavior change on offline devices is listed in the release notes of the service.
