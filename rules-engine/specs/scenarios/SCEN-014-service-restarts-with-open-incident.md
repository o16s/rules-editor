---
id: "SCEN-014"
type: scenario
name: "Service restarts while an incident is open"
description: >
  A service restarts while an incident is open. The first evaluation after the
  restart closes a stale incident or keeps a live one open.
refines:
  - "UC-002"
---

# Scenario: Service restarts while an incident is open

## Overview

The `active` flag of an incident lives in memory. A restart loses it. This
path shows how the engine recovers without a state file.

## Initial State

- The rule `pump1-fault` has an incident on `TAG("pump1", "error_code") != 0`.
- The incident is active. The forwarder shows it open.
- The service restarts for a deployment. The restart takes 30 s.

## Trigger

The service starts again and loads the same rules file.

## Step-by-Step Flow

1. [Reaction]: `NewEngine` marks every incident rule as active, with no previous result.
2. [Reaction]: The first device report of `pump1` arrives and changes the slots.
3. [Reaction]: Case A, `error_code` is still 5. The result is true and the previous result is false. The engine emits a trigger with the same `dedup_key`. The forwarder sees a duplicate and keeps the incident open.
4. [Reaction]: Case B, `error_code` is 0. The result is false and the rule is active. The engine emits a resolve. The forwarder closes the incident.
5. [Reaction]: From the second evaluation on, the normal lifecycle of SYSREQ-004 applies.

## Expected Outcome

- [Success Condition]: No incident stays open after a restart when its cause is gone. No incident closes and reopens when its cause is still present.
- [Verification]: An `Eval` test on a fresh engine with a true first value, and one with a false first value.

## Exceptions & Edge Cases

- [No data]: If `pump1` never reports after the restart, the rule is never evaluated and emits nothing. The incident stays open. The state of the plant is unknown, so this is the safe choice. When the device goes offline, SYSREQ-011 clears its slots and the incident resolves.
- [Rule removed]: If the new rules file does not contain the rule, its incident stays open. The operator resolves it by hand. ADR-014 names a state file as the later fix.
