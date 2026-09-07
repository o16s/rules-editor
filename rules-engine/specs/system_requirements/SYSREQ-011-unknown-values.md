---
id: "SYSREQ-011"
type: system_requirement
name: "Unknown values"
description: >
  A nil slot means unknown. Every comparison with it is false, and a service
  clears the slots of an offline device.
specification: >
  A `nil` slot must mean an unknown value, and every comparison with an
  unknown value must be false. Each service must set the slots of a device to
  `nil` when the device goes offline.
derives_from:
  - "SCEN-005"
---

# System Requirement: Unknown values

## Requirement Specification

> A `nil` slot must mean an unknown value, and every comparison with an unknown value must be false. Each service must set the slots of a device to `nil` when the device goes offline.

## Rationale

A rule that latches the last value of a silent device holds an incident on
stale data. modbus2mqtt clears the values today, iolinkmaster2mqtt does not.

## Acceptance Criteria

- `TAG(...) > 5` is false when the slot is `nil`.
- `CHANGED(TAG(...))` is true in the cycle where the slot becomes `nil` and in the cycle where it becomes a value again.
- `STALE(TAG(...), d)` is true when the slot is `nil`.
- After the offline threshold, a service writes `nil` into every slot of the device and calls `Eval`.

## Verification Plan

- **Method**: test.
- **Procedure**: `TestLeafCond_NilValue` and formula tests with `nil`. An adapter test per multi-device service.

## Notes

See ADR-010 for iolinkmaster2mqtt.
