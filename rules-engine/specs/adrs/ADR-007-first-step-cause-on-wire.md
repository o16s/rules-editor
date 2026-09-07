---
id: "ADR-007"
type: architecture_decision_record
name: "Add first_step and cause to the incident trigger as optional fields"
description: >
  The trigger message gains first_step and cause when the rule sets them. The
  resolve does not carry them.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-004"
---

# Architecture Decision: Add first_step and cause to the incident trigger as optional fields

## Context and problem statement

Schema 0.3 adds `first_step` and `cause` to `<incident>`. The events protocol has no field for them. Do they reach the forwarder?

## Key factors

- The forwarder ignores unknown fields.
- On-call staff benefit from the first step in the page.

## Considered options

- Add `first_step` and `cause` to the trigger, `omitempty`.
- Put them into `data`.
- Do not send them.

## Decision Outcome

Chosen option: "Add them to the trigger, `omitempty`", because it is additive and the forwarder can show them when it learns them.

### Positive Consequences

- The operator text reaches the page.

### Negative Consequences

- `tsend2mqtt/docs/events-protocol.md` and the forwarder need an update.

## Pros and Cons of the Options

### Top-level fields

- Good, because they are first-class in the protocol.
- Bad, because the protocol document changes.

### Inside `data`

- Good, because the protocol does not change.
- Bad, because `data` is free-form and dashboards do not show it.

### Do not send

- Bad, because the operator wrote the text for the page.

## Links

- PLAN.md, decision 3.
