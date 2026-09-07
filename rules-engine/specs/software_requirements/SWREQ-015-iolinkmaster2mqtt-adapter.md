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
- `poll()` writes the decoded fields of each port into the slots, and `nil` into every other slot of that port. Then it calls `Eval(ruleValues, now)` once per cycle. The cycle is the timer.
- `portMiss`, when it takes a port offline, writes `nil` into the slots of that port. `poll()` then evaluates as usual.
- Incidents publish as `incidents[i].Message(now)` with `PublishQoS1Absolute`.

### What must not change

- The MCAP writer keeps its own input. It logs the report as it arrived, or the raw frame. The slot array never reaches it, so a `nil` written for an offline device or an absent field does not enter the log.
- The timer that calls `Eval` without new data must not write to MCAP. A log row means a poll happened.

## Acceptance Criteria

- `go build ./...` with no `internal/rules`.
- A test of `portMiss` past the threshold shows `nil` slots and a resolve on the next `Eval`.
- The replay test of SWREQ-017 matches the golden file, except for the documented offline case.

- A test drives one poll cycle and one timer tick, and checks that MCAP received one message, not two.
- A test takes a device offline and checks that the MCAP message of the last real report is unchanged.

## Verification Plan

- **Method**: test.
- **Procedure**: The service test suite, an offline test, and the replay test.

## Notes

The behavior change on offline devices is listed in the release notes of the service.
