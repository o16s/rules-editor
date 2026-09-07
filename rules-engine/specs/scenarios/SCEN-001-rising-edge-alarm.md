---
id: "SCEN-001"
type: scenario
name: "Rising-edge alarm triggers cameras and an incident"
description: >
  A PLC alarm bit becomes true. The rule fires four camera triggers and one
  incident, once.
refines:
  - "UC-003"
  - "UC-002"
---

# Scenario: Rising-edge alarm triggers cameras and an incident

## Overview

This is the main path of a rule with actions and an incident. It shows the
rising edge, the order of the actions, and the single trigger.

## Initial State

- The rule `alarm-camera` has `cooldown="45s"` and `edge="rising"`.
- Its condition is `TAG("AlarmFlag") = true`.
- It has four `<publish>` elements to `sensingcam/sick1/trigger` to `sensingcam/sick4/trigger`.
- It has `<incident source="plc1" severity="critical" summary="PLC alarm active"/>`.
- The slot of `AlarmFlag` holds `false`. The rule did not fire before.

## Trigger

A frame arrives with `AlarmFlag` set to `true`.

## Step-by-Step Flow

1. [Reaction]: The service writes `true` into the slot of `AlarmFlag`.
2. [Reaction]: The engine detects the change and evaluates the rule.
3. [Reaction]: The result is true and the previous result was false. This is a rising edge.
4. [Reaction]: No cooldown is active. The rule fires.
5. [Reaction]: The engine returns four actions in document order and one trigger incident.
6. [Reaction]: The service publishes the four actions with QoS 0, with 10 ms between them.
7. [Reaction]: The service publishes the trigger to `incidents/` with QoS 1.
8. [Action]: The next frame arrives with `AlarmFlag` still `true`.
9. [Reaction]: No slot of the rule changed. The engine does not evaluate the rule. Nothing fires.

## Expected Outcome

- [Success Condition]: Each camera receives one message. The forwarder receives one trigger with `dedup_key` `plc1-alarm-camera`.
- [Verification]: The tests `TestEngine_EdgeRising`, `TestEngine_MultipleActions` and `TestEngine_IncidentTrigger` in the `rules` package.

## Exceptions & Edge Cases

- [Cooldown active]: If the previous firing was less than 45 s ago, nothing fires. The rising edge is consumed (see ADR-004).
- [No broker]: If the service has no MQTT connection, the service does not call `Eval`. Rules do not fire without a publisher.
