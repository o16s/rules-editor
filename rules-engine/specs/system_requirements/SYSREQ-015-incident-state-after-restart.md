---
id: "SYSREQ-015"
type: system_requirement
name: "Incident state after a service restart"
description: >
  At startup every incident rule counts as active. The first evaluation emits
  a trigger or a resolve.
specification: >
  At startup, the engine must treat every incident rule as active with no
  previous result. The first evaluation of such a rule must emit a trigger
  when the condition is true, and a resolve when it is false.
derives_from:
  - "SCEN-014"
depends_on:
  - "SYSREQ-004"
---

# System Requirement: Incident state after a service restart

## Requirement Specification

> At startup, the engine must treat every incident rule as active with no previous result. The first evaluation of such a rule must emit a trigger when the condition is true, and a resolve when it is false.

## Rationale

A restart loses the incident state. Without this rule, an incident whose
cause disappeared during the restart stays open forever. A resolve for an
incident that is not open is a no-op for the forwarder. A trigger for an
incident that is open is a duplicate for the forwarder.

## Acceptance Criteria

- On a fresh engine, a first evaluation with a true condition emits one trigger.
- On a fresh engine, a first evaluation with a false condition emits one resolve.
- A rule whose slots never change is not evaluated and emits nothing.
- After the first evaluation, SYSREQ-004 applies without a change.
- `Reset` keeps its behavior of SYSREQ-014.

## Verification Plan

- **Method**: test.
- **Procedure**: Two `Eval` tests on a fresh engine. A replay test that starts with a false condition and expects one resolve per incident rule.

## Notes

This is a behavior change for all three services, listed in SWREQ-017. The
alternatives are in ADR-014.
