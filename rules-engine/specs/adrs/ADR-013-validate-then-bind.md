---
id: "ADR-013"
type: architecture_decision_record
name: "Validate the structure before binding, and report every problem"
description: >
  Load runs rulesxml.Validate first and returns all problems. Only a
  structurally sound file is bound.
status: proposed
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-002"
---

# Architecture Decision: Validate the structure before binding, and report every problem

## Context and problem statement

`encoding/xml` unmarshal is permissive. It drops unknown attributes and stops at the first error it notices. How does `Load` report faults?

## Key factors

- An operator needs the whole list in one restart.
- The binder needs a sound tree to give good messages.

## Considered options

- Validate the structure first with `rulesxml`, then bind. Return the union of problems.
- Bind only, and improve its messages.

## Decision Outcome

Chosen option: "Validate first, then bind", because the validator already reports every fault with a path, and the binder can then assume a sound tree.

### Positive Consequences

- One list of problems with paths for structure and binding.

### Negative Consequences

- Two passes over the document at startup. Startup is not the hot path.

## Pros and Cons of the Options

### Validate then bind

- Good, because it is the modbus2mqtt behavior with a test suite.

### Bind only

- Bad, because unmarshal drops what it does not know.

## Links

- PLAN.md, section 4.4.
