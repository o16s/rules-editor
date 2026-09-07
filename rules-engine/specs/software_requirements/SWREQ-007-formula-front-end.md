---
id: "SWREQ-007"
type: software_requirement
name: "Formula tokenizer and parser"
description: >
  The formula package parses the language of src/formula.ts to the same AST,
  with the same errors at the same columns.
specification: >
  The `formula` package must tokenize and parse the language of
  `src/formula.ts` into an AST. It must print the AST to the same canonical
  text as `printFormula`. It must report a parse error at the same column as
  the editor.
derives_from:
  - "SYSARCH-001"
---

# Software Requirement: Formula tokenizer and parser

## Requirement Specification

> The `formula` package must tokenize and parse the language of `src/formula.ts` into an AST. It must print the AST to the same canonical text as `printFormula`. It must report a parse error at the same column as the editor.

## Rationale

The editor and the engine must read one formula the same way. A shared
case file proves it.

## Logic & Interface Details

```go
type Kind uint8 // Number, String, Bool, Duration, Ref, Context, Call, Unary, Binary
type Node struct {
    Kind Kind; Num float64; Str string; Boolean bool; Seconds float64
    Op string; Name string; Args []*Node
}
type Error struct { Message string; Column int }
func Parse(text string) (*Node, error)
func Print(n *Node) string
```

Language, as in `formula.ts`:

- Literals: numbers, `"strings"` with `""` as one quote, `true` and `false` in any case, durations with units `ms`, `s`, `m`, `min`, `h`.
- Identifiers are variable references. A dotted name such as `condition.description` is a context reference.
- A function name is an identifier followed by `(`. Names are case-insensitive and print upper-case.
- Binary operators by precedence, lowest first: `&`, then `= == != <> < <= > >=`, then `+ -`, then `* /`. Unary `-` binds tightest. `==` prints as `=`, `<>` as `!=`.
- A leading `=` is accepted and dropped.
- The parser is recursive at `Load` only, with a depth limit of 64.

## Acceptance Criteria

- Every case in `schema/formula-cases.json` gives the same canonical print or the same error column in Go and in TypeScript.
- `Print(Parse(Print(Parse(x))))` equals `Print(Parse(x))` for every case.

## Verification Plan

- **Method**: test.
- **Procedure**: A table test over the shared case file, in both suites.

## Notes

The 19 test groups of `src/formula.test.ts` are the seed of the case file.
