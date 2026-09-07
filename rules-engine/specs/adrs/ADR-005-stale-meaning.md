---
id: "ADR-005"
type: architecture_decision_record
name: "STALE means no change for the duration, or an unknown value"
description: >
  STALE(x, d) is true when the slot is nil or did not change for d. A constant
  value counts as no update.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-008"
---

# Architecture Decision: STALE means no change for the duration, or an unknown value

## Context and problem statement

The editor documents `STALE(x, 4h)` as "true when x did not update within the duration". The engine sees values, not updates. A device that answers with a constant value looks the same as a device that stopped.

## Key factors

- The slot model has no update event.
- The polling services set slots to `nil` when a device is offline.
- A per-slot freshness signal is a larger API change.

## Considered options

- The time after the last change, or `nil`.
- An `Eval` variant that takes the slots the service refreshed this cycle.
- A per-slot timestamp array next to the value array.

## Decision Outcome

Chosen option: "The time after the last change, or `nil`". It needs no API change and covers the offline case through SYSREQ-011.

### Positive Consequences

- `STALE` works on every service with the same `Eval` call.

### Negative Consequences

- A constant value counts as stale after the duration. The README documents this.

## Pros and Cons of the Options

### Time after the last change, or `nil`

- Good, because it is simple and testable.
- Bad, because a constant is stale.

### Refreshed-slots parameter

- Good, because it is exact.
- Bad, because every adapter must track freshness per field.

### Timestamp array

- Good, because it is exact.
- Bad, because it doubles the slot bookkeeping in every service.

## Links

- PLAN.md, decision 5.
