---
id: "ADR-023"
type: architecture_decision_record
name: "A short-circuit never skips a function that carries memory"
description: >
  AND and OR keep every argument running when one of them remembers something,
  and a decided accumulator absorbs what follows it.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-007"
---

# Architecture Decision: A short-circuit never skips a function that carries memory

## Context and problem statement

`AND` and `OR` jump out of a call once an argument decides the answer. That is
what makes them short-circuit, and it is what an operator expects of them.

`CHANGED` answers from the value it saw at the previous evaluation. An
evaluation it was skipped on is a hole in that memory, and the next reading it
does see looks like the first one the engine ever saw. The first known value is
not a change, so the rule stays quiet.

An operator meets this as a rule that does not fire:

```
AND(TAG("gate"), CHANGED(TAG("code")))
```

with the code moving from 1 to 2 at the moment the gate opens. `CHANGED`
remembers nothing from while the gate was shut, so it answers false.

`PREV` and `EWMA` carry memory for the same reason and would have inherited the
same hole.

## Key factors

- A rule that is quiet when it must fire is the worst kind of fault: nothing looks wrong.
- The short-circuit is an optimisation. Correctness is not.
- Most rules have no argument that remembers anything, and they must keep the optimisation.

## Considered options

- Keep every argument running when one of them carries memory.
- Evaluate the memory-carrying arguments first, before the fold.
- Document the hole and tell operators to write two rules.

## Decision Outcome

Chosen option: "Keep every argument running when one of them carries memory."

The compiler knows which arguments reserved memory, because reserving it is
what compiling them does. A call whose arguments reserved any keeps its folds
pointing at the next instruction instead of at the end, so every argument runs
every time. A call with no such argument is unchanged.

The fold gains the rule that makes this safe: an accumulator that already
decided the answer absorbs what follows it, so `AND(false, unknown)` stays
false and `OR(true, unknown)` stays true.

### Positive Consequences

- A rule that gates a pulse behind a level fires when the pulse happens.
- `PREV` and `EWMA` are correct in the same places `CHANGED` is.
- A rule with no memory keeps the short-circuit.

### Negative Consequences

- A call that mixes a cheap level with an expensive memory function evaluates both every time. Nothing in the language is expensive enough for that to matter.

## Pros and Cons of the Options

### Keep every argument running

- Good, because the memory has no holes and the answer is unchanged.
- Bad, because a rule with memory loses an optimisation it cannot afford to keep.

### Evaluate the memory arguments first

- Good, because the short-circuit survives.
- Bad, because it reorders what an operator wrote, and the order of the rows is what the log reports.

### Document the hole

- Bad, because it asks an operator to know the shape of the compiler.

## Links

- SWREQ-009, SWDD-007, ADR-018.
