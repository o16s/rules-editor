---
id: "SCEN-012"
type: scenario
name: "A cross-device condition fires"
description: >
  A rule over two devices on two buses fires when both temperatures exceed a
  limit, as each device reports.
refines:
  - "UC-001"
  - "UC-004"
---

# Scenario: A cross-device condition fires

## Overview

This path shows a condition over two devices whose data arrive at different
times.

## Initial State

- The rule `both-hot` has `edge="rising"` and the condition `AND(TAG("pump1", "temperature") > 50, TAG("pump2", "temperature") > 50)`.
- `pump1` is on bus 1 and `pump2` on bus 2. Their reports arrive at different times.
- Both temperatures are 45.

## Trigger

`pump1` reports 55. Two seconds later `pump2` reports 56.

## Step-by-Step Flow

1. [Reaction]: The `pump1` report changes one slot. The engine evaluates the rule. The result is false.
2. [Reaction]: The `pump2` report changes the other slot. The engine evaluates the rule. The result is true.
3. [Reaction]: The previous result was false. The rule fires once.

## Expected Outcome

- [Success Condition]: One firing, at the time of the second report.
- [Verification]: The test `TestParse_CrossDevice` and an `Eval` test with two steps.

## Exceptions & Edge Cases

- [One device offline]: If `pump2` goes offline, its slot becomes `nil`. The condition is false and the rule re-arms.
