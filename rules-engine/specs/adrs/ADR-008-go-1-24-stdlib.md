---
id: "ADR-008"
type: architecture_decision_record
name: "Go 1.24 as the floor and the standard library only"
description: >
  The module declares go 1.24 and has no dependency. Services on 1.25 can
  require it.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-011"
---

# Architecture Decision: Go 1.24 as the floor and the standard library only

## Context and problem statement

tsend2mqtt is on Go 1.24.3, the other services on 1.25. Which Go version does the module require, and which dependencies?

## Key factors

- A module with a higher `go` directive than a consumer forces a toolchain change.
- The gateway binaries are static and reviewed for supply-chain risk.

## Considered options

- `go 1.24`, no dependencies.
- `go 1.25`, and tsend2mqtt updates its toolchain.

## Decision Outcome

Chosen option: "`go 1.24`, no dependencies", because the engine needs nothing from 1.25 and a toolchain change in tsend2mqtt is a separate task.

### Positive Consequences

- All three services adopt the module without a toolchain change.

### Negative Consequences

- The module cannot use 1.25 features until tsend2mqtt updates.

## Pros and Cons of the Options

### 1.24

- Good, because it works for all three.

### 1.25

- Good, because it is current.
- Bad, because it blocks tsend2mqtt.

## Links

- PLAN.md, decision 6.
