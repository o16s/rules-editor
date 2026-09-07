---
id: "SYSREQ-004"
type: system_requirement
name: "Incident lifecycle"
description: >
  An incident triggers once on the rising edge, resolves once on the falling
  edge, and never resolves without a trigger.
specification: >
  For a rule with an `<incident>`, the engine must emit one trigger on a
  rising edge outside the cooldown and mark the incident active. It must emit
  one resolve on a falling edge, only while the incident is active.
derives_from:
  - "SCEN-002"
  - "SCEN-005"
  - "SCEN-006"
depends_on:
  - "SYSREQ-003"
---

# System Requirement: Incident lifecycle

## Requirement Specification

> For a rule with an `<incident>`, the engine must emit one trigger on a rising edge outside the cooldown and mark the incident active. It must emit one resolve on a falling edge, only while the incident is active.

## Rationale

The forwarder matches a resolve to a trigger by `dedup_key`. A resolve without
a trigger is noise. A missing resolve leaves a page open.

## Acceptance Criteria

- One trigger per false-to-true transition outside the cooldown.
- One resolve per true-to-false transition while active. Never a resolve while not active.
- The lifecycle does not depend on the `edge` attribute of the rule.
- A resolve is never delayed by the cooldown.
- The trigger carries `severity`, `summary`, and the optional `first_step` and `cause`. The resolve carries none of them.
- The `dedup_key` of the resolve equals the `dedup_key` of the trigger.

## Verification Plan

- **Method**: test.
- **Procedure**: The tests `TestEngine_IncidentTrigger`, `TestEngine_IncidentResolve`, `TestEngine_IncidentStillTrue`, `TestEngine_IncidentCooldownSuppressesTrigger` and `TestEngine_ResolveNeverSuppressedByCooldown`.

## Notes

tsend2mqtt today rejects `edge="none"` on an incident rule and sends orphan
resolves. Both behaviors end with this requirement.
