---
id: "SWDD-005"
type: software_detailed_design
name: "Formula front end: tokenizer, parser, printer"
description: >
  A line-by-line port of tokenize, parseFormula and printFormula from
  src/formula.ts, with the same token kinds and precedence.
satisfies:
  - "SWREQ-007"
---

# Software Implementation: Formula front end: tokenizer, parser, printer

## Overview

The Go code follows `src/formula.ts` function by function, so a reviewer can
compare them side by side. The token kinds, the precedence table and the
error messages are the same strings.

## Static View (Structure)

```mermaid
graph LR
    T[tokenize: []Token] --> P[parse: Pratt, primary + expression]
    P --> N[Node tree]
    N --> PR[Print: canonical text]
    N --> R[Refs: variables, tags, context]
    N --> CF[CheckFunctions]
    N --> IT[InferType]
```

`Token{Kind, Text, Start}`. Kinds: number, duration, string, ident, context,
bool, function, op, lparen, rparen, comma, eof. There is no lenient mode: the
engine never colors text.

## Dynamic View (Logic)

`Parse(text)`: drop a leading `=`, tokenize, then `expression(0)` with the
precedence table `& < comparisons < + - < * / < unary -`. The recursion depth
is bounded by a counter of 64. The error column is `token.Start + offset`,
where `offset` is 1 when the `=` was dropped.

## Interface & API Definitions

```go
func Parse(text string) (*Node, error)          // *Error{Message, Column}
func Print(n *Node) string
func Refs(n *Node) (variables, context []string, tags []TagRef)
func CheckFunctions(n *Node, reg Registry) []string
func InferType(n *Node, lookup func(string) Type) Type
```

## Error Handling & Edge Cases

- Duration units: `ms`, `s`, `m`, `min`, `h`. An unknown unit is `Unknown unit "x". Use ms, s, m, min, or h.` at the unit column.
- `""` inside a string is one quote. An unterminated string is `Missing closing quote.` at the opening quote.
- A depth over 64 is `The formula is too deep.` This message does not exist in the editor. The editor has no depth limit, and 64 is beyond any real formula.

## Notes

The registry is read from `schema/formula-functions.json` in tests and is a Go table in the code. A test compares them.
