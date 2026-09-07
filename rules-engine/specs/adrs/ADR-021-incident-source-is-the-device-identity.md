---
id: "ADR-021"
type: architecture_decision_record
name: "The incident source is the device identity of the config contract"
description: >
  A service passes the device identity it already computed for discovery. The
  engine keeps topic_prefix/source as the default when no identity is given.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-014"
supersedes:
  - "ADR-019"
---

# Architecture Decision: The incident source is the device identity of the config contract

## Context and problem statement

ADR-019 fixed one format for every service: the incident source is
`{topic_prefix}/{source}`, and the dedup key is that source plus the rule name.

Every service also publishes a device identity in two other places, its
discovery message and its retained status topic. The octaview config contract
computes that identity as `{topic_prefix}/{name}`, unless the device sets
`topic:` in its configuration. That key replaces the computed value.

tsend2mqtt sets `topic: plc1` to make its identity flat, so its identity is
`plc1`. The ADR-019 formula produces `plc1/plc1` instead. A dashboard that
joins an alert to the machine that raised it then finds no machine.

modbus2mqtt and iolinkmaster2mqtt do not read the `topic:` override, so the
formula already returns their identity.

## Key factors

- An operator reads one name for one machine. Two names break the join between an alert and the device that raised it.
- The identity already exists in every service. Each one computes it once, for discovery and for the status topic.
- The formula is correct for two of the three services, so it must stay as the default.

## Considered options

- The service passes the identity it already computed.
- Keep the formula and accept `plc1/plc1` for tsend2mqtt.
- Give tsend2mqtt an empty topic prefix, which is ADR-006 again.

## Decision Outcome

Chosen option: "The service passes the identity it already computed."

`Catalog` gains an optional field `SourceIDs []string`, parallel to `Sources`.
`SourceIDs[i]` is the identity of `Sources[i]`. When the field is empty, the
engine keeps `{topic_prefix}/{source}`. The dedup key stays
`{source ID}-{rule}` in both cases.

`Load` rejects a `SourceIDs` whose length is neither zero nor the length of
`Sources`. It also rejects an empty entry.

This lands in `rules-engine/v0.4.0`, before the tsend2mqtt adapter.
modbus2mqtt and iolinkmaster2mqtt need no change, because the default is
already their identity.

### Positive Consequences

- One name per machine, in discovery, in the status topic and in every alert.
- The rule is stated once: the incident source is the device identity of the config contract.
- Two of the three services adopt the module with no new field.

### Negative Consequences

- The catalog gains a field. A service that fills it wrongly publishes a name that nothing else uses, so `Load` checks the length and rejects an empty entry.
- tsend2mqtt waits for the v0.4.0 tag.

## Pros and Cons of the Options

### The service passes the identity it already computed

- Good, because the alert and the discovery message name the same machine.
- Good, because the engine does not need to know the config contract.
- Bad, because the catalog gains a field that most services leave empty.

### Keep the formula and accept plc1/plc1

- Good, because nothing changes in the module.
- Bad, because the alert names a machine that no other message names.

### Give tsend2mqtt an empty topic prefix

- Good, because it matches the wire the service publishes today.
- Bad, because it restores the special case that ADR-019 removed, and it fixes only one service.

## Links

- Supersedes ADR-019, and through it ADR-006.
- SWREQ-016, SWDD-014, SYSREQ-013.
