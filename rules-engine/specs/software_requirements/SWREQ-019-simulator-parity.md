---
id: "SWREQ-019"
type: software_requirement
name: "The simulator answers as the engine does"
description: >
  The editor's simulator and the Go engine must give the same answer for every
  case in the shared file.
specification: >
  The editor's simulator and the engine must give the same answer for every
  case in schema/eval-cases.json, and both test suites must read that file.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-009"
  - "SWREQ-012"
---

# Software Requirement: The simulator answers as the engine does

## Requirement Specification

> The editor's simulator and the engine must give the same answer for every case in `schema/eval-cases.json`, and both test suites must read that file.

## Rationale

An operator stages a fault in the simulator to see what a rule will do. The
gateway then does it. Two answers for one rule make the simulator worse than
none, because it is trusted.

## Logic & Interface Details

- `schema/eval-cases.json` is a list of cases. Each has a name, a formula, the type of every tag it reads, an optional `step_seconds`, and the steps.
- A step gives the values of the tags that changed, and the answer the formula must give at that moment. A value of `null` means the field is not known.
- `src/simulate.test.ts` drives `evaluateAt` over the steps. `rules-engine/formula/eval_cases_test.go` compiles the formula and drives `Program.Eval`.
- The cases cover every operator, both sides of every unknown, the rendering of a join, and one time series each for `CHANGED`, `STALE`, `RATE` and `AVG`.
- A number and an integer of the same value are the same answer: the case file has one number type.

## Acceptance Criteria

- Both suites pass every case.
- Reverting one alignment fix fails the matching case, in that language, on that commit.
- A new function in the registry arrives with at least one case.

## Verification Plan

- **Method**: test and demonstration.
- **Procedure**: Both suites in CI. Once, by hand: undo one fix and watch the case fail.

## Notes

ADR-020 records the seven answers and why each side won.
