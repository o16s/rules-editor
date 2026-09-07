---
id: "SWREQ-010"
type: software_requirement
name: "Time functions with bounded memory"
description: >
  STALE, RATE and AVG work on per-slot history that the engine sizes at
  NewEngine and never grows.
specification: >
  `STALE`, `RATE` and `AVG` must compute over history that `NewEngine`
  allocates once, sized by the windows in the rules. A rule that uses one of
  them must evaluate on every `Eval` call.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-009"
---

# Software Requirement: Time functions with bounded memory

## Requirement Specification

> `STALE`, `RATE` and `AVG` must compute over history that `NewEngine` allocates once, sized by the windows in the rules. A rule that uses one of them must evaluate on every `Eval` call.

## Rationale

SYSREQ-008 and SYSREQ-010 at the level of the functions.

## Logic & Interface Details

| Function | Meaning | State |
|---|---|---|
| `STALE(x, d)` | true when the slot of `x` is `nil`, or when `now - lastChange(x) >= d` | `lastChange` per slot, set when `equalValue` reports a change |
| `RATE(x, w)` | `(last - first) / hours(w)` over the samples in the window. `0` with fewer than two samples | one bucket ring per (slot, window) |
| `AVG(x, w)` | `sum / count` over the samples in the window. `Unknown` with no sample | the same ring |

- A ring has 64 buckets of width `w / 64`. A bucket holds `first`, `last`, `sum`, `count` and the bucket start time.
- On each `Eval`, the engine updates every ring. If the slot changed, it writes the value into the bucket of `now`. It expires the buckets older than `w`.
- `x` must be a `TAG` or a variable that is a `TAG`. An expression is a compile problem.
- `nil` samples are not recorded.
- `Catalog.Period` must be at most `w / 64` for full resolution. A larger period is accepted and logged once.

## Acceptance Criteria

- `STALE` flips within one `Period` after `d`, with a fixed clock that advances in steps.
- `RATE` over a linear ramp matches the slope within 1 percent.
- `AVG` over a constant equals the constant. `AVG` over a square wave equals its mean within one bucket of error.
- Memory does not grow across 10^6 calls (a test with `runtime.MemStats`).

## Verification Plan

- **Method**: test.
- **Procedure**: Unit tests with a fixed clock. A long-run test that compares `HeapAlloc` before and after.

## Notes

`STALE` on a constant value is stale after `d` (ADR-005).
