---
id: "ADR-017"
type: architecture_decision_record
name: "Actions publish with QoS 1, as the services do today"
description: >
  The code of all three services publishes actions with QoS 1. The
  documentation and the XSD annotation say QoS 0. The specification follows
  the code.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SYSARCH-002"
---

# Architecture Decision: Actions publish with QoS 1, as the services do today

## Context and problem statement

`tsend2mqtt` `PublishAction`, `iolinkmaster2mqtt` `PublishRawAbsolute` and
`modbus2mqtt` `PublishRawAbsolute` call `client.Publish(topic, 1, false, ...)`.
The three `docs/rules.md` files and the `publish` annotation in
`schema/rules.xsd` say "fire-and-forget (QoS 0, non-retained)". Which one is
the contract?

## Key factors

- Camera triggers and device commands are the actions. A lost trigger is a lost recording.
- The migration must not change the delivery guarantee of deployed rules.
- The documentation is wrong today, not the code.

## Considered options

- QoS 1, and correct the documentation and the XSD annotation.
- QoS 0, and change the three services.
- A `qos` attribute on `publish`.

## Decision Outcome

Chosen option: "QoS 1, and correct the documentation". It is the deployed behavior, and at-least-once delivery is what a camera trigger needs.

### Positive Consequences

- No behavior change in the migration.
- One line of text changes in the XSD and in three documents.

### Negative Consequences

- A duplicate action is possible after a reconnect of the MQTT client. The receivers tolerate it today.

## Pros and Cons of the Options

### QoS 1

- Good, because it is what the fleet does.
- Bad, because a duplicate is possible.

### QoS 0

- Good, because it matches the text.
- Bad, because a camera trigger can be lost during a broker hiccup, and the behavior changes.

### A `qos` attribute

- Good, because the operator chooses.
- Bad, because it is a schema change for a case nobody asked for.

## Links

- SYSREQ-013, SWREQ-018.
