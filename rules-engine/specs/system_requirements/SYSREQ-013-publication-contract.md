---
id: "SYSREQ-013"
type: system_requirement
name: "Publication of actions and incidents"
description: >
  Each service publishes actions with QoS 1 to absolute topics and incidents
  with QoS 1 to incidents/, in order.
specification: >
  Each service must publish the actions of one `Eval` in the returned order,
  with QoS 1 and without retain, to the absolute topic. Then it must publish
  the incidents with QoS 1 to `incidents/`. At most 100 of each are published
  per call.
derives_from:
  - "SCEN-001"
---

# System Requirement: Publication of actions and incidents

## Requirement Specification

> Each service must publish the actions of one `Eval` in the returned order, with QoS 1 and without retain, to the absolute topic. Then it must publish the incidents with QoS 1 to `incidents/`. At most 100 of each are published per call.

## Rationale

Cameras and device command topics expect the order of the file. The
forwarder expects QoS 1.

## Acceptance Criteria

- Actions are published in the order of the returned slice, with 10 ms between two actions. Actions and incidents are not retained.
- When several rules fire in one `Eval`, their outputs follow the order of the rules in the file (ADR-016).
- A publish failure does not undo a firing. The engine state advances, and the retry or drop policy of the MQTT client applies.
- Outputs beyond 100 per call are dropped. The service counts and logs them.
- Incidents are published after the actions of the same call.
- The topic prefix of the service is not prepended to an action topic.
- An `Eval` result is consumed before the next `Eval` call.

## Verification Plan

- **Method**: test.
- **Procedure**: An adapter test per service with a fake publisher that records order, QoS and topics.

## Notes

The 10 ms spacing and the cap of 100 come from the current services. The three services publish actions with QoS 1 today, while their documentation and the XSD annotation say QoS 0. ADR-017 keeps QoS 1.
