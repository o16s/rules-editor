---
id: "SWREQ-009"
type: software_requirement
name: "Formula evaluation"
description: >
  A compiled program evaluates to a value with the documented operator and
  function semantics, without allocation.
specification: >
  The evaluator must compute a program over the slot array with the documented
  meaning of every operator. It must implement `AND`, `OR`, `NOT`, `CHANGED`,
  `BITAND`, `BITOR`, `BITXOR` and `HEX2DEC`. It must not allocate heap memory,
  except for the `&` operator.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-008"
  - "SWREQ-006"
---

# Software Requirement: Formula evaluation

## Requirement Specification

> The evaluator must compute a program over the slot array with the documented meaning of every operator. It must implement `AND`, `OR`, `NOT`, `CHANGED`, `BITAND`, `BITOR`, `BITXOR` and `HEX2DEC`. It must not allocate heap memory, except for the `&` operator.

## Rationale

SYSREQ-005 at the level of one program.

## Logic & Interface Details

```go
type Value struct { Kind Kind; B bool; I int64; F float64; S string }
func (p *Program) Eval(env *Env) Value   // env: slots, changedSet, windows, clock, context
```

| Construct | Meaning |
|---|---|
| `TAG` | the slot value as `Bool`, `Integer` (int64), `Number` (float64) or `String`. `nil` gives `Unknown` |
| `AND`, `OR` | boolean, short-circuit, 2 to 16 arguments. An `Unknown` argument gives `Unknown` unless the result is decided |
| `NOT` | boolean. `NOT(Unknown)` is `Unknown` |
| `CHANGED(x)` | true when the value of `x` is known and differs from the last known value of `x`, by `equalValue`. The first value of `x` is not a change. `nil` is never a change (ADR-018). The engine keeps the last known value per `CHANGED` node, so `x` can be an expression. A short-circuit never skips it (ADR-023) |
| `BITAND`, `BITOR`, `BITXOR` | on `int64`. A `Number` operand with a fraction gives `Unknown` |
| `HEX2DEC(s)` | `int64` of a hex string without prefix. Invalid gives `Unknown` |
| `+ - * /` | on `float64`. `Integer` operands widen. `x / 0` gives `Unknown` |
| `= != < <= > >=` | number with number (`Integer` widens to `Number`), string with string, bool with bool (`=` and `!=` only) |
| `=`, `!=` bool with number | `1` reads as `true` and `0` as `false`. Another number is not that boolean, so the answer is false, not unknown (ADR-015) |
| `=`, `!=` string with number or bool | the string compares with the text form of the other value, as `&` renders it (ADR-015) |
| any other pair | `Unknown` |
| `&` | string join. A number prints with `strconv.FormatFloat(f, 'g', -1, 64)` and an integer with `FormatInt`. A bool prints as `true` or `false`. A duration prints as its formula text, such as `30min`. `Unknown` prints as the empty string |

A condition with the value `Unknown` counts as false.

### The short-circuit

`AND` and `OR` stop at the argument that decides the answer, except where an
argument carries memory: `CHANGED`, `PREV` and `EWMA` must see every
evaluation, so a call containing one runs all of its arguments (ADR-023). A
decided answer still absorbs an unknown that follows it.

## Acceptance Criteria

- `AND(gate, CHANGED(x))` is true in the evaluation where `x` moves and the gate is open, including when the gate opened in that same evaluation.
- `AND(false, unknown)` is false and `OR(true, unknown)` is true.

- A table test per row of the table, with `nil` cases.
- Every case of `schema/eval-cases.json` gives the same answer here and in the editor's simulator (SWREQ-019).
- `go test -bench` of a program without `&` reports 0 allocs/op.
- A 0.2 `cond` and its formula give the same result for the same slots.
- `TAG("B") = 1` on a boolean slot with `true` is true. `TAG("S") = true` on a string slot with `"true"` is true.

## Verification Plan

- **Method**: test.
- **Procedure**: Table tests. A benchmark. A differential test that compiles both forms of each operator and compares over random values.

## Notes

`Unknown` is a fourth truth value inside a program. It never leaves the program: the condition sees false.
