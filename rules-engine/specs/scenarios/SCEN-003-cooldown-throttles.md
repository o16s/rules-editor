---
id: "SCEN-003"
type: scenario
name: "Cooldown throttles a repeating alarm"
description: >
  A value that oscillates around a threshold fires a rule at most once per
  cooldown period.
refines:
  - "UC-003"
---

# Scenario: Cooldown throttles a repeating alarm

## Overview

This path shows how `cooldown` limits the number of firings of a rule with
`edge="none"`.

## Initial State

- The rule `pressure-high` has `cooldown="10s"`, no `edge` attribute, and one publish action.
- Its condition is `TAG("Pressure") > 100`.
- The value changes on every frame at 10 Hz and stays more than 100.

## Trigger

The first frame with `Pressure` more than 100 arrives at t = 0.

## Step-by-Step Flow

1. [Reaction]: The engine evaluates the rule on every frame, because the slot changes on every frame.
2. [Reaction]: At t = 0 the rule fires. The engine records the time of the firing.
3. [Reaction]: From t = 0 to t = 10 s, the result stays true. The cooldown is active. Nothing fires.
4. [Reaction]: At t = 10 s the cooldown expires. The rule fires again.

## Expected Outcome

- [Success Condition]: The action topic receives one message per 10 s while the condition holds.
- [Verification]: The test `TestEngine_Cooldown` with a fixed clock.

## Exceptions & Edge Cases

- [Clock]: The engine takes the time as a parameter of `Eval`. The test controls it.
- [Zero cooldown]: `cooldown="0"` and no `cooldown` attribute mean no cooldown.
