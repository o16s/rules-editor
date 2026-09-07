---
id: "UC-003"
type: use_case
name: "Trigger local actions from conditions"
description: >
  A rule publishes MQTT messages to cameras, device command topics and other
  services when its condition fires.
refines:
  - "SOL-001"
---

# Use Case: Trigger local actions from conditions

## Actor(s)

- **Primary Actor**: The operator who writes the rule.
- **Secondary Actors**: Cameras, device command topics such as `iolink/<name>/param/<command>`, and other services on the broker.

## Pre-conditions

- The rule has an `<actions>` element with one or more `<publish>` elements.
- The service has an MQTT connection.

## Main Success Outcome

When the rule fires, the service publishes each `<publish>` in document order
to its absolute topic with its payload. The `edge` and `cooldown` attributes
control how often the rule fires.

## Key Functional Scope

- **Edge**: `none` fires on every evaluation where the condition is true. `rising` fires on the change from false to true.
- **Cooldown**: A minimum time between two firings of the same rule.
- **Pulse**: `CHANGED()` and the 0.2 operator `changed` fire on every change of the value.
- **Fan-out**: One rule publishes to many topics, at most 64.
- **Payload**: A missing payload publishes `{}`. A payload that starts with `=` is a formula.

## Post-conditions

- **Success Condition**: Each target receives the message once per firing, in document order.
- **Failure Condition**: A target receives a message without a firing, or a firing is lost while the broker is connected.
