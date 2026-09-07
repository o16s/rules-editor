---
id: "ADR-019"
type: architecture_decision_record
name: "One incident identity for every service"
description: >
  Every service builds the incident source as topic_prefix/source. The empty-
  prefix rule of ADR-006 is dropped, because no deployed file needs it.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-014"
supersedes:
  - "ADR-006"
---

# Architecture Decision: One incident identity for every service

## Context and problem statement

ADR-006 kept the dedup key of tsend2mqtt as `{topic_prefix}-{rule}`, through
an empty `TopicPrefix` in the catalog. The reason was the cutover: a changed
key orphans the incidents that are open when the service restarts.

No service runs the shared engine yet, and no rule file in the field uses the
0.3 format. There is nothing to keep compatible.

## Key factors

- One identity is simpler to document, to search and to alert on.
- A special case in a library is a place where a later reader is wrong.
- The forwarder groups by `dedup_key`. Two formats mean two shapes in every dashboard.

## Considered options

- One format everywhere: `{topic_prefix}/{source}-{rule}`.
- Keep ADR-006: the empty prefix means the source is the identity.

## Decision Outcome

Chosen option: "One format everywhere". Every service sets a topic prefix,
every incident source names a device, and the key is
`{topic_prefix}/{source}-{rule}`. ADR-006 is superseded.

### Positive Consequences

- The engine has no special case, and the README states one rule.
- tsend2mqtt gains a real source name on each incident, which the schema requires anyway.

### Negative Consequences

- An incident open at the cutover of a running service keeps the old key. An operator closes it by hand, once, per service.
- The empty-prefix behavior stays in the library, because a service with no prefix is still a valid catalog. It is no longer the way tsend2mqtt is configured.

## Pros and Cons of the Options

### One format everywhere

- Good, because one shape reaches the forwarder from every service.
- Bad, because it needs one manual cleanup per service at the cutover.

### Keep ADR-006

- Good, because an open incident survives the cutover.
- Bad, because it keeps a special case for a compatibility nobody needs.

## Links

- Supersedes ADR-006. SWREQ-016, SYSREQ-007.
