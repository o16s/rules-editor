---
id: "ADR-002"
type: architecture_decision_record
name: "Seed the module from modbus2mqtt and merge the tsend2mqtt fixes"
description: >
  The modbus2mqtt packages internal/rules and internal/rulesxml are the
  starting code. Two fixes come from tsend2mqtt.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SYSARCH-001"
---

# Architecture Decision: Seed the module from modbus2mqtt and merge the tsend2mqtt fixes

## Context and problem statement

Three engines exist. Which code is the starting point of the shared module?

## Key factors

- modbus2mqtt has the newest code and the only structural validator.
- tsend2mqtt has two fixes the others lack: `Reset()` and the `CHANGED` re-arm.
- iolinkmaster2mqtt and modbus2mqtt have the same `rules` package.

## Considered options

- Start from modbus2mqtt and merge the tsend2mqtt fixes.
- Start from tsend2mqtt and add slots and validation.
- Write the module from scratch.

## Decision Outcome

Chosen option: "Start from modbus2mqtt and merge the tsend2mqtt fixes". It keeps the most tests and the validator. The two fixes are small and well tested.

### Positive Consequences

- The `rulesxml` validator and its parity test move without a rewrite.
- The union of the three test suites is the target suite.

### Negative Consequences

- tsend2mqtt changes the most. Its engine decodes the frame today.

## Pros and Cons of the Options

### Start from modbus2mqtt

- Good, because it has slots, a clock parameter, `incidentActive` and the validator.
- Bad, because it has the `CHANGED` regression.

### Start from tsend2mqtt

- Good, because it has `Reset` and the re-arm.
- Bad, because it depends on `udt` and `decode`, and calls `time.Now()` inside `Eval`.

### From scratch

- Bad, because it loses 2,400 lines of tests.

## Links

- PLAN.md, section 2.
