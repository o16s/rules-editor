---
id: "UC-002"
type: use_case
name: "Alert people through incidents"
description: >
  A rule raises an incident when its condition becomes true and resolves it
  when the condition clears.
refines:
  - "SOL-001"
---

# Use Case: Alert people through incidents

## Actor(s)

- **Primary Actor**: On-call staff, through the incident forwarder.
- **Secondary Actors**: The operator who writes the rule, and the forwarder that consumes the `incidents/` topic.

## Pre-conditions

- The rule has an `<incident>` element with `source`, `severity` and `summary`.
- The service has an MQTT connection.

## Main Success Outcome

When the condition becomes true, the service publishes one trigger message.
When the condition becomes false, the service publishes one resolve message
with the same `dedup_key`. The forwarder opens one incident and closes it.
No incident stays open after the cause is gone.

## Key Functional Scope

- **Lifecycle**: Trigger on the rising edge, resolve on the falling edge, one active state per rule.
- **No orphans**: A resolve is sent only for a trigger that was sent.
- **Never suppressed**: A cooldown never delays a resolve.
- **Stable identity**: The `dedup_key` of a rule does not change between trigger and resolve.
- **Operator text**: `summary`, and the optional `first_step` and `cause`, reach the forwarder.
- **Cleanup**: A device that goes offline, or a transport that reconnects, resolves its stale incidents.

## Post-conditions

- **Success Condition**: The forwarder shows the incident as open while the condition is true, and as closed after it clears.
- **Failure Condition**: An incident stays open without a cause, or a resolve arrives without a trigger.
