---
id: "SWREQ-008"
type: software_requirement
name: "Formula static checks and compilation"
description: >
  Every formula is checked as the editor checks it, bound to slots, typed, and
  compiled to a program at Load.
specification: >
  The `formula` package must do the static checks of the editor, inline
  variables, bind `TAG` calls to slots, and infer types. It must reject a non-
  boolean condition. It must compile each formula to a post-order program with
  a known stack depth.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-007"
---

# Software Requirement: Formula static checks and compilation

## Requirement Specification

> The `formula` package must do the static checks of the editor, inline variables, bind `TAG` calls to slots, and infer types. It must reject a non-boolean condition. It must compile each formula to a post-order program with a known stack depth.

## Rationale

Every fault must appear at `Load`. Nothing is parsed or resolved at `Eval`.

## Logic & Interface Details

```go
type Resolver interface {
    Slot(device, tag string) (index int, typ Type, ok bool)
}
type Program struct { /* instructions, constants, stack depth, flags */ }
func Compile(n *Node, vars map[string]*Node, r Resolver, allowContext bool) (*Program, []string)
```

Checks, with the messages of `src/parse.ts`:

- Unknown function, wrong argument count (`checkFunctions`).
- A reference that is not a variable of the rule.
- A variable named like a function, `TRUE`, `FALSE` or `CONDITION`, in any case (`RESERVED_NAMES` of the editor).
- A context name other than `condition.description`, or a context name outside a Then field.
- A variable cycle, reported once at the variable where the cycle starts.
- A condition of type number, string or duration: "must be true or false, but is a ...".
- A `TAG` with a non-literal argument, or an unknown device or tag.
- `BITAND`, `BITOR`, `BITXOR`, `HEX2DEC` with a literal argument of the wrong type.

Compilation:

- Variables are inlined by substitution. The depth after inlining is bounded by 64 variables and the parser depth.
- `TAG` becomes a `LoadSlot(i)` instruction. `CHANGED(x)` becomes a node with a state index. `STALE`, `RATE`, `AVG` become nodes with a window index.
- Constant subexpressions fold at compile time, `HEX2DEC("FF")` included.
- The program records `HasChanged`, `HasTime`, the referenced slots, and the maximum stack depth.

## Acceptance Criteria

- Every validation message of `src/parse.test.ts` that concerns a formula has a Go counterpart with the same words.
- A condition that uses `condition.description` is a problem. A summary that uses it compiles.
- The compiled program of `TAG("d","t") > 50` equals the program of `<cond device="d" tag="t" op="gt" value="50"/>`.

## Verification Plan

- **Method**: test.
- **Procedure**: Table tests over the shared cases, plus tests per check with a fake `Resolver`.

## Notes

The AST stays for `Print`. The program is the runtime form (ADR-011).
