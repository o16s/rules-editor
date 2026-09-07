---
id: "ADR-012"
type: architecture_decision_record
name: "The editor and the engine read the same fixture files"
description: >
  The XSD fixtures, the formula cases and the function registry are files
  under schema/, read by vitest and by go test.
status: proposed
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-010"
---

# Architecture Decision: The editor and the engine read the same fixture files

## Context and problem statement

The XSD fixtures are tables inside `src/xsd.test.ts`. modbus2mqtt extracted them by hand into files at v0.2.0. The formula tests exist only in TypeScript. How do two test suites in two languages share one truth?

## Key factors

- A fixture that exists in one suite only lets the other drift.
- `//go:embed` cannot reach a parent directory. `os.ReadFile` with a relative path can.

## Considered options

- Files under `schema/`, read by both suites.
- Generate the Go fixtures from the TypeScript tables in a build step.
- Keep separate fixtures.

## Decision Outcome

Chosen option: "Files under `schema/`", because both suites read them without a generation step and a diff shows every change.

### Positive Consequences

- A new fixture is one file and fails both suites until both agree.

### Negative Consequences

- `src/xsd.test.ts` and `src/formula.test.ts` change to read files.
- The fixture files ship in the npm package, or `.npmignore` excludes them.

## Pros and Cons of the Options

### Shared files

- Good, because there is one truth and no build step.

### Generated

- Bad, because a generation step can be skipped.

### Separate

- Bad, because it is the current state that drifted.

## Links

- PLAN.md, section 3.
