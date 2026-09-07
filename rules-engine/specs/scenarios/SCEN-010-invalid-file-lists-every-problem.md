---
id: "SCEN-010"
type: scenario
name: "Startup with an invalid file lists every problem"
description: >
  A rules file with three faults produces three log lines with paths, and the
  service exits without a loaded rule.
refines:
  - "UC-005"
---

# Scenario: Startup with an invalid file lists every problem

## Overview

This path shows startup validation. One restart shows the whole file.

## Initial State

- The rules file has three faults. Rule 2 has `edge="up"`. Rule 2 has a `gt` condition without `value`. Rule 3 has a `<publish>` without `topic`.

## Trigger

The service starts.

## Step-by-Step Flow

1. [Reaction]: The service reads the file and calls `Load`.
2. [Reaction]: The structural validation reports all three problems with paths.
3. [Reaction]: `Load` returns no rules and the three problems.
4. [Reaction]: The service logs `rules file is not valid problems=3` and one line per problem.
5. [Reaction]: The service exits with a non-zero code.

## Expected Outcome

- [Success Condition]: The log shows `rules/rule[2]@edge`, `rules/rule[2]/and/cond[1]@value` and `rules/rule[3]/actions/publish[1]@topic`.
- [Verification]: A `Load` test with this file that expects exactly three problems with these paths.

## Exceptions & Edge Cases

- [Binding problems]: Unknown tags and type mismatches are reported in the same list, after the structural problems.
- [Absent file]: On modbus2mqtt an absent `/svc/rules.xml` logs one warning and disables rules.
- [Problem cap]: The validator stops after 200 problems.
