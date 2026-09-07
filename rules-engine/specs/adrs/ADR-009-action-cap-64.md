---
id: "ADR-009"
type: architecture_decision_record
name: "Cap the actions of one rule at 64 in the XSD, the editor and the engine"
description: >
  The XSD gets maxOccurs 64 on publish, model.ts gets LIMITS.maxActions, and
  the engine bounds its loop with the same value.
status: proposed
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-001"
  - "SWDD-003"
---

# Architecture Decision: Cap the actions of one rule at 64 in the XSD, the editor and the engine

## Context and problem statement

tsend2mqtt caps actions at 16. The other engines have no cap. The XSD says unbounded. The Power of Ten rules need a fixed loop bound.

## Key factors

- The three layers must agree.
- The largest deployed rule has 5 actions.

## Considered options

- 64 in all three layers.
- Keep 16 as in tsend2mqtt.
- Unbounded in the XSD, bounded only by the rule count in the engine.

## Decision Outcome

Chosen option: "64 in all three layers". It is far more than every deployed rule needs, and it gives the engine a constant bound.

### Positive Consequences

- One number in the XSD, in `model.ts` and in Go, with a test that compares them.

### Negative Consequences

- A schema change, and a new fixture pair at the limit.

## Pros and Cons of the Options

### 64

- Good, because it is generous and constant.

### 16

- Bad, because a fan-out to many cameras and commands can exceed it.

### Unbounded

- Bad, because the engine loop has no constant bound.

## Links

- PLAN.md, decision 7.
