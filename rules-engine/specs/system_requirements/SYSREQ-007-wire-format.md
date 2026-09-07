---
id: "SYSREQ-007"
type: system_requirement
name: "Wire format compatibility"
description: >
  Incident messages and dedup keys keep their current form. New fields are
  optional additions.
specification: >
  The incident message must keep the fields action, dedup_key, source,
  severity, summary, time and data.rule with their current meaning. Every
  service must build the dedup_key as {topic_prefix}/{source}-{rule}.
derives_from:
  - "SCEN-001"
  - "SCEN-002"
---

# System Requirement: Wire format compatibility

## Requirement Specification

> The incident message must keep the fields `action`, `dedup_key`, `source`, `severity`, `summary`, `time` and `data.rule` with their current meaning. Every service must build the `dedup_key` as `{topic_prefix}/{source}-{rule}`.

## Rationale

The forwarder and its dashboards read these fields. A changed key orphans
the incidents that are open at the cutover.

## Acceptance Criteria

- `time` is UTC with millisecond precision, format `2006-01-02T15:04:05.000Z`.
- `severity` and `summary` are present on a trigger and absent on a resolve.
- `first_step` and `cause` are present on a trigger only when the rule sets them.
- Every service produces `{topic_prefix}/{source}-{rule}` (ADR-019).
- Actions publish to the absolute topic with the given payload, or `{}` when absent.

## Verification Plan

- **Method**: test.
- **Procedure**: A golden JSON test of `Incident.Message`. The replay test of each service compares the `dedup_key` of every incident with the golden file recorded before the migration.

## Notes

The additive fields need an update of `tsend2mqtt/docs/events-protocol.md`
(ADR-007). The key of tsend2mqtt changes with ADR-019, which is safe because
no service runs the shared engine yet.
