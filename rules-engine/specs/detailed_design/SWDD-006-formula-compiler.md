---
id: "SWDD-006"
type: software_detailed_design
name: "Formula compiler: program, binding and typing"
description: >
  The compiler inlines variables, binds TAG to slots, infers types, folds
  constants and emits a post-order instruction array.
satisfies:
  - "SWREQ-008"
---

# Software Implementation: Formula compiler: program, binding and typing

## Overview

`Compile` turns one `Node` tree into one `Program`. The program is an array
of instructions in post-order. Each instruction has an opcode and one
operand. The compiler computes the maximum stack depth and the flags the
engine needs.

## Static View (Structure)

```go
type op uint8 // PushConst, LoadSlot, Changed, Stale, Rate, Avg, Context, Call, Unary, Binary, JumpIfFalse, JumpIfTrue
type instr struct { op op; a int32; b int32 }
type Program struct {
    code     []instr
    consts   []Value
    depth    int
    slots    []int   // referenced slot indexes
    changed  int     // number of CHANGED nodes (state indexes 0..n-1)
    windows  []windowSpec // slot + duration per STALE/RATE/AVG node
    HasChanged, HasTime bool
    Type     Type
}
```

## Dynamic View (Logic)

1. Inline: replace every `Ref` with the tree of its variable. Detect a cycle with a visiting set. The result is bounded by 64 variables.
2. Bind: every `Call TAG` with literal arguments becomes `LoadSlot(i)` with the type from the `Resolver`. Any other `TAG` is a problem.
3. Type: `InferType` with the slot types. A condition of type number, string or duration is a problem.
4. Fold: a `Call` or `Binary` whose operands are all constants is evaluated once and replaced by `PushConst`.
5. Emit: post-order. `AND` and `OR` emit `JumpIfFalse` or `JumpIfTrue` for the short circuit. `CHANGED` gets a state index. `STALE`, `RATE`, `AVG` get a window index.
6. Depth: a simulated stack over the code gives `depth`.

## Interface & API Definitions

```go
type Resolver interface { Slot(device, tag string) (int, Type, bool) }
func Compile(n *Node, vars map[string]*Node, r Resolver, allowContext bool) (*Program, []string)
```

The `rules` package implements `Resolver` over the `Catalog`.

## Error Handling & Edge Cases

- The messages are those of `src/parse.ts` where one exists.
- A `TAG` inside `STALE`, `RATE` or `AVG` must be direct or through a variable. `RATE(temp + 1, 10min)` is a problem: "RATE needs a field, not an expression".
- `condition.description` is allowed only when `allowContext` is true.

## Notes

ADR-011.
