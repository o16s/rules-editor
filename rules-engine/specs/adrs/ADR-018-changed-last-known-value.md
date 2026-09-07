---
id: "ADR-018"
type: architecture_decision_record
name: "CHANGED compares with the last known value"
description: >
  CHANGED is true when a known value differs from the last known value. The
  first value of a slot and a transition to or from nil are not changes.
status: proposed
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-007"
  - "SWDD-003"
---

# Architecture Decision: CHANGED compares with the last known value

## Context and problem statement

`CHANGED(x)` must say when `x` changed. Three moments are unclear. The first is
the first value after startup. The second is the transition to `nil` when a
device goes offline. The third is the return of a value after `nil`. tsend2mqtt skips its first frame, so a
`changed` rule does not fire at startup. The polling engines compare with a
`nil` previous value, so a `changed` rule fires on the first poll. A camera
that records on every service restart is a defect.

## Key factors

- A `CHANGED` rule with camera actions must not fire on a restart.
- A device that returns with the same value did not change.
- A device that returns with a new value did change, and the operator wants to know.

## Considered options

- Compare with the last known value. The first value and `nil` transitions are not changes.
- Compare with the previous slot value, `nil` included. The first value and every `nil` transition are changes.
- Compare with the previous slot value, but skip the first value only.

## Decision Outcome

Chosen option: "Compare with the last known value". It matches tsend2mqtt at startup, it is silent on an offline transition, and it reports a value that moved while the device was away.

### Positive Consequences

- No firing on a restart.
- One rule for the three unclear moments.

### Negative Consequences

- The engine keeps one last-known value per `CHANGED` node and per slot. The memory is fixed at `NewEngine`.
- The polling services change behavior: no firing on the first poll.

## Pros and Cons of the Options

### Last known value

- Good, because it is what an operator means by "changed".
- Bad, because a value that moved and moved back while the device was away is not reported.

### Previous slot value, `nil` included

- Good, because it is the current code of two services.
- Bad, because every restart and every offline transition fires.

### Skip the first value only

- Good, because it stops the restart firing.
- Bad, because an offline transition still fires twice.

## Links

- SWREQ-009, SYSREQ-011, SWDD-007, SWREQ-017.
