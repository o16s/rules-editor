---
id: "SCEN-006"
type: scenario
name: "PLC reconnects and stale incidents resolve"
description: >
  The TCP connection from the PLC drops and returns. Active incidents resolve,
  and cooldown timers survive.
refines:
  - "UC-002"
---

# Scenario: PLC reconnects and stale incidents resolve

## Overview

tsend2mqtt receives frames over one TCP connection. After a reconnect the
engine cannot know the state of the PLC. This path shows the `Reset` call.

## Initial State

- Two rules are loaded. `alarm-camera` has an active incident. `any-alert` has actions only and fired 10 s ago with `cooldown="45s"`.

## Trigger

The TCP connection drops. The PLC connects again 20 s later.

## Step-by-Step Flow

1. [Reaction]: On the new connection, the service publishes `{"online":true}` and calls `Reset(now)`.
2. [Reaction]: The engine returns one resolve incident for `alarm-camera`, because its incident was active.
3. [Reaction]: The engine clears the edge state of both rules and keeps the time of the last firing.
4. [Reaction]: The service publishes the resolve.
5. [Action]: The first frame arrives with the alarm still active.
6. [Reaction]: `alarm-camera` sees a rising edge and triggers again. `any-alert` is still inside its cooldown and does not fire.

## Expected Outcome

- [Success Condition]: No incident stays open across the reconnect without a new trigger. The cooldown of `any-alert` holds.
- [Verification]: The tests `TestEngineReset_ResolvesActiveIncidents` and `TestEngineReset_NothingActiveReturnsEmpty`, ported from tsend2mqtt.

## Exceptions & Edge Cases

- [Other services]: iolinkmaster2mqtt and modbus2mqtt have no transport reconnect. They clear slots to `nil` instead (SCEN-005).
