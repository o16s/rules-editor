---
id: "SWREQ-019"
type: software_requirement
name: "The editor's simulator runs the engine"
description: >
  The Simulator page loads the engine compiled to WebAssembly and draws its
  answer, instead of evaluating the rules itself.
specification: >
  The editor must evaluate no rule of its own. The Simulator page must load
  `dist/rules-engine.wasm` and draw what it answers, including the firing, the
  cooldown, the incident lifecycle and the rendered Then fields.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-012"
---

# Software Requirement: The editor's simulator runs the engine

## Requirement Specification

> The editor must evaluate no rule of its own. The Simulator page must load `dist/rules-engine.wasm` and draw what it answers, including the firing, the cooldown, the incident lifecycle and the rendered Then fields.

## Rationale

The page exists to tell an operator what a file will do on the plant. A page
that answers from its own reading of the rules can only approximate that, and
did: the window model differed for the whole life of v0.3.1 (ADR-022, ADR-024).

## Logic & Interface Details

- `rules-engine/cmd/wasm` builds the engine for the browser. `npm run build:engine` writes `dist/rules-engine.wasm` and `dist/wasm_exec.js`, and both are committed, as `dist/` already is.
- The page sends the fields a service decodes, one reading per field per step, the variables and the condition rows, the sources an incident may name, how the rows combine, and the rule as a `rules.xml` document.
- The engine answers with every line of the timeline, the combined result, what the rule fired, and any problem the file has. The firing comes from `Load` and `Engine`, so edge, cooldown, the incident lifecycle and the rendered payloads are the gateway's.
- A formula that does not compile keeps its place in the timeline and carries its problem, so the page draws the rest while an operator is typing.
- `src/formula.ts` keeps the tokenizer, the parser, the printer and the static checks. The cells need them on every keystroke and cannot wait for a call. It evaluates nothing.
- `simulate()` is asynchronous. The page draws an empty run until the module has loaded, and a newer run wins over one still in flight.

## Acceptance Criteria

- `src/simulate.ts` contains no evaluator, no edge or cooldown logic, and no Then renderer.
- Every case in `../schema/eval-cases.json` passes through the module in the editor's suite.
- The page shows the startup resolve, the cooldown and the payloads the engine rendered.
- A rule file with a fault shows the fault, in the words the service logs.

## Verification Plan

- **Method**: test.
- **Procedure**: `src/engine.test.ts` loads the module under jsdom and checks its answers. `src/simulate.test.ts` and `src/simulator.test.ts` drive the page through it.

## Notes

ADR-024. This requirement replaces the parity arrangement of ADR-020: there is
one implementation now, and the shared cases are its specification test rather
than a second opinion.
