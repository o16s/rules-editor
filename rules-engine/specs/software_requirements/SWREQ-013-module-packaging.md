---
id: "SWREQ-013"
type: software_requirement
name: "Module packaging and CI"
description: >
  The module has its own go.mod, is tagged rules-engine/vX.Y.Z, and CI vets,
  tests and cross-compiles it.
specification: >
  The module must have its own `go.mod` with `go 1.24` and no dependency, and
  must be tagged `rules-engine/vX.Y.Z`. The CI of rules-editor must do
  `gofmt`, `go vet`, `go test` and a cross-compile for `linux/arm/v7` and
  `linux/arm64` on every push.
derives_from:
  - "SYSARCH-001"
---

# Software Requirement: Module packaging and CI

## Requirement Specification

> The module must have its own `go.mod` with `go 1.24` and no dependency, and must be tagged `rules-engine/vX.Y.Z`. The CI of rules-editor must do `gofmt`, `go vet`, `go test` and a cross-compile for `linux/arm/v7` and `linux/arm64` on every push.

## Rationale

SYSREQ-009 and the Power of Ten rule 10 (zero warnings).

## Logic & Interface Details

- `rules-engine/go.mod`: `module github.com/o16s/rules-editor/rules-engine`, `go 1.24`.
- Tags: `rules-engine/v0.3.0` for the first release that implements schema 0.3.
- CI job `go` in `.github/workflows/`: `gofmt -l` must print nothing, `go vet ./...`, `staticcheck ./...`, `go test ./...`, `GOOS=linux GOARCH=arm GOARM=7 go build ./...`, `GOOS=linux GOARCH=arm64 go build ./...`, `apt-get install libxml2-utils`, and the parity assertion of modbus2mqtt `image.yml`.
- A `README.md` in `rules-engine/` documents the API, the semantics of section 4.4 of PLAN.md, the formula runtime and the two tag namespaces.
- `rules-engine/CLAUDE.md` carries the Power of Ten rules and the TDD rule of the services.

## Acceptance Criteria

- `go get github.com/o16s/rules-editor/rules-engine@v0.3.0` resolves in a fresh module.
- The CI job is green on the release commit.
- `go vet` and `staticcheck` report nothing.

## Verification Plan

- **Method**: demonstration.
- **Procedure**: A fresh `go mod init` in a temporary directory, then `go get` of the tag.

## Notes

If the repository is private, the README documents `GOPRIVATE=github.com/o16s`.
