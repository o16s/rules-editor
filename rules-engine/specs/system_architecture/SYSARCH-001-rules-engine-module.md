---
id: "SYSARCH-001"
type: system_architecture
name: "The rules-engine module"
description: >
  One Go module in the rules-editor repository with three packages: rulesxml,
  rules and formula.
platform: "Go 1.24, linux/arm/v7 and linux/arm64, static binaries"
satisfies:
  - "SYSREQ-001"
  - "SYSREQ-002"
  - "SYSREQ-003"
  - "SYSREQ-004"
  - "SYSREQ-005"
  - "SYSREQ-006"
  - "SYSREQ-008"
  - "SYSREQ-009"
  - "SYSREQ-012"
  - "SYSREQ-014"
  - "SYSREQ-016"
---

# Architecture: The rules-engine module

## Technical Strategy

The module lives next to the XSD, the fixtures and the formula language that
define the format. One commit changes the format and the engine together. The
three packages separate the structure of the file, the binding to a service,
and the formula language.

## Static View (Structure)

```mermaid
graph TD
    subgraph repo["rules-editor repository"]
        xsd["schema/rules.xsd"]
        fx["schema/fixtures/**"]
        fc["schema/formula-cases.json<br/>schema/formula-functions.json"]
        ts["src/formula.ts, src/parse.ts (editor)"]
        subgraph mod["rules-engine (Go module)"]
            rx["rulesxml<br/>structure, every problem, paths"]
            rl["rules<br/>Catalog, Load, Engine, Action, Incident"]
            fm["formula<br/>tokenizer, parser, compiler, evaluator"]
        end
    end
    rl --> rx
    rl --> fm
    xsd -.tests.-> rx
    fx -.tests.-> rx
    fc -.tests.-> fm
    fc -.tests.-> ts
```

- `rulesxml` walks the XML tokens with fixed tables of elements and attributes. It knows the 0.3 vocabulary.
- `rules` binds a document to a `Catalog`, builds the `Engine`, and returns `Action` and `Incident` values.
- `formula` parses a formula to an AST, does the static checks, compiles the AST to a program, and evaluates the program.
- The test files read `../../schema/...` with `os.ReadFile`.

## Dynamic View (Behavior)

```mermaid
sequenceDiagram
    participant S as Service (startup)
    participant L as rules.Load
    participant X as rulesxml.Validate
    participant F as formula
    S->>L: Load(data, Catalog)
    L->>X: Validate(data)
    X-->>L: []Problem
    alt problems
        L-->>S: nil, problems
    else no problems
        L->>L: unmarshal, resolve device.tag, parse values
        L->>F: parse, check, inline variables, bind TAG, compile
        F-->>L: programs or problems
        L-->>S: []Rule, nil
    end
    S->>S: NewEngine(rules, Catalog)
```

## Versions and tags

- Module path `github.com/o16s/rules-editor/rules-engine`. Tags `rules-engine/vX.Y.Z`.
- `X.Y` follows the schema version. `rules-engine/v0.3.x` implements schema 0.3.
- `go 1.24`, no dependencies.
