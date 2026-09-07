---
id: "SYSREQ-001"
type: system_requirement
name: "One rule engine for all ingestion services"
description: >
  Every ingestion service evaluates rules with the same engine code.
specification: >
  Every ingestion service of the Edge Hub must evaluate `rules.xml` with the
  same Go module, `github.com/o16s/rules-editor/rules-engine`.
derives_from:
  - "SCEN-011"
  - "SCEN-007"
---

# System Requirement: One rule engine for all ingestion services

## Requirement Specification

> Every ingestion service of the Edge Hub must evaluate `rules.xml` with the same Go module, `github.com/o16s/rules-editor/rules-engine`.

## Rationale

Three copies of the engine drifted within two months. A regression fixed in
tsend2mqtt on 2026-07-12 is still present in the two other services. One
module removes the class of defect.

## Acceptance Criteria

- No service contains a package named `rules` or `rulesxml` under `internal/`.
- Each service `go.mod` requires the module at a tagged version.
- The union of the three existing test suites passes against the module.

## Verification Plan

- **Method**: inspection and test.
- **Procedure**: A CI step in each service fails if `internal/rules` exists. The module test suite contains every test of the three services, adapted to slots.

## Notes

The module lives in the rules-editor repository (ADR-001).
