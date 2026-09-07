---
id: "UC-005"
type: use_case
name: "Learn every fault in a rules file at startup"
description: >
  One restart of the service shows the operator every problem in the rules
  file, each with a path.
refines:
  - "SOL-001"
---

# Use Case: Learn every fault in a rules file at startup

## Actor(s)

- **Primary Actor**: The operator who deploys a rules file.
- **Secondary Actors**: The service and its log.

## Pre-conditions

- A rules file is present at the configured path.

## Main Success Outcome

The service validates the structure of the file, then binds names, types and
formulas. It logs every problem it finds, each with a path such as
`rules/rule[2]/and/cond[1]@expr`. Then it exits. The operator corrects the
whole file in one pass.

## Key Functional Scope

- **Structure**: Unknown elements and attributes, missing required attributes, wrong order, limits.
- **Binding**: Unknown devices and tags, values that do not fit the field type, unknown functions, unresolved variables, variable cycles, non-boolean conditions.
- **No partial load**: A file with one problem loads no rule.
- **Absent file**: A missing file is not an error where the service contract says so.

## Post-conditions

- **Success Condition**: The log lists every problem. The exit code is not zero.
- **Failure Condition**: The service exits after the first problem, or loads a subset of the rules.
