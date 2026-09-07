---
id: "SWREQ-012"
type: software_requirement
name: "Shared fixtures and parity tests"
description: >
  The XSD fixtures, the formula cases and the function registry are files that
  both the editor and the engine test against.
specification: >
  The XSD fixtures, the formula cases and the function registry must be files
  under `schema/`. Both `vitest` and `go test` must read them. A change to any
  of them must fail a suite that does not implement it.
derives_from:
  - "SYSARCH-001"
---

# Software Requirement: Shared fixtures and parity tests

## Requirement Specification

> The XSD fixtures, the formula cases and the function registry must be files under `schema/`. Both `vitest` and `go test` must read them. A change to any of them must fail a suite that does not implement it.

## Rationale

The drift between the editor and the engines came from copies. Files that
both suites read remove the copy.

## Logic & Interface Details

```
schema/
  rules.xsd
  fixtures/{valid,invalid,app-level,xsd-stricter}/<name>.xml
  formula-cases.json      [{ "text": "...", "print": "...", "error": null } | { "text": "...", "error": { "column": 7 } }]
  formula-functions.json  [{ "name": "TAG", "minArgs": 1, "maxArgs": 2, "returns": "any" }, ...]
```

- `src/xsd.test.ts` reads `fixtures/` instead of its inline tables. A test compares the fixture file names with the previous inline table once, then the table is deleted.
- `rules-engine/rulesxml/parity_test.go` reads `../../schema/rules.xsd` and `../../schema/fixtures/`. It requires `xmllint` and fails, not skips, when `CI=true`.
- `src/formula.test.ts` and `rules-engine/formula/parity_test.go` read `formula-cases.json`.
- A `vitest` test writes `formula-functions.json` from `FUNCTIONS` and fails when the file differs. The Go test reads it and fails when a function has no implementation.

## Acceptance Criteria

- Adding a fixture file without a change to the engine fails the Go parity test.
- Adding a function to `FUNCTIONS` without a Go implementation fails the Go registry test on the same commit.
- Both suites pass on the same commit in CI.

## Verification Plan

- **Method**: test and demonstration.
- **Procedure**: Both test suites in the CI of rules-editor. A one-time demonstration with a deliberate fixture addition.

## Notes

The fixture files ship in the npm tarball unless `.npmignore` excludes them (ADR-012).
