---
id: "ADR-001"
type: architecture_decision_record
name: "Host the engine as a Go module inside rules-editor"
description: >
  The engine lives in the rules-editor repository under rules-engine/, next to
  the XSD and the formula language.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SYSARCH-001"
  - "SWDD-011"
---

# Architecture Decision: Host the engine as a Go module inside rules-editor

## Context and problem statement

The engine must agree with `schema/rules.xsd` and with `src/formula.ts`. Where does the Go code live so that a format change and its engine change cannot drift?

## Key factors

- The XSD fixtures and the formula cases must be one set of files for both test suites.
- Go modules in a subdirectory are supported with `rules-engine/vX.Y.Z` tags.
- The npm package must not grow.

## Considered options

- A Go module under `rules-engine/` in rules-editor.
- A new repository `o16s/rules-engine` that vendors the XSD.
- One package copied into each service, as today.

## Decision Outcome

Chosen option: "A Go module under `rules-engine/` in rules-editor". The schema, the fixtures, the formula language and the engine then change in one commit and one test cycle.

### Positive Consequences

- No vendored copy of the XSD. The parity test reads the file next to it.
- One tag covers the schema and the engine that implements it.

### Negative Consequences

- Two tag namespaces in one repository (`vX.Y.Z` for npm, `rules-engine/vX.Y.Z` for Go). The README documents both.
- The CI of rules-editor needs a Go job.

## Pros and Cons of the Options

### A Go module under `rules-engine/`

- Good, because the fixtures are shared without a copy step.
- Bad, because the repository mixes two languages.

### A new repository

- Good, because the module has its own release cadence.
- Bad, because the XSD must be vendored, and the copy drifts, as it did in modbus2mqtt.

### One package per service

- Bad, because three copies drifted within two months.

## Links

- PLAN.md, section 3.
