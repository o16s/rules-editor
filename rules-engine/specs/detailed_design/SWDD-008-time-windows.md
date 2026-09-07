---
id: "SWDD-008"
type: software_detailed_design
name: "Time windows: bucket rings and last-change times"
description: >
  Each STALE, RATE or AVG node owns a ring of 64 buckets. The engine updates
  the rings on every Eval before the rules.
satisfies:
  - "SWREQ-010"
---

# Software Implementation: Time windows: bucket rings and last-change times

## Overview

A ring is fixed memory for one slot and one window. `Load` collects the
distinct pairs of slot and window over all rules, at most 256, and
`NewEngine` allocates one ring per pair. Nothing grows after that.

## Static View (Structure)

```go
type bucket struct { start time.Time; first, last, sum float64; count int32 }
type ring struct {
    slot   int
    window time.Duration
    width  time.Duration   // max(window / 64, Period)
    n      int             // buckets in use: window / width, at most 64
    b      [64]bucket
    head   int             // bucket of the newest sample
}
```

`Engine.lastChange []time.Time` has one entry per slot.

## Dynamic View (Logic)

On each `Eval`, before the rules: for each ring, compute the bucket index of
`now`. Advance `head` and clear the buckets between the old head and the new
one, bounded by 64. If the slot changed in this call and is numeric, add the
value to the head bucket. Then:

- `STALE(x, d)`: `Slots[x] == nil || now.Sub(lastChange[x]) >= d`.
- `RATE(x, w)`: find the oldest non-empty bucket in the window and the newest. `(newest.last - oldest.first) / w.Hours()`. With fewer than two samples, `0`. The divisor is the nominal window, so a ramp reads short by up to one bucket, which is one part in 64.
- `AVG(x, w)`: `sum(sum) / sum(count)` over non-empty buckets. `Unknown` when the count is 0.

Time rules evaluate on every call, so a ring that only expires still moves
the result.

## Interface & API Definitions

Internal to the `rules` package. The `formula.Env` exposes `Windows []ring`
with three methods: `Stale`, `Rate`, `Avg`.

## Error Handling & Edge Cases

- A clock that moves backwards clears the ring, resets `lastChange` to `now`, and increments `Stats.ClockStepsBack`.
- A window shorter than 64 periods uses fewer buckets. `Catalog.Period` of zero with a time function is a `Load` problem.
- A `Reset` clears every ring.

## Notes

ADR-005 gives the meaning of `STALE`.
