---
id: "SCEN-009"
type: scenario
name: "Rate of temperature change raises a warning"
description: >
  A RATE() rule fires when a temperature climbs faster than a limit over a 30
  min window.
refines:
  - "UC-004"
---

# Scenario: Rate of temperature change raises a warning

## Overview

This path shows a window function with fixed memory.

## Initial State

- The rule `temp-climb` has an incident and the condition `RATE(TAG("plc1", "Temperature"), 30min) > 20`.
- The engine keeps a ring of 64 buckets of 28.125 s each for this slot and window.
- The temperature was steady at 40 for one hour.

## Trigger

The temperature climbs from 40 to 52 within 30 min.

## Step-by-Step Flow

1. [Reaction]: On each change, the engine records the value in the current bucket.
2. [Reaction]: On each tick, the engine computes the rate as the last sample minus the first sample in the window, divided by 0.5 h.
3. [Reaction]: When the rate passes 24 per hour, the result is true. The rule triggers.
4. [Reaction]: When the climb stops, the rate decreases to less than 20 within 30 min. The incident resolves.

## Expected Outcome

- [Success Condition]: The incident triggers while the climb is faster than 20 per hour and resolves after.
- [Verification]: An `Eval` test that feeds a ramp with a fixed clock and compares the rate with a hand computation.

## Exceptions & Edge Cases

- [Too few samples]: With fewer than two samples in the window, `RATE` is 0.
- [Unknown value]: A `nil` sample is skipped.
