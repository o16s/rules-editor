---
id: "SYSREQ-006"
type: system_requirement
name: "Startup validation reports every problem"
description: >
  Loading a rules file reports every structural and binding problem with a
  path, and loads no rule when one exists.
specification: >
  `Load` must report every structural and binding problem of a rules file,
  each with a path in the form `rules/rule[2]/and/cond[1]@expr`. It must
  return no rule when at least one problem exists.
derives_from:
  - "SCEN-010"
---

# System Requirement: Startup validation reports every problem

## Requirement Specification

> `Load` must report every structural and binding problem of a rules file, each with a path in the form `rules/rule[2]/and/cond[1]@expr`. It must return no rule when at least one problem exists.

## Rationale

A service on a gateway restarts slowly. One restart per fault costs the
operator hours.

## Acceptance Criteria

- A file with N independent faults produces N problems, up to a cap of 200.
- Each problem has a non-empty path and a message.
- A binding problem names the rule and the attribute.
- No rule is returned together with a problem.

## Verification Plan

- **Method**: test.
- **Procedure**: The `rulesxml` tests with the fixture files. A `Load` test with a file of three faults expects three problems with exact paths.

## Notes

modbus2mqtt has this behavior today. iolinkmaster2mqtt and tsend2mqtt stop
at the first fault.
