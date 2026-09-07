---
id: "SCEN-004"
type: scenario
name: "Every change of an alarm code fires"
description: >
  A rule on CHANGED() with edge rising fires on the first, second and third
  change of the value.
refines:
  - "UC-003"
---

# Scenario: Every change of an alarm code fires

## Overview

This path covers the regression that two of the three engines have today. A
`CHANGED()` condition is a pulse. The rule must re-arm after each pulse.

## Initial State

- The rule `code-change` has `edge="rising"` and one publish action.
- Its condition is `CHANGED(TAG("AlarmCode"))`.
- The slot of `AlarmCode` holds 0.

## Trigger

Three frames arrive with `AlarmCode` = 3, then 7, then 9.

## Step-by-Step Flow

1. [Reaction]: On the first frame, the slot changes. The condition is true. The rule fires.
2. [Reaction]: After the firing, the engine resets the previous result of the rule to false.
3. [Reaction]: On the second frame, the slot changes. The condition is true and the previous result is false. The rule fires.
4. [Reaction]: The same happens on the third frame.

## Expected Outcome

- [Success Condition]: The action topic receives three messages.
- [Verification]: The tests `TestEngineEval_ChangedWithRisingEdge`, `TestEngineEval_ChangedCompoundWithRisingEdge` and `TestEngineEval_ChangedWithRisingEdgeAndCooldown`, ported from tsend2mqtt.

## Exceptions & Edge Cases

- [Incident on a pulse]: A pulse condition is never observed as false. An incident on a pulse-only condition triggers again on each change and never resolves. The library README documents this.
- [Cooldown]: With `cooldown="1h"`, the second and third change fire nothing.
