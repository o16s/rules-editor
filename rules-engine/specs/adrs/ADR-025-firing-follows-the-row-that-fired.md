---
id: "ADR-025"
type: architecture_decision_record
name: "A rule without a rising edge is time-driven, and a pulse re-arms only its own row"
description: >
  EdgeNone rules evaluate on every call, and the edge re-arm follows the row
  that made the rule true rather than any row that reads CHANGED.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-003"
---

# Architecture Decision: A rule without a rising edge is time-driven, and a pulse re-arms only its own row

## Context and problem statement

Two faults in how a rule decides to fire, both found by running the engine
behind the editor's Simulator page.

**A rule without a rising edge went quiet.** `EdgeNone` is documented as firing
on every evaluation where the condition is true, subject to the cooldown. A
rule was only evaluated when one of its inputs moved, so with a steady value it
fired once and never again, whatever its cooldown said.

**A level behaved like a pulse.** A pulse row is true only in the evaluation
where its input moved, and is never seen as false, so a rule that fires on one
has to re-arm its edge or it fires once and stops. The engine re-armed whenever
any row anywhere read `CHANGED`. A rule whose level rose once then fired again
at the end of every cooldown, for as long as the level stood.

## Key factors

- A rule that fires when it must not is as bad as one that does not fire when it must, and it is louder.
- The change-driven index is what keeps a thousand rules cheap on a gateway. It must survive for the rules that can use it.
- `edge="rising"` is what the three service examples use, and it is the common case.

## Considered options

- Mark a rule as time-driven when it has no rising edge, and re-arm from the row that fired.
- Evaluate every rule on every call.
- Change what EdgeNone means, to what the engine did.

## Decision Outcome

Chosen option: "Mark a rule as time-driven when it has no rising edge, and
re-arm from the row that fired."

A rule joins the time-driven set when it reads a clock or when its edge is
`EdgeNone`. A rule with a rising edge keeps the change-driven index, because it
can only fire when something moves.

The row model carries whether a row reads `CHANGED`. The result of an "any"
rule is a pulse when the first true row is one; the result of an "all" rule is
a pulse when any of its rows is, because they are all true together. Only that
decides the re-arm.

### Positive Consequences

- `EdgeNone` does what its documentation says.
- A rule that mixes a level and a pulse fires once per level and once per pulse, which is what an operator wrote.
- The optimisation stays where it is sound.

### Negative Consequences

- An `EdgeNone` rule now evaluates on every call. That is its documented meaning, and it is the rarer form.

## Pros and Cons of the Options

### Time-driven when there is no rising edge

- Good, because each rule pays for what it asks for.
- Bad, because the cost of an EdgeNone rule is no longer proportional to its data.

### Evaluate everything every time

- Bad, because it gives up the index for every rule to fix two shapes.

### Redefine EdgeNone

- Bad, because "fires while true" is what an operator means by leaving the edge off.

## Links

- SWREQ-003, SWDD-003, ADR-004, ADR-018.
