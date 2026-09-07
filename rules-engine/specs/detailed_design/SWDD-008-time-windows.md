---
id: "SWDD-008"
type: software_detailed_design
name: "Time windows: bucket rings, smoothed values and last-change times"
description: >
  Each window node owns a ring of 64 buckets, each EWMA node owns one number,
  and the engine advances both on every Eval before the rules run.
satisfies:
  - "SWREQ-010"
---

# Software Implementation: Time windows: bucket rings, smoothed values and last-change times

## Overview

A ring is fixed memory for one slot and one window. `Load` collects the
distinct pairs of slot and window over all rules, at most 256, and `NewEngine`
allocates one ring per pair. A smoothed value is one number for one pair of a
slot and a time constant, at most 256 of those. Nothing grows after that.

The engine and the editor's simulator share one implementation of this, the
`history` type, so the two cannot advance the past differently.

## Static View (Structure)

```go
type bucket struct {
    start                        time.Time
    first, last, sum, sumSq      float64
    min, max                     float64
    count                        int32
}

type Window struct {
    slot   int
    window time.Duration
    width  time.Duration // max(window/64, Catalog.Period)
    n      int           // buckets in use, at most 64
    head   int
    b      [64]bucket
}

type Ewma struct {
    slot  int
    tau   time.Duration
    value float64
    last  time.Time
    set   bool
}

// history is what the engine remembers between two evaluations. The engine
// owns one; so does rules.SimResolver, which the Simulator page compiles
// against.
type history struct {
    lastChange    []time.Time
    prevValues    []any
    windows       []*formula.Window
    windowsBySlot [][]int
    ewmas         []*formula.Ewma
    ewmasBySlot   [][]int
    changed       []bool
}
```

A bucket carries enough to answer every window function without keeping the
readings, so the memory of a window does not depend on the poll rate. It is
about 5 KB, and 256 of them are about 1.3 MB.

## Dynamic View (Logic)

`history.advance(values, now)`, once per `Eval`, before any rule runs:

1. Move every ring to `now`. A bucket that left the window is cleared. A clock that moved backwards resets the ring.
2. For each slot, in order:
   - a reading the engine cannot read counts as unsupported and is skipped;
   - the reading is recorded in every window that follows the slot, and folded into every smoothed value that follows it, **whether or not it moved** (ADR-022);
   - if it moved, `lastChange` is set and the slot is marked changed.

The windows and the smoothed values are indexed by slot, so a slot that carries
neither costs one length check. Without that index the cost would be the
product of slots and windows on every call.

`history.keep(values)` copies the readings after the rules have run, so the
next call can tell what moved.

Reading a window:

- `Rate` = `(newest.last - oldest.first) / hours(newest.start - oldest.start)`. The span is the time between the two readings used, not the width of the window (ADR-022), so a window that is not yet full reports the rate of what it holds. Readings in one bucket give no span.
- `Avg`, `Count`, `Min`, `Max`, `StdDev` and `ZScore` fold the buckets. `Delta` reads the first of the oldest and the last of the newest.
- `Slope` fits a least-squares line through one point per filled bucket, at the middle of the bucket, weighted by the readings in it. The loop is bounded by the 64 buckets.
- `Forecast` is the current reading plus the slope times the horizon.

`Ewma.Add` weights a reading by the time since the one before it:
`alpha = 1 - exp(-dt / tau)`. The first reading becomes the average itself.

## Interface & API Definitions

`formula.Window` and `formula.Ewma` are exported so the compiler can name
them. `rules.SimResolver` exposes `Env`, `Advance` and `Stack` for the
Simulator page, and adds no behavior of its own.

## Error Handling & Edge Cases

- A window with no reading answers `Unknown` for everything except `Count`, which answers 0.
- `ZScore` against a window with no spread is `Unknown`, not an infinity.
- `Reset` clears every ring and every smoothed value: a reconnect cannot vouch for what happened while it was not reading.
- A window shorter than 64 periods gets fewer buckets. Nothing is logged.

## Notes

ADR-022 records the window model and the denominator of `RATE`.
