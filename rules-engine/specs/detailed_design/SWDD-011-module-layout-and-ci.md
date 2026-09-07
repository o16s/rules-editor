---
id: "SWDD-011"
type: software_detailed_design
name: "Module layout, tags and CI job"
description: >
  The directory layout, go.mod, the tag convention and the GitHub Actions job.
satisfies:
  - "SWREQ-013"
---

# Software Implementation: Module layout, tags and CI job

## Overview

```
rules-editor/
  rules-engine/
    go.mod          module github.com/o16s/rules-editor/rules-engine / go 1.24
    README.md       API, semantics, formula runtime, tags
    CLAUDE.md       Power of Ten, TDD
    PLAN.md         this plan
    sara.toml, specs/
    rules/          catalog.go load.go engine.go incident.go value.go *_test.go
    rulesxml/       rulesxml.go attrs.go schema.go *_test.go
    formula/        token.go parse.go print.go compile.go eval.go window.go *_test.go
  .github/workflows/go.yml
```

## Static View (Structure)

The `go.yml` job:

```yaml
- uses: actions/setup-go@v5
  with: { go-version-file: rules-engine/go.mod }
- run: sudo apt-get install -y libxml2-utils
- run: test -z "$(gofmt -l .)"
  working-directory: rules-engine
- run: go vet ./... && go run honnef.co/go/tools/cmd/staticcheck@latest ./...
- run: go test ./... -count=1
- run: go test ./rulesxml/ -run TestValidateAgreesWithThePublishedSchema -v | grep -q -- "--- PASS"
- run: GOOS=linux GOARCH=arm GOARM=7 go build ./... && GOOS=linux GOARCH=arm64 go build ./...
```

## Dynamic View (Logic)

Release: bump nothing in `package.json`. Tag `rules-engine/v0.3.0` on the
commit. Consumers `go get github.com/o16s/rules-editor/rules-engine@v0.3.0`.

## Interface & API Definitions

The public API is the `rules` package of SWREQ-002 to SWREQ-005 and the
`rulesxml.Validate` function. The `formula` package is public for tools such
as a simulator, with `Parse`, `Print`, `Compile` and `Program.Eval`.

## Error Handling & Edge Cases

- `staticcheck` is a Go tool dependency of CI, not of the module.
- The Storybook workflow ignores `rules-engine/` changes through a `paths-ignore` filter, and `go.yml` starts only on `rules-engine/**` and `schema/**` changes.

## Notes

ADR-001 and ADR-008.
