---
id: "SYSREQ-013"
type: system_requirement
name: "Publication of actions and incidents"
description: >
  Each service publishes actions with QoS 0 to absolute topics and incidents
  with QoS 1 to incidents/, in order.
specification: >
  Each service must publish the actions of one `Eval` in the returned order,
  with QoS 0, to the absolute topic. Then it must publish the incidents with
  QoS 1 to `incidents/`. At most 100 of each are published per call.
derives_from:
  - "SCEN-001"
---

# System Requirement: Publication of actions and incidents

## Requirement Specification

> Each service must publish the actions of one `Eval` in the returned order, with QoS 0, to the absolute topic. Then it must publish the incidents with QoS 1 to `incidents/`. At most 100 of each are published per call.

## Rationale

Cameras and device command topics expect the order of the file. The
forwarder expects QoS 1.

## Acceptance Criteria

- Actions are published in the order of the returned slice, with 10 ms between two actions. Actions and incidents are not retained.
- When several rules fire in one `Eval`, their outputs follow the order of the rules in the file (ADR-016).
- Incidents are published after the actions of the same call.
- The topic prefix of the service is not prepended to an action topic.
- An `Eval` result is consumed before the next `Eval` call.

## Verification Plan

- **Method**: test.
- **Procedure**: An adapter test per service with a fake publisher that records order, QoS and topics.

## Notes

The 10 ms spacing and the cap of 100 come from the current services.
