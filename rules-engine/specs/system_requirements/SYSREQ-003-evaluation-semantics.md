---
id: "SYSREQ-003"
type: system_requirement
name: "Rule evaluation semantics"
description: >
  Edge, cooldown and the CHANGED pulse behave the same on every service and as
  the documentation states.
specification: >
  The engine must evaluate a rule when one of its input slots changed. It must
  apply `edge` and `cooldown` as specified in this document. It must re-arm a
  rule after a `CHANGED()` pulse.
derives_from:
  - "SCEN-001"
  - "SCEN-003"
  - "SCEN-004"
---

# System Requirement: Rule evaluation semantics

## Requirement Specification

> The engine must evaluate a rule when one of its input slots changed. It must apply `edge` and `cooldown` as specified in this document. It must re-arm a rule after a `CHANGED()` pulse.

## Rationale

The three engines disagree on the pulse case today. Operators write rules
against the documented behavior, not against one service.

## Acceptance Criteria

- `edge="none"`: the rule fires on every evaluation where the condition is true and the cooldown is not active.
- `edge="rising"`: the rule fires when the result is true and the previous result was false, and the cooldown is not active.
- `cooldown`: after a firing, the rule does not fire again for the duration. The cooldown applies to actions and to the incident trigger. It never applies to a resolve.
- A rising edge inside the cooldown is consumed. The rule does not fire when the cooldown expires (ADR-004).
- After a true result of a rule whose condition contains `CHANGED()` or `changed`, the previous result is reset to false.
- A rule without a slot change and without a time function is not evaluated.

## Verification Plan

- **Method**: test.
- **Procedure**: The engine tests use a fixed clock passed to `Eval`. The tests cover each criterion, with the tsend2mqtt tests for the pulse case.

## Notes

The pitfall "cooldown consumes the edge" and the two-rule workaround stay
documented in the library README.
