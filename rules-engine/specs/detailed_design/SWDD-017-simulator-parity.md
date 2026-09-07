---
id: "SWDD-017"
type: software_detailed_design
name: "The engine in the browser"
description: >
  cmd/wasm, the loader in src/engine.ts, and what the page still owns.
satisfies:
  - "SWREQ-019"
---

# Software Implementation: The engine in the browser

## Overview

One Go entry point, one TypeScript loader, and a page that draws.

## Static View (Structure)

```
rules-engine/cmd/wasm/main.go    the request, the response, the engine
rules-engine/cmd/wasm/probe.go   one line per variable and per row
rules-engine/rules/simresolver.go  compile and evaluate against the engine's history
scripts/build-engine.sh          GOOS=js GOARCH=wasm, plus Go's wasm_exec.js
dist/rules-engine.wasm           committed, about 3.9 MB
src/engine.ts                    loads once, in a browser or in Node
src/simulate.ts                  signals, the request, the log wording
```

`main.go` exposes one function, `octaviewRulesSimulate(requestJSON) string`.
`probe.go` compiles each variable and each row on its own, so a row that does
not compile keeps its place and carries its problem. It applies the same
boolean check the loader applies, so the page refuses a numeric condition with
the same words the gateway uses.

`rules.SimResolver` gives the probe the engine's own `history`, so the lines
and the firing advance the past identically. It adds no behavior.

## Dynamic View (Logic)

```mermaid
sequenceDiagram
    participant P as Simulator page
    participant S as src/simulate.ts
    participant W as rules-engine.wasm
    P->>S: simulate(rule, signals)
    S->>S: generate one series per tag
    S->>W: fields, readings per step, variables, rows, rule XML
    W->>W: probe compiles the lines; Load and Engine take the rule
    W->>W: for each step: advance the history, evaluate, Eval
    W-->>S: lines, result, firings, problems
    S->>S: word the log
    S-->>P: Simulation
```

## Interface & API Definitions

`loadEngine()` reads the two files and starts the module once. In a browser it
fetches them; under Node it reads them from `dist/`, because a test runner
rewrites `import.meta.url` to its own address. `engineAssets` lets a host that
serves the package from elsewhere say where they are.

`SimulatorHandle` gained `ready()` and an awaitable `setRule()`.

## Error Handling & Edge Cases

- The module never panics into JavaScript: a fault comes back as a message in the response.
- A rule file with a problem gives no engine, and the page still draws its lines.
- A simulator must not refuse a device the operator has but has not wired into this run, so the page sends the sources the rule names.

## Notes

ADR-024. The page keeps the signal generators, which exist only to make test
data, and the wording of the log. Every fact in the log comes from the engine.
