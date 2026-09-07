---
id: "SYSREQ-014"
type: system_requirement
name: "Reset on transport loss"
description: >
  A service that loses its data transport resolves the active incidents on
  reconnect and keeps the cooldowns.
specification: >
  A service that receives data over one connection must call `Reset` when the
  connection is established again. `Reset` must resolve every active incident,
  clear the edge state of every rule, and keep every cooldown timer.
derives_from:
  - "SCEN-006"
depends_on:
  - "SYSREQ-004"
---

# System Requirement: Reset on transport loss

## Requirement Specification

> A service that receives data over one connection must call `Reset` when the connection is established again. `Reset` must resolve every active incident, clear the edge state of every rule, and keep every cooldown timer.

## Rationale

After a reconnect the engine cannot know the current state of the source. An
incident that was open before the loss needs a new trigger to stay open.

## Acceptance Criteria

- `Reset` returns one resolve per active incident and no other output.
- After `Reset`, a true condition produces a rising edge on the next `Eval`.
- A cooldown that was active before `Reset` is still active after it.

## Verification Plan

- **Method**: test.
- **Procedure**: `TestEngineReset_ResolvesActiveIncidents` and `TestEngineReset_NothingActiveReturnsEmpty`.

## Notes

tsend2mqtt has this behavior today. The polling services have no transport
reconnect and use SYSREQ-011 instead.
