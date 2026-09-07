---
id: "SCEN-011"
type: scenario
name: "A fix in the engine reaches all services in one release"
description: >
  A developer fixes a defect in the shared module, tags it, and each service
  adopts it with one go.mod change.
refines:
  - "UC-006"
---

# Scenario: A fix in the engine reaches all services in one release

## Overview

This path shows the maintenance flow that the shared module makes possible.

## Initial State

- The services require `rules-engine/v0.3.0`.
- A defect is found in the cooldown logic.

## Trigger

The developer writes a failing test in `rules-engine/rules`.

## Step-by-Step Flow

1. [Action]: The developer fixes the defect and makes the test pass.
2. [Reaction]: The CI of rules-editor does `go vet`, `go test`, and cross-compiles for linux/arm/v7 and linux/arm64.
3. [Action]: The developer tags `rules-engine/v0.3.1`.
4. [Action]: Each service changes one line in `go.mod` and does `go mod tidy`.
5. [Reaction]: The replay test of each service passes with the new version.

## Expected Outcome

- [Success Condition]: The three services ship the fix without a local patch.
- [Verification]: The CI of each service is green after the version change.

## Exceptions & Edge Cases

- [Behavior change]: If the fix changes behavior, the replay golden files change in the same pull request, with a note in the changelog.
