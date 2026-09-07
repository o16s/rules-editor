---
id: "SYSREQ-008"
type: system_requirement
name: "Runtime resource bounds"
description: >
  After startup the engine allocates no memory in Eval, every loop has a fixed
  bound, and time windows use fixed memory.
specification: >
  After `NewEngine` returns, `Eval` must allocate no heap memory on a call
  that fires no Then formula. Every loop in the engine must have a fixed upper
  bound. The memory of time windows must be fixed at startup.
derives_from:
  - "SCEN-004"
  - "SCEN-009"
---

# System Requirement: Runtime resource bounds

## Requirement Specification

> After `NewEngine` returns, `Eval` must allocate no heap memory on a call that fires no Then formula. Every loop in the engine must have a fixed upper bound. The memory of time windows must be fixed at startup.

## Rationale

tsend2mqtt evaluates at 100 Hz on an ARM Cortex-A53. The Power of Ten rules
of the three services forbid allocation after initialization.

## Acceptance Criteria

- A benchmark of `Eval` with the example rules and no firing reports 0 allocs/op.
- A firing with literal Then fields reports 0 allocs/op.
- A firing with a formula Then field writes into a preallocated buffer of the rule.
- Every `for` loop has a constant or a slice length as its bound, and a comment names the bound where it is not obvious.
- The memory of one time window is 64 buckets, independent of the poll rate.

## Verification Plan

- **Method**: test and inspection.
- **Procedure**: `go test -bench Eval -benchmem` in CI, with a threshold of 0 allocs/op. A review checklist for loop bounds.

## Notes

`Incident.Message` allocates. The publisher calls it, not the engine.
