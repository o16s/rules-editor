---
id: "UC-004"
type: use_case
name: "Express conditions as formulas"
description: >
  An operator writes variables and formula rows in the editor, and the service
  evaluates them with the documented meaning.
refines:
  - "SOL-001"
---

# Use Case: Express conditions as formulas

## Actor(s)

- **Primary Actor**: The operator who writes formulas in the editor.
- **Secondary Actors**: The editor, which validates the formula, and the engine, which evaluates it.

## Pre-conditions

- The editor is at version 0.3 or later and writes `<cond expr="..."/>`.
- The service uses the shared engine.

## Main Success Outcome

The operator writes named variables and formula rows. The service evaluates
each formula with the meaning that the editor documents in its README. Time
window functions give the operator alerts on stale data and on rates of
change without a second tool.

## Key Functional Scope

- **Values**: `TAG("tag")`, `TAG("device", "tag")`, variables, numbers, strings, booleans, durations.
- **Logic**: `AND`, `OR`, `NOT`, comparisons.
- **Events**: `CHANGED(x)`.
- **Time**: `STALE(x, d)`, `RATE(x, w)`, `AVG(x, w)`.
- **Bits**: `BITAND`, `BITOR`, `BITXOR`, `HEX2DEC`.
- **Text**: `&` joins strings. Then fields that start with `=` are formulas. `condition.description` names the row that fired.

## Post-conditions

- **Success Condition**: A formula that the editor accepts loads on the service and gives the documented result.
- **Failure Condition**: The service refuses the file at startup with a problem that names the formula and the column.
