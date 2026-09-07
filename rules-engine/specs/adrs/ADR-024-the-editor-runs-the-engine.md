---
id: "ADR-024"
type: architecture_decision_record
name: "The editor runs the engine, compiled to WebAssembly"
description: >
  The Simulator page loads the gateway's engine instead of a second
  implementation of the same rules in TypeScript.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-017"
supersedes:
  - "ADR-020"
---

# Architecture Decision: The editor runs the engine, compiled to WebAssembly

## Context and problem statement

ADR-020 held two implementations of one language together with a file of
shared cases. It found four faults, so the mechanism worked. It also cost a
second reading of every decision, and it let the two drift wherever a case was
missing: the window model differed for the whole life of v0.3.1, and the case
file avoided every series where that showed.

The Simulator page exists to tell an operator what a file will do on the plant.
A page that answers from its own reading of the rules cannot promise that.

## Key factors

- The promise of the page is fidelity. Two implementations can only approximate it.
- The engine is Go and the page is TypeScript, but Go compiles to WebAssembly, and the module has no dependency to carry across.
- A cross-check has value, and giving it up is a real cost.
- The page needs the tokenizer, the parser and the error positions on every keystroke, and those must stay synchronous.

## Considered options

- The page runs the engine, compiled to WebAssembly.
- Two implementations, held by more cases than before.
- One implementation in TypeScript, with the gateway calling it.

## Decision Outcome

Chosen option: "The page runs the engine, compiled to WebAssembly."

`rules-engine/cmd/wasm` builds the engine for the browser. The page hands it
the fields a service decodes, one reading per field per step, and the rule as a
`rules.xml` document. It answers with every line of the timeline, what the rule
fired, and any problem the file has. The firing comes from `Load` and `Engine`
themselves, so edge, cooldown, the incident lifecycle and the rendered payloads
are the gateway's.

`src/formula.ts` keeps the tokenizer, the parser, the printer and the static
checks, because the cells need them on every keystroke and cannot wait for a
call. It no longer evaluates anything.

The shared cases stay. They are the written answer the engine must give, and
running them in the page proves the module there is the module the Go suite
tested.

### Positive Consequences

- What the page draws is what the plant does, including the startup resolve, the cooldown and the rendered payloads.
- Adding a function is one implementation, not two.
- Swapping the page onto the engine found four more faults in a day.

### Negative Consequences

- The cross-check is gone. One implementation compiled twice is always self-consistent, including when it is wrong. The shared cases are now a specification test, written by hand, rather than a second opinion.
- The package carries a 3.9 MB binary, committed beside `dist/` as `dist/` already is. A contributor who touches the engine needs Go; one who touches only TypeScript does not.
- `simulate()` is asynchronous, which is a breaking change to the package.
- The page draws an empty run until the module has loaded, about 90 ms.

## Pros and Cons of the Options

### The page runs the engine

- Good, because the page and the plant cannot disagree.
- Bad, because the second opinion is gone, and because the package gains a binary and a build step.

### Two implementations, more cases

- Good, because two readings catch what one misses.
- Bad, because the gap is whatever nobody thought to write a case for, which is exactly where the last four faults were.

### One implementation in TypeScript

- Bad, because a gateway on a 32-bit ARM box does not run a JavaScript engine, and the Power of Ten rules do not apply to one.

## Links

- Supersedes ADR-020. SWREQ-019, SWDD-017, SWREQ-012.
