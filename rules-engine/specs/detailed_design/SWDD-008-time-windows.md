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

A ring is fixed memory for one slot and one window. `NewEngine` allocates
one per `windowSpec` and never grows it.

## Static View (Structure)

```go
type bucket struct { start time.Time; first, last, sum float64; count int32 }
type ring struct {
    slot   int
    window time.Duration
    width  time.Duration   // window / 64
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
- `RATE(x, w)`: find the oldest non-empty bucket in the window and the newest. `(newest.last - oldest.first) / w.Hours()`. With one or zero non-empty buckets, `0`.
- `AVG(x, w)`: `sum(sum) / sum(count)` over non-empty buckets. `Unknown` when the count is 0.

Time rules evaluate on every call, so a ring that only expires still moves
the result.

## Interface & API Definitions

Internal to the `rules` package. The `formula.Env` exposes `Windows []ring`
with three methods: `Stale`, `Rate`, `Avg`.

## Error Handling & Edge Cases

- A clock that moves backwards clears the ring and resets `lastChange` to `now`.
- A window shorter than 64 periods loses resolution. `NewEngine` logs it once.
- A `Reset` clears every ring.

## Notes

ADR-005 gives the meaning of `STALE`.
