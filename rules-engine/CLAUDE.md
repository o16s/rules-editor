# CLAUDE.md — rules-engine

## What this module is

`github.com/o16s/rules-editor/rules-engine` is the rule engine of the octaview
Edge Hub. Every ingestion service loads `rules.xml` with it and evaluates the
rules against its decoded data. The specification is in `specs/` as a SARA
graph, and `PLAN.md` records how the module replaces the three engines that
the services carried before.

The module lives next to `../schema/rules.xsd` and `../src/formula.ts`, which
define the file format and the formula language. A format change and its
engine change are one commit.

## Packages

| Package | What it does |
|---------|--------------|
| `rulesxml` | Validates the structure of a `rules.xml` document. Reports every fault with a path such as `rules/rule[2]/and/cond[1]@expr`. |
| `formula` | The formula language: tokenizer, parser, printer, static checks, compiler to a program, evaluator, time windows. |
| `rules` | The public surface: `Catalog`, `Load`, `Engine`, `Action`, `Incident`. |

## Coding Guidelines (Power of Ten Rules)

These rules apply to ALL code in this module. No exceptions.

1. **Simple control flow only.** No `goto`. No recursion at runtime. Bounded
   recursion is permitted at `Load` time only, where the depth limit of the
   document caps it.
2. **All loops must have a fixed upper bound.** Document the bound when it is
   not obvious from the code.
3. **No dynamic memory allocation after initialization.** `NewEngine`
   preallocates every buffer. `Eval` allocates nothing, except the `&`
   operator and a rendered Then field, which write into a preallocated
   per-rule buffer.
4. **Functions must be short.** No function exceeds ~60 lines of executable
   statements.
5. **Minimum two assertions per function.** Validate parameters and
   invariants. A library returns a problem or an error. It panics only on a
   programming fault in the caller, such as a nil rules slice.
6. **Smallest possible scope for data.**
7. **Check all return values.** Every exported function validates its
   parameters.
8. **Minimal build tags.** No code generation.
9. **Limit pointer indirection.** No function values except through an
   interface.
10. **Zero compiler warnings.** `go vet ./...` and `staticcheck ./...` must be
    silent.

## Development Methodology: Red-Green-Refactor TDD

1. **Red:** write a failing test that defines the behavior.
2. **Green:** write the minimum code that makes it pass.
3. **Refactor:** clean up while the tests stay green.

Never write production code without a failing test.

## Constraints

- **Go 1.24**, so tsend2mqtt needs no toolchain change.
- **Standard library only.** The module has no dependency.
- **32-bit ARM is a target** (the BL335 gateway, `linux/arm/v7`). No 64-bit
  atomics. No `int` for a value that can exceed 2^31.
- **The engine is not safe for concurrent use.** One goroutine owns the slot
  array and calls `Eval`.
- **The engine never logs.** Everything worth a log line is a counter in
  `Stats`. The service logs it.

## Shared files

The tests read three files of the parent package, and the TypeScript suite
reads the same files:

| File | What it holds |
|------|---------------|
| `../schema/rules.xsd` | The published schema. `rulesxml/parity_test.go` holds `Validate` to it with `xmllint`. |
| `../schema/fixtures/**` | One file per case, in four classes: `valid`, `invalid`, `app-level`, `xsd-stricter`. `reasons.json` carries the reason of each divergence. |
| `../schema/formula-cases.json`, `../schema/formula-functions.json` | The formula parity cases and the function registry. |
| `../schema/eval-cases.json` | The answers the engine and the editor's simulator must both give. |

`//go:embed` cannot reach a parent directory, so the tests read them with
`os.ReadFile` and a relative path.

## Common commands

```bash
gofmt -l .                                    # must print nothing
go vet ./...
go test ./... -count=1                        # needs xmllint for the parity test
go test -bench . -benchmem ./rules/           # must report 0 allocs/op
GOOS=linux GOARCH=arm GOARM=7 go build ./...  # the BL335 target
GOOS=linux GOARCH=arm64 go build ./...        # the IOT2050 target
sara check                                    # the specification graph
```

## Release

1. Bump the schema and the package version in the parent repository.
2. Tag `rules-engine/vX.Y.Z`. The `X.Y` follows the schema version.
3. The hub adopts the schema version before the services (SYSREQ-016).
4. Services update one line in `go.mod` and re-record their replay goldens.
