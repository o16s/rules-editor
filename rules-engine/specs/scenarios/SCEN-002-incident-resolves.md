---
id: "SCEN-002"
type: scenario
name: "Incident resolves when the condition clears"
description: >
  An active incident resolves with one message when the condition becomes
  false, even inside the cooldown.
refines:
  - "UC-002"
---

# Scenario: Incident resolves when the condition clears

## Overview

This path shows the falling edge of an incident rule and the rule that a
cooldown never delays a resolve.

## Initial State

- The rule `high-temp` has `cooldown="60s"` and an incident with `severity="warning"`.
- Its condition is `TAG("pool1", "temperature_c") > 40`.
- The rule fired 5 s ago. The incident is active.

## Trigger

A poll returns `temperature_c` = 38.

## Step-by-Step Flow

1. [Reaction]: The service writes 38 into the slot.
2. [Reaction]: The engine evaluates the rule. The result is false and the previous result was true.
3. [Reaction]: The incident is active, so the engine returns one resolve incident.
4. [Reaction]: The cooldown of 60 s is still active. The resolve is not delayed.
5. [Reaction]: The service publishes the resolve to `incidents/` with QoS 1 and the same `dedup_key`.
6. [Reaction]: The engine marks the incident as not active.

## Expected Outcome

- [Success Condition]: The forwarder closes the incident within one poll period.
- [Verification]: The tests `TestEngine_IncidentResolve` and `TestEngine_ResolveNeverSuppressedByCooldown`.

## Exceptions & Edge Cases

- [Suppressed trigger]: If the cooldown suppressed the trigger, the incident was never active. The engine sends no resolve (`TestEngine_IncidentCooldownSuppressesTrigger`).
- [Unknown value]: If the slot becomes `nil`, the comparison is false. The engine resolves the incident.
