---
id: "SCEN-013"
type: scenario
name: "A Then field carries the live value"
description: >
  A payload and an incident summary are formulas. At fire time they contain
  the current value and the row description.
refines:
  - "UC-004"
  - "UC-002"
---

# Scenario: A Then field carries the live value

## Overview

This path shows formulas in Then fields, rendered at fire time.

## Initial State

- The rule `temp-report` has the variable `temp = TAG("plc1", "Temperature")`.
- Its condition row is `temp > 80` with `description="Temperature more than 80"`.
- Its publish has `payload='={"temp":" & temp & "}'`.
- Its incident has `summary='=condition.description & " on plc1"'`.

## Trigger

A frame arrives with `Temperature` = 85.5.

## Step-by-Step Flow

1. [Reaction]: The rule fires.
2. [Reaction]: The engine renders the payload into the buffer of the rule: `{"temp":85.5}`.
3. [Reaction]: The engine renders the summary: `Temperature more than 80 on plc1`.
4. [Reaction]: The service publishes the action and the trigger.

## Expected Outcome

- [Success Condition]: The payload and the summary contain the rendered text.
- [Verification]: An `Eval` test that inspects `Action.Payload` and `Incident.Summary`.

## Exceptions & Edge Cases

- [Buffer full]: If the rendered text exceeds 4 KiB, the engine truncates it and the service logs a warning.
- [Summary too long]: A rendered summary longer than 120 characters is truncated to 120 characters.
- [No description]: If no true row has a description, `condition.description` is the empty string.
