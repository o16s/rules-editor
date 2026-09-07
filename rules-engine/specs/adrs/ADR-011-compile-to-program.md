---
id: "ADR-011"
type: architecture_decision_record
name: "Compile formulas to a post-order program, no recursion at runtime"
description: >
  Every formula compiles at Load into an instruction array. Eval walks it with
  a fixed-size value stack.
status: proposed
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-006"
  - "SWDD-007"
---

# Architecture Decision: Compile formulas to a post-order program, no recursion at runtime

## Context and problem statement

The Power of Ten rules forbid recursion and allocation on the hot path. An AST evaluator recurses. How does the engine evaluate a formula?

## Key factors

- Formula depth is bounded by the parser at `Load`.
- The value stack size is known after compilation.

## Considered options

- A post-order instruction array and a value stack per rule.
- A recursive AST walker.
- A closure tree.

## Decision Outcome

Chosen option: "A post-order instruction array", because the walk is a bounded loop with no recursion and no allocation.

### Positive Consequences

- Every bound is a constant or a compiled length.
- The compiler can constant-fold `HEX2DEC` and literal arithmetic.

### Negative Consequences

- A second representation next to the AST. The printer stays on the AST.

## Pros and Cons of the Options

### Instruction array

- Good, because it obeys the coding rules.
- Bad, because it is more code than a walker.

### AST walker

- Good, because it is short.
- Bad, because it recurses.

### Closures

- Bad, because it uses function values, which the rules limit.

## Links

- PLAN.md, section 4.5.
