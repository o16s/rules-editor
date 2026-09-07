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
| `CHANGED(x)` | true when the value of `x` this call differs from its value at the previous call, by `equalValue` |
| `BITAND`, `BITOR`, `BITXOR` | on `int64`. A `Number` operand with a fraction gives `Unknown` |
| `HEX2DEC(s)` | `int64` of a hex string without prefix. Invalid gives `Unknown` |
| `+ - * /` | on `float64`. `Integer` operands widen. `x / 0` gives `Unknown` |
| `= != < <= > >=` | number with number, string with string, bool with bool (`=` and `!=` only). Other pairs give `Unknown` |
| `&` | string join. Number prints with `strconv.FormatFloat(f, 'g', -1, 64)`, integer with `FormatInt`, bool as `true` or `false`, `Unknown` as the empty string |

A condition with the value `Unknown` counts as false.

## Acceptance Criteria

- A table test per row of the table, with `nil` cases.
- `go test -bench` of a program without `&` reports 0 allocs/op.
- A 0.2 `cond` and its formula give the same result for the same slots.

## Verification Plan

- **Method**: test.
- **Procedure**: Table tests. A benchmark. A differential test that compiles both forms of each operator and compares over random values.

## Notes

`Unknown` is a fourth truth value inside a program. It never leaves the program: the condition sees false.
