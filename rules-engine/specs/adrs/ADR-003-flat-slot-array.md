---
id: "ADR-003"
type: architecture_decision_record
name: "A flat slot array is the value model, owned by the service"
description: >
  The engine reads a []any slot array that the service fills. It does not
  decode frames or know devices.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SYSARCH-002"
  - "SWDD-003"
---

# Architecture Decision: A flat slot array is the value model, owned by the service

## Context and problem statement

tsend2mqtt decodes fields from a raw frame inside the engine. The polling services fill a `[]any`. Which value model does the shared engine use?

## Key factors

- The engine must not depend on a service package.
- Change detection must be cheap at 100 Hz.
- A device offline must be expressible.

## Considered options

- A `[]any` slot array, one slot per catalog field, filled by the service.
- A `Source` interface with `Value(i int) any`, so tsend2mqtt decodes on demand.
- Typed slot arrays per type.

## Decision Outcome

Chosen option: "A `[]any` slot array", because two of three services use it today and it keeps the engine free of decode code.

### Positive Consequences

- One `Eval` signature for all services.
- `nil` expresses an unknown value.

### Negative Consequences

- tsend2mqtt must decode changed fields into slots, and all fields once on the first frame.
- An interface value per slot costs one allocation when a float is boxed. The services box today and the cost is accepted.

## Pros and Cons of the Options

### `[]any` slots

- Good, because it is the current model of two services.
- Bad, because equality on `any` needs a type switch (SWDD-003).

### `Source` interface

- Good, because tsend2mqtt decodes on demand.
- Bad, because every leaf pays an interface call and change detection moves back to the service.

### Typed arrays

- Good, because there is no boxing.
- Bad, because the catalog needs a slot per type and the code grows.

## Links

- PLAN.md, section 4.3.
