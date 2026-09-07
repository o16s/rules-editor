---
id: "ADR-004"
type: architecture_decision_record
name: "Keep the shared cooldown timer that consumes a rising edge"
description: >
  Actions and the incident trigger share one cooldown timer. A rising edge
  inside the cooldown does not fire later.
status: proposed
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-003"
---

# Architecture Decision: Keep the shared cooldown timer that consumes a rising edge

## Context and problem statement

All three engines share one `lastFired` timer between actions and the incident trigger. A rising edge inside the cooldown is consumed. Operators work around this with two rules. Do we change the behavior in the shared engine?

## Key factors

- Deployed rules depend on the behavior and its workaround.
- The migration must not change the output of the replay tests.

## Considered options

- Keep the behavior in v0.3 and document it.
- Fire when the cooldown expires if the condition is still true.
- Separate timers for actions and incidents.

## Decision Outcome

Chosen option: "Keep the behavior in v0.3 and document it", because the migration must be behavior-preserving. A change is a product decision for a later version.

### Positive Consequences

- The golden replay tests pass without changes.

### Negative Consequences

- The pitfall and the two-rule workaround stay in the documentation.

## Pros and Cons of the Options

### Keep

- Good, because no deployed rule changes behavior.
- Bad, because the pitfall stays.

### Fire on expiry

- Good, because a reset action always happens.
- Bad, because a rule with `edge="rising"` fires without an edge, which changes its meaning.

### Two timers

- Good, because an incident and its action throttle independently.
- Bad, because a new attribute is needed in the schema.

## Links

- PLAN.md, finding 11 and decision 4.
