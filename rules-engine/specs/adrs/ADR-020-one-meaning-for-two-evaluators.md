---
id: "ADR-020"
type: architecture_decision_record
name: "One meaning for two evaluators"
description: >
  The editor simulates a rule in TypeScript and the gateway runs it in Go. A
  shared case file holds both to one answer.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-017"
---

# Architecture Decision: One meaning for two evaluators

## Context and problem statement

The editor gained a simulator: it evaluates a rule in TypeScript over a clock
and shows an operator what the rule will do. The gateway evaluates the same
rule in Go. Two implementations of one language now exist, and a comparison
found seven answers that differed. An operator would stage a fault in the
editor, see one result, and get another on the plant.

## Key factors

- The simulator is worth having: it is how an operator checks a rule before it reaches a machine.
- A second implementation is not a defect by itself. Two implementations without a shared test are.
- The parser already has `schema/formula-cases.json`, read by both suites, and it caught a reworded message on its first merge.

## Considered options

- One shared file of evaluation cases, read by both suites.
- One implementation, compiled to WebAssembly for the editor.
- The editor calls a gateway to simulate.
- Review, and no shared test.

## Decision Outcome

Chosen option: "One shared file of evaluation cases". `schema/eval-cases.json`
holds a formula, the values of its tags over a small clock, and the answer.
Both suites read it, so neither implementation can move alone.

The seven answers were settled like this:

| Subject | Answer | Why |
|---|---|---|
| `CHANGED` | the last known value, not the previous sample | a restart and an outage are not changes (ADR-018) |
| `STALE(x)` without a duration | 4h | its signature says so; a zero window is true at once, on every field |
| `STALE` of an unknown value | true | no data at all is stale (ADR-005) |
| `RATE` with fewer than two samples | unknown | zero satisfies a "less than" threshold on a service that just started |
| two strings and `<` | code point order | the language has one comparison, not one per type |
| `&` with an unknown side | it renders as nothing | a Then field must still publish |
| a boolean against 1 or 0 | it compares as a boolean | a 0.2 rule keeps its meaning when the editor rewrites it (ADR-015) |
| a boolean against another number | false | a boolean is not the number 2, which is an answer |

### Positive Consequences

- An operator sees the same answer in the editor and on the plant.
- Four defects were found on the way, three of them in the engine.
- A case neither side satisfies is the signal that the language moved.

### Negative Consequences

- Every change to the language now costs a case and two implementations.
- The case file must stay honest: a case written to match the code proves nothing.

## Pros and Cons of the Options

### A shared file of evaluation cases

- Good, because it is the mechanism that already works for the parser.
- Good, because it fails on the commit that breaks it, in both languages.
- Bad, because it is a third place to keep current.

### One implementation through WebAssembly

- Good, because there is nothing to keep in step.
- Bad, because the editor gains a build step, a binary and a load cost, for a page that runs on a tablet.

### The editor calls a gateway

- Bad, because the editor must work without a gateway, and a simulated fault must not reach a machine.

### Review alone

- Bad, because that is the state the seven divergences came from.

## Links

- SWREQ-019, SWDD-017, and ADR-012, which chose the same mechanism for the parser.
