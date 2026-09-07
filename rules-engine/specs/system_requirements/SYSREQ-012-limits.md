---
id: "SYSREQ-012"
type: system_requirement
name: "Limits of a rules file"
description: >
  The engine enforces the limits of the XSD and of model.ts, and no other
  limits.
specification: >
  The engine must enforce the limits of `schema/rules.xsd` and `model.ts`, and
  no other limits. These are 1000 rules, 16 children per group, 4 condition
  levels, 64 variables, and 64 actions per rule. The text limits are 120
  characters per summary, and 240 characters per description, first step and
  cause.
derives_from:
  - "SCEN-010"
depends_on:
  - "SYSREQ-002"
---

# System Requirement: Limits of a rules file

## Requirement Specification

> The engine must enforce the limits of `schema/rules.xsd` and `model.ts`, and no other limits. These are 1000 rules, 16 children per group, 4 condition levels, 64 variables, and 64 actions per rule. The text limits are 120 characters per summary, and 240 characters per description, first step and cause.

## Rationale

The limits bound the loops of the engine. The XSD, `model.ts` and the engine
must agree, or one layer refuses a file that another accepts.

## Acceptance Criteria

- A file at each limit loads. A file one over each limit produces a problem.
- Character counts are code points, not bytes.
- The limits are constants in one place per layer, and a test compares the three.

## Verification Plan

- **Method**: test.
- **Procedure**: Fixtures at each limit and one over each limit, in `schema/fixtures/`. A test that reads `LIMITS` from `model.ts`, the XSD `maxOccurs` values, and the Go constants.

## Notes

The action cap of 64 is new to the XSD (ADR-009).
