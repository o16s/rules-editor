---
id: "SCEN-005"
type: scenario
name: "Device goes offline and its incident resolves"
description: >
  A Modbus device stops answering. The service clears its values and the
  incident on that device resolves.
refines:
  - "UC-002"
---

# Scenario: Device goes offline and its incident resolves

## Overview

This path shows the meaning of an unknown value. A rule cannot hold an
incident on a device that no longer delivers data.

## Initial State

- The rule `pump1-fault` has an incident on `TAG("pump1", "error_code") != 0`.
- The incident is active because `error_code` was 5.
- The offline threshold of the service is 3 missed polls.

## Trigger

The device `pump1` does not answer three polls in a row.

## Step-by-Step Flow

1. [Reaction]: The service marks `pump1` offline and publishes its retained status.
2. [Reaction]: The service writes `nil` into every slot of `pump1`.
3. [Reaction]: The service calls `Eval`. The slots changed, so the engine evaluates the rule.
4. [Reaction]: A comparison with an unknown value is false. The result is false and the previous result was true.
5. [Reaction]: The engine returns one resolve incident. The service publishes it.

## Expected Outcome

- [Success Condition]: The forwarder closes the incident of `pump1-fault`. The device status shows offline.
- [Verification]: The test `TestLeafCond_NilValue` and an aggregator test that goes offline and expects a resolve.

## Exceptions & Edge Cases

- [Device returns]: When `pump1` answers again with `error_code` = 5, the rule sees a rising edge and triggers again.
- [STALE]: A rule with `STALE(TAG("pump1", "error_code"), 5min)` becomes true 5 min after the slot became `nil` (SCEN-008).
