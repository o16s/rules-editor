---
id: "SWREQ-004"
type: software_requirement
name: "Incident state machine and Reset"
description: >
  Each incident rule has an active flag. Trigger sets it, resolve clears it.
  Reset resolves every active incident.
specification: >
  For each rule with an incident, the engine must keep an active flag. It must
  emit a trigger on a cooled-down rising edge, and a resolve on a falling edge
  only while active. `Reset` must resolve every active incident and clear
  every edge state, and must not change the cooldown timers.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-003"
---

# Software Requirement: Incident state machine and Reset

## Requirement Specification

> For each rule with an incident, the engine must keep an active flag. It must emit a trigger on a cooled-down rising edge, and a resolve on a falling edge only while active. `Reset` must resolve every active incident and clear every edge state, and must not change the cooldown timers.

## Rationale

SYSREQ-004 and SYSREQ-014 at the level of one rule.

## Logic & Interface Details

```go
func (e *Engine) Reset(now time.Time) []Incident
```

State per rule: `prev bool`, `lastFired time.Time`, `active bool`, and for
a formula `source` the rendered source ID of the trigger.

| Event | Condition | Effect |
|---|---|---|
| rising edge | `cooledDown` | `lastFired = now`, `active = true`, emit trigger |
| rising edge | not `cooledDown` | nothing (edge consumed) |
| falling edge | `active` | `active = false`, emit resolve |
| falling edge | not `active` | nothing |
| `Reset` | `active` | `active = false`, `prev = false`, emit resolve |
| `Reset` | not `active` | `prev = false` |

The trigger carries `Severity`, `Summary`, `FirstStep`, `Cause`. The resolve
carries the same `Rule`, `Source` and `DedupKey` and nothing else.

## Acceptance Criteria

- The five incident tests of iolinkmaster2mqtt and the two `Reset` tests of tsend2mqtt pass.
- After `Reset`, `lastFired` of every rule is unchanged.
- A rule with `edge="none"` and an incident triggers once per false-to-true transition, not on every true evaluation.

## Verification Plan

- **Method**: test.
- **Procedure**: The named tests, plus a test that sets `edge="none"` on an incident rule.

## Notes

A pulse condition (`CHANGED` only) triggers on every change and never
resolves. The README documents it.
