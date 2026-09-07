---
id: "ADR-016"
type: architecture_decision_record
name: "Fire rules in document order within one evaluation"
description: >
  When several rules fire in one Eval call, their actions and incidents follow
  the order of the rules in the file.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-003"
---

# Architecture Decision: Fire rules in document order within one evaluation

## Context and problem statement

Today the engines evaluate the rules of the first changed slot, then the
rules of the second changed slot. The order of the actions of two rules in
one call depends on the slot order, which the operator does not see.

## Key factors

- An operator reads the file top to bottom and expects that order.
- A stable order makes the replay tests deterministic.

## Considered options

- Document order: collect the rules to evaluate, then evaluate them in rule index order.
- Keep the slot order.

## Decision Outcome

Chosen option: "Document order". The cost is one pass over a dirty set of at most 1000 rules per call.

### Positive Consequences

- The order of firings is visible in the file.
- The golden replay files are stable.

### Negative Consequences

- A small behavior change, listed in SWREQ-017.

## Pros and Cons of the Options

### Document order

- Good, because it is what the operator expects.
- Bad, because it costs one bounded loop.

### Slot order

- Good, because it is the current code.
- Bad, because it is not visible to the operator.

## Links

- SYSREQ-013, SWREQ-003, SWDD-003.
