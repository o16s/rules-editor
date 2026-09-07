---
id: "ADR-010"
type: architecture_decision_record
name: "Every multi-device service clears the slots of an offline device"
description: >
  iolinkmaster2mqtt adopts the modbus2mqtt behavior: after the offline
  threshold, the slots of the device become nil.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SYSARCH-002"
  - "SWDD-013"
---

# Architecture Decision: Every multi-device service clears the slots of an offline device

## Context and problem statement

modbus2mqtt sets the values of an offline device to `nil`. iolinkmaster2mqtt keeps the last value. The shared engine treats `nil` as unknown. Do both services behave the same?

## Key factors

- A latched value holds an incident on a silent device.
- `STALE` depends on `nil` for the offline case.

## Considered options

- Both services clear to `nil` after the offline threshold.
- Keep the iolinkmaster2mqtt behavior.

## Decision Outcome

Chosen option: "Both services clear to `nil`", because an incident on a silent device is wrong and `STALE` needs the signal.

### Positive Consequences

- One documented meaning of offline for rules.

### Negative Consequences

- iolinkmaster2mqtt changes behavior: an incident on a device that goes offline now resolves.

## Pros and Cons of the Options

### Clear to `nil`

- Good, because the rules see the truth.
- Bad, because a short outage resolves and re-triggers an incident.

### Keep the last value

- Bad, because an incident can stay open on a dead sensor for hours.

## Links

- PLAN.md, decision 9.
