---
id: "UC-006"
type: use_case
name: "Maintain one engine for all services"
description: >
  A developer fixes or extends the rule engine once, and every service
  receives the change through one module version.
refines:
  - "SOL-001"
---

# Use Case: Maintain one engine for all services

## Actor(s)

- **Primary Actor**: The service developer.
- **Secondary Actors**: The CI of rules-editor, and the CI of each service.

## Pre-conditions

- The engine is one Go module with a version tag.
- Each service requires the module in its `go.mod`.

## Main Success Outcome

A change to the engine is one commit and one tag in rules-editor. Each
service updates one line in `go.mod`. The parity tests of the module catch a
drift between the editor and the engine on the same commit.

## Key Functional Scope

- **One module**: `github.com/o16s/rules-editor/rules-engine`.
- **Shared fixtures**: The XSD fixtures and the formula cases are files that both test suites read.
- **Cross-compile in CI**: linux/arm/v7 and linux/arm64 build on every push.
- **Replay tests**: Each service proves that a version update did not change its behavior.

## Post-conditions

- **Success Condition**: All three services pass their tests with the new module version.
- **Failure Condition**: A service needs a local patch of the engine.
