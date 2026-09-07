---
id: "ADR-015"
type: architecture_decision_record
name: "Comparison rules for mixed types"
description: >
  A boolean compared with 0 or 1, and a string compared with a number or a
  boolean, follow the 0.2 behavior instead of the strict Unknown result.
status: proposed
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-007"
---

# Architecture Decision: Comparison rules for mixed types

## Context and problem statement

The editor rewrites a 0.2 `<cond tag="B" op="eq" value="1"/>` to the formula
`TAG("B") = 1`, and `value="true"` on a string field to `TAG("S") = true`.
The editor has no catalog, so it cannot know the field type. The 0.2 parser
read `1` on a boolean field as `true`, and compared a string field with the
raw text. A strict evaluator gives `Unknown` for both, so a file changes
meaning when the editor saves it.

## Key factors

- A saved 0.3 file must keep the meaning of the 0.2 file it came from.
- The 0.2 documentation lists `1` and `0` as boolean values.

## Considered options

- Strict: a comparison between different kinds is `Unknown`.
- Coerce in the engine: a boolean compared with a number reads `1` as `true` and `0` as `false`. A string compared with a number or a boolean compares with the text form of that value.
- Fix the editor: `literalOf` uses the catalog type when the host supplies one.

## Decision Outcome

Chosen option: "Coerce in the engine", and also "Fix the editor" as an editor work item (SWREQ-018). The engine rule protects files that the editor already saved. The editor fix removes the ambiguity for new files.

### Positive Consequences

- A 0.2 file and its 0.3 rewrite give the same results.
- `TAG("B") = 1` reads as the operator meant it.

### Negative Consequences

- Two more rows in the comparison table of SWREQ-009.
- `TAG("B") = 2` is `Unknown`. The README documents the coercion.

## Pros and Cons of the Options

### Strict

- Good, because it is simple and matches the type inference of the editor.
- Bad, because it breaks saved files.

### Coerce in the engine

- Good, because it keeps the 0.2 meaning.
- Bad, because the rules need documentation.

### Fix the editor

- Good, because new files are unambiguous.
- Bad, because it does not help files that were saved already, and the catalog is optional in the editor.

## Links

- SWREQ-009, SWDD-007, SWREQ-018.
