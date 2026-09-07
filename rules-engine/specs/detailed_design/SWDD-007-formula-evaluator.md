---
id: "SWDD-007"
type: software_detailed_design
name: "Formula evaluator: stack machine and functions"
description: >
  A loop over the instruction array with a fixed value stack. Each opcode is a
  case in one switch.
satisfies:
  - "SWREQ-009"
---

# Software Implementation: Formula evaluator: stack machine and functions

## Overview

`Program.Eval(env)` is one `for` loop over `code`, bounded by `len(code)`,
with a `switch` on the opcode. The stack is a slice of `Value` of length
`depth`, allocated in `NewEngine` per rule and reused.

## Static View (Structure)

```go
type Kind uint8 // Unknown, Bool, Integer, Number, String
type Value struct { Kind Kind; B bool; I int64; F float64; S string }
type Env struct {
    Slots      []any
    ChangedSet []bool
    Now        time.Time
    LastChange []time.Time
    Windows    []ring
    States     []Value  // previous values of CHANGED nodes
    Context    string   // condition.description
    Stack      []Value
}
```

## Dynamic View (Logic)

- `LoadSlot(i)`: box the slot with a type switch into `Value`. `nil` gives `Unknown`.
- `Binary`: pop two, apply the operator by the kind pair, push. For `=` and `!=`, a bool with the number `1` or `0` compares as a bool, and a bool with any other number is false. A string with a number or a bool compares with the rendered text (ADR-015). Two strings order by code point. Other mismatched kinds push `Unknown`. `&` builds a string with `strings.Builder` and allocates. The compiler marks programs with `&` so the engine uses them only in Then fields.
- `Call AND/OR`: implemented by jumps. `NOT`: pop, invert, `Unknown` stays.
- `Changed(k)`: if the top of the stack is `Unknown`, push false and keep `States[k]`. Else, if `States[k]` is `Unknown`, store the value and push false. Else compare with `States[k]` by kind and value, store the value, push the result (ADR-018).
- `Stale(w)`, `Rate(w)`, `Avg(w)`: read the ring `w` (SWDD-008), push.
- `Context`: push `Env.Context` as a string.

## Interface & API Definitions

```go
func (p *Program) Eval(env *Env) Value
func (v Value) Truth() bool  // Bool true only; everything else false
```

## Error Handling & Edge Cases

- Division by zero, an integer overflow on `BITAND` inputs from a float with a fraction, and an invalid hex string give `Unknown`.
- `Unknown` in a comparison gives `Unknown`. `AND(Unknown, false)` is `false`. `OR(Unknown, true)` is `true`. Other mixes give `Unknown`.
- The stack cannot overflow: `depth` is computed at compile time and checked in `NewEngine`.

## The short-circuit and memory

`AND` and `OR` compile to a fold per argument, and each fold jumps to the end
of the call once an argument decides the answer.

A call whose arguments reserved memory keeps its folds pointing at the next
instruction instead, so every argument runs every time (ADR-023). `CHANGED`,
`PREV` and `EWMA` answer from what they saw at every evaluation, and a skipped
evaluation is a hole in that memory.

The fold carries the rule that makes this safe: an accumulator that already
decided the answer absorbs what follows it, so `AND(false, unknown)` stays
false and `OR(true, unknown)` stays true.

## Notes

ADR-011.
