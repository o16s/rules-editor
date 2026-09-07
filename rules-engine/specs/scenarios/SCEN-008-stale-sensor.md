---
id: "SCEN-008"
type: scenario
name: "Stale sensor raises an incident"
description: >
  A sensor value stops updating. After the configured duration a STALE() rule
  raises an incident without new data.
refines:
  - "UC-004"
  - "UC-002"
---

# Scenario: Stale sensor raises an incident

## Overview

This path shows a time function. The rule becomes true without any change
of a slot, so the engine must evaluate it on a timer.

## Initial State

- The rule `ph-stale` has an incident and the condition `STALE(TAG("pool1", "ph"), 10min)`.
- `pool1.ph` updated 1 min ago. The service calls `Eval` every second.

## Trigger

The device `pool1` goes offline. The service writes `nil` into its slots.

## Step-by-Step Flow

1. [Reaction]: The engine records the time of the last change of the slot.
2. [Reaction]: On each tick, the engine evaluates the rule because it uses a time function.
3. [Reaction]: For 10 min the result is false.
4. [Reaction]: At 10 min after the last change, the result becomes true. The rule triggers an incident.
5. [Action]: The device answers again with a new value.
6. [Reaction]: The slot changes. `STALE` becomes false. The incident resolves.

## Expected Outcome

- [Success Condition]: The incident triggers 10 min after the last update, with a tolerance of one tick.
- [Verification]: An `Eval` test with a fixed clock that advances in steps of one second.

## Exceptions & Edge Cases

- [Constant value]: A device that answers with the same value counts as no update (ADR-005).
- [No tick]: A service that calls `Eval` only on data never sees the rule become true. Each adapter must add a timer.
