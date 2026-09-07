---
id: "SWREQ-017"
type: software_requirement
name: "Migration parity by replay"
description: >
  Each service records the outputs of its old engine on a scripted value
  sequence and replays it against the module.
specification: >
  Before its migration, each service must record the actions and incidents of
  its `examples/rules.xml` over a scripted value sequence. After the
  migration, it must replay the sequence against the module with the same
  output, except for the changes this specification lists.
derives_from:
  - "SYSARCH-002"
depends_on:
  - "SWREQ-014"
  - "SWREQ-015"
  - "SWREQ-016"
---

# Software Requirement: Migration parity by replay

## Requirement Specification

> Before its migration, each service must record the actions and incidents of its `examples/rules.xml` over a scripted value sequence. After the migration, it must replay the sequence against the module with the same output, except for the changes this specification lists.

## Rationale

The migration is behavior-preserving by design. The replay proves it per
service.

## Logic & Interface Details

- The value sequence is a JSON file with a list of steps. Each step has a time offset and a map of `device.tag` to value. `null` means offline.
- The golden file is a JSON list of the actions (`topic`, `payload`) and incidents (`action`, `dedup_key`, `severity`, `summary`) per step.
- The recorder is a small test in each service against its old engine, committed before the engine is deleted.
- The replay test loads the same rules file with the module and compares.

Listed differences:

| Service | Difference | Reason |
|---|---|---|
| tsend2mqtt | incident rules with `edge="none"` load | SYSREQ-004 |
| tsend2mqtt | no resolve after a suppressed trigger | SYSREQ-004 |
| iolinkmaster2mqtt, modbus2mqtt | a `CHANGED` rule fires on every change | SYSREQ-003 |
| iolinkmaster2mqtt | offline device resolves | SYSREQ-011 |

## Acceptance Criteria

- Three golden files exist and are committed before the deletion of the old engines.
- The replay tests pass after the migration, with the listed differences encoded in the expected output.

## Verification Plan

- **Method**: test.
- **Procedure**: The replay test in each service CI.

## Notes

The sequences cover every rule of the example files at least once, with a rising edge, a falling edge and a cooldown.
