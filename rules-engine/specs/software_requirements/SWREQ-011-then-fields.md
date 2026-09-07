---
id: "SWREQ-011"
type: software_requirement
name: "Then fields and condition.description"
description: >
  A Then attribute that starts with = is rendered at fire time into a buffer
  of the rule.
specification: >
  A `topic`, `payload`, `source`, `summary`, `first_step` or `cause` that
  starts with `=` must compile at `Load`. It must render at fire time into a
  buffer of 4 KiB per rule. `condition.description` must be the description of
  the first true row that has one.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-009"
---

# Software Requirement: Then fields and condition.description

## Requirement Specification

> A `topic`, `payload`, `source`, `summary`, `first_step` or `cause` that starts with `=` must compile at `Load`. It must render at fire time into a buffer of 4 KiB per rule. `condition.description` must be the description of the first true row that has one.

## Rationale

Operators want the live value in the payload and the row description in the
page. The buffer keeps the hot path free of allocations.

## Logic & Interface Details

- A literal Then field is stored as bytes at `Load`.
- A formula Then field is a `Program` with `allowContext = true`. Its result renders with the `&` rules of SWREQ-009.
- Each rule has one buffer of 4096 bytes. Rendered fields are appended in order: topic and payload per action, then source, summary, first step, cause. `Action` and `Incident` hold slices of the buffer.
- A render that exceeds the buffer is truncated at the buffer end, and the engine sets a `Truncated` flag on the output. The service logs it.
- A rendered `summary` longer than 120 code points is cut to 120.
- `condition.description`: the top-level group is evaluated row by row. The description of the first true row with a description is the context. For a bare `cond`, it is its description. Empty when none.
- A formula `source` renders at trigger time. The engine stores the rendered dedup key with the rule state and uses it for the resolve (SWREQ-004).

## Acceptance Criteria

- SCEN-013 as an `Eval` test: payload `{"temp":85.5}` and summary `Temperature more than 80 on plc1`.
- A payload of 5000 characters is truncated and flagged.
- The buffer contents survive until the next `Eval`.

## Verification Plan

- **Method**: test.
- **Procedure**: Unit tests of the renderer with each field kind and with truncation.

## Notes

A `topic` formula that renders an empty string is a problem at fire time: the action is dropped and logged.
