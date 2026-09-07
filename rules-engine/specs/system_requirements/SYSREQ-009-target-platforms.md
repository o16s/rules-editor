---
id: "SYSREQ-009"
type: system_requirement
name: "Target platforms and dependencies"
description: >
  The module builds for linux/arm/v7 and linux/arm64 with Go 1.24 and the
  standard library only.
specification: >
  The module must compile with `go 1.24` for `linux/arm/v7` and `linux/arm64`
  with `CGO_ENABLED=0`, and must import only the Go standard library.
derives_from:
  - "SCEN-011"
---

# System Requirement: Target platforms and dependencies

## Requirement Specification

> The module must compile with `go 1.24` for `linux/arm/v7` and `linux/arm64` with `CGO_ENABLED=0`, and must import only the Go standard library.

## Rationale

The BL335 is 32-bit ARM. tsend2mqtt is on Go 1.24.3. A dependency is a
supply-chain risk on a gateway.

## Acceptance Criteria

- `go.mod` declares `go 1.24` and has no `require` line.
- CI cross-compiles for both targets on every push.
- No 64-bit atomic operation is used.
- No `int` holds a value that can exceed 2^31.

## Verification Plan

- **Method**: test and inspection.
- **Procedure**: The CI job of rules-editor. A review of `go.mod`.

## Notes

See ADR-008.
