---
id: "SWREQ-010"
type: software_requirement
name: "Time functions with bounded memory"
description: >
  The time functions work on per-slot history that the engine sizes at
  NewEngine and never grows.
specification: >
  Every time function must compute over history that `NewEngine` allocates
  once, sized by the windows and the smoothed values the rules name. A rule
  that uses one must evaluate on every `Eval` call.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-009"
---

# Software Requirement: Time functions with bounded memory

## Requirement Specification

> Every time function must compute over history that `NewEngine` allocates once, sized by the windows and the smoothed values the rules name. A rule that uses one must evaluate on every `Eval` call.

## Rationale

SYSREQ-008 and SYSREQ-010 at the level of the functions.

## Logic & Interface Details

### What a window holds

A window records **one reading per evaluation**, not one per change (ADR-022).
A mean over ten minutes is then the mean of the readings, which is what an
operator asks for.

A ring has at most 64 buckets. The bucket width is the larger of `w / 64` and
`Catalog.Period`. A bucket holds the count, the sum, the sum of squares, the
first, the last, the smallest, the largest, and the bucket start time. That is
enough for every function below, so the memory of a window does not depend on
the poll rate: about 5 KB, whatever the rate.

One ring serves every node with the same slot and the same window. `Load`
reports a problem when the rules need more than 256 rings, or more than 256
smoothed values.

### The functions

| Function | Meaning | State |
|---|---|---|
| `STALE(x, d)` | true when the slot of `x` is unset, or when `now - lastChange(x) >= d`. Without a duration, `d` is 4h, as the signature shows | `lastChange` per slot |
| `SINCE(x)` | seconds since `x` last changed. Unknown before the first reading | the same |
| `PREV(x)` | the value `x` held before its last change | two memories per node |
| `RATE(x, w)` | the change per hour between the oldest and the newest reading in the window, divided by the time those two are apart (ADR-022) | one ring |
| `AVG(x, w)` | the mean of the readings | the same ring |
| `MIN(x, w)`, `MAX(x, w)` | the smallest and the largest reading | the same ring |
| `COUNT(x, w)` | how many readings the window holds | the same ring |
| `DELTA(x, w)` | the newest reading minus the oldest | the same ring |
| `STDDEV(x, w)` | the standard deviation of the readings, over the whole window | the same ring |
| `ZSCORE(x, w)` | `(current - mean) / deviation` | the same ring |
| `SLOPE(x, w)` | the least-squares trend per hour, fitted through one point per bucket, weighted by the readings in it | the same ring |
| `FORECAST(x, w, h)` | `current + slope * hours(h)` | the same ring |
| `EWMA(x, tau)` | an exponentially weighted mean, weighted by the time between readings: `alpha = 1 - exp(-dt / tau)` | one number per (slot, tau) |

- Every one of them answers `Unknown`, never zero, when there is nothing to answer from. `COUNT` is the exception, because no readings is a number an operator can compare against.
- `RATE` and `DELTA` need readings in two buckets. `STDDEV` and `ZSCORE` need two readings. `SLOPE` and `FORECAST` need two filled buckets. `ZSCORE` is unknown when the window has no spread, rather than an infinity.
- `x` must be a `TAG` or a variable that is a `TAG`. An expression is a compile problem.
- When `Catalog.Period` is zero, a rule with a time function is a `Load` problem.
- Readings that are not numbers are not recorded.

## Acceptance Criteria

- `STALE` flips within one `Period` after `d`, with a fixed clock that advances in steps. `STALE(x)` without a duration flips after 4h.
- `RATE` over a linear ramp matches the slope within one bucket, for a window that is full and for one that is not. A window whose readings share one bucket is unknown.
- `AVG` over a constant equals the constant. `AVG` over nine readings of 10 and one of 100 is 19, not 55.
- `MIN`, `MAX`, `COUNT` and `DELTA` match the readings by hand.
- `STDDEV` of 2, 4, 4, 4, 5, 5, 7, 9 is 2. `ZSCORE` of 9 against it is 2.
- `SLOPE` over a flat series that ends in a spike is nearer zero than `RATE` over the same series.
- `EWMA` covers about 63 percent of a step after one time constant, and more than 99 percent after six. A short step moves it less than a long one.
- Memory does not grow across 10^6 calls (a test with `runtime.MemStats`).

## Verification Plan

- **Method**: test.
- **Procedure**: Unit tests with a fixed clock in `formula/stats_test.go` and `formula/valuefn_test.go`. A long-run test that compares `HeapAlloc` before and after.

## Notes

`STALE` on a constant value is stale after `d` (ADR-005). The window model and
the denominator of `RATE` are ADR-022.
