---
id: "SYSREQ-010"
type: system_requirement
name: "Time-dependent rules evaluate without new data"
description: >
  A rule that uses a time function is evaluated on every Eval call, and each
  service calls Eval on a timer.
specification: >
  The engine must evaluate a rule that uses `STALE`, `RATE` or `AVG` on every
  `Eval` call. Each service must call `Eval` at least once per
  `Catalog.Period` without new data.
derives_from:
  - "SCEN-008"
depends_on:
  - "SYSREQ-005"
---

# System Requirement: Time-dependent rules evaluate without new data

## Requirement Specification

> The engine must evaluate a rule that uses `STALE`, `RATE` or `AVG` on every `Eval` call. Each service must call `Eval` at least once per `Catalog.Period` without new data.

## Rationale

`STALE` becomes true when nothing arrives. A rule that waits for a slot
change never fires.

## Acceptance Criteria

- With no slot change, a `STALE(x, 10min)` rule triggers within one period after the 10 min.
- A rule without a time function is not evaluated on a tick without a slot change.
- Each service has a timer that calls `Eval` with the current time.

## Verification Plan

- **Method**: test.
- **Procedure**: An `Eval` test with a fixed clock and no value change. An adapter test per service that advances the timer.

## Notes

The engine is not safe for concurrent use. The timer must operate on the
goroutine that owns the slots, or under the same mutex.
