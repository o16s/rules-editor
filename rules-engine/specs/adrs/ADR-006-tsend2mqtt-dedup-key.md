---
id: "ADR-006"
type: architecture_decision_record
name: "Keep the tsend2mqtt dedup key through an empty topic prefix"
description: >
  tsend2mqtt sets TopicPrefix to empty and Sources to its topic prefix, so the
  dedup key stays {topic_prefix}-{rule}.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-014"
---

# Architecture Decision: Keep the tsend2mqtt dedup key through an empty topic prefix

## Context and problem statement

The polling services build the incident source as `{topic_prefix}/{source}`. tsend2mqtt uses its topic prefix alone. The shared engine has one formula. How does tsend2mqtt keep its key?

## Key factors

- A key change orphans the incidents open at the cutover.
- The XSD requires `source` on `<incident>`, which tsend2mqtt files lack today.

## Considered options

- `TopicPrefix: ""` means source ID equals `source`. The files carry `source="<topic_prefix>"`.
- Accept a key change and resolve every incident at the cutover.
- A per-service format string in the catalog.

## Decision Outcome

Chosen option: "`TopicPrefix: ""` means source ID equals `source`". The key does not change, and the files become valid against the XSD at the same time.

### Positive Consequences

- No orphaned incident at the cutover.
- tsend2mqtt files pass the hub validation.

### Negative Consequences

- Every deployed tsend2mqtt rules file needs `source="<topic_prefix>"` on each `<incident>`.

## Pros and Cons of the Options

### Empty prefix rule

- Good, because it is one `if` in the library.
- Bad, because an empty prefix has a special meaning.

### Accept the change

- Good, because all services then share one key form.
- Bad, because the cutover needs a coordinated resolve of open incidents.

### Format string

- Bad, because it is a configuration surface for one case.

## Links

- PLAN.md, section 4.7 and decision 2.
