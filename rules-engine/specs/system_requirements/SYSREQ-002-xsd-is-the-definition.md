---
id: "SYSREQ-002"
type: system_requirement
name: "The published XSD defines what the engine accepts"
description: >
  The engine accepts a file if and only if schema/rules.xsd and the editor
  accept it, with listed exceptions.
specification: >
  The engine must accept a `rules.xml` file if and only if `schema/rules.xsd`
  accepts it. The exceptions are the application-level checks listed in the
  README of rules-editor.
derives_from:
  - "SCEN-007"
  - "SCEN-010"
---

# System Requirement: The published XSD defines what the engine accepts

## Requirement Specification

> The engine must accept a `rules.xml` file if and only if `schema/rules.xsd` accepts it. The exceptions are the application-level checks listed in the README of rules-editor.

## Rationale

The hub validates uploads against the XSD. A file the hub saves must start
the service. A file the hub rejects must not start the service. Two verdicts
for one file cost an operator a site visit.

## Acceptance Criteria

- Every fixture in `schema/fixtures/valid/` loads without a problem.
- Every fixture in `schema/fixtures/invalid/` and `schema/fixtures/xsd-stricter/` produces at least one problem.
- Every fixture in `schema/fixtures/app-level/` produces at least one problem, and the reason is listed in the parity test.
- `cooldown="0"` is accepted, as in the XSD.

## Verification Plan

- **Method**: test.
- **Procedure**: The parity test in `rules-engine/rulesxml` gives every fixture to `Validate` and to `xmllint --schema`. The verdicts must match, except for the listed fixtures. CI installs `libxml2-utils` and makes sure that the test ran.

## Notes

The XSD and the fixtures live in the same repository as the engine, so a
schema change and its engine change are one commit.
