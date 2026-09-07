---
id: "SYSREQ-005"
type: system_requirement
name: "Formula language of schema 0.3 at runtime"
description: >
  The engine evaluates every formula that the editor accepts, with the meaning
  the editor documents.
specification: >
  The engine must evaluate `<var formula>`, `<cond expr>` and Then fields that
  start with `=`. It must implement every function in the registry `FUNCTIONS`
  of `src/formula.ts`, with the meaning documented in the README of rules-
  editor.
derives_from:
  - "SCEN-007"
  - "SCEN-008"
  - "SCEN-009"
  - "SCEN-012"
  - "SCEN-013"
depends_on:
  - "SYSREQ-002"
---

# System Requirement: Formula language of schema 0.3 at runtime

## Requirement Specification

> The engine must evaluate `<var formula>`, `<cond expr>` and Then fields that start with `=`. It must implement every function in the registry `FUNCTIONS` of `src/formula.ts`, with the meaning documented in the README of rules-editor.

## Rationale

Version 0.3 of the editor writes only the formula form. A file saved today does
not load on any service.

## Acceptance Criteria

- Every function in `schema/formula-functions.json` has an implementation and at least one test.
- Every case in `schema/formula-cases.json` parses to the same canonical text, or fails at the same column, in Go and in TypeScript.
- A 0.2 file and its 0.3 rewrite by the editor produce the same actions and incidents for the same value sequence.
- A formula that the editor rejects is rejected by `Load` with a problem.

## Verification Plan

- **Method**: test.
- **Procedure**: The `formula` package tests read the shared case file. A round-trip test loads each `examples/rules.xml` of the three services, rewrites it with the editor, loads the result, and compares the outputs of a replay.

## Notes

The registry is the contract. A function added to `formula.ts` without a Go
implementation fails the Go test on the same commit.
