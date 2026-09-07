---
id: "SWREQ-006"
type: software_requirement
name: "Slot value types and equality"
description: >
  The engine accepts a fixed set of dynamic types in a slot and compares them
  without a panic.
specification: >
  The engine must accept `nil`, `bool`, every Go integer type, `float32`,
  `float64` and `string` as slot values. It must compare two slots with a type
  switch, and treat every other dynamic type as unknown.
derives_from:
  - "SYSARCH-001"
---

# Software Requirement: Slot value types and equality

## Requirement Specification

> The engine must accept `nil`, `bool`, every Go integer type, `float32`, `float64` and `string` as slot values. It must compare two slots with a type switch, and treat every other dynamic type as unknown.

## Rationale

`!=` on two `any` values panics when the dynamic type is not comparable. A
panic in the aggregator stops the service.

## Logic & Interface Details

```go
func equalValue(a, b any) bool
func toInt64(v any) (int64, bool)
func toFloat64(v any) (float64, bool)
```

- `equalValue` is true when both are `nil`, or both have the same dynamic type and equal value. Two floats compare with `==`, so `NaN != NaN` and a `NaN` slot counts as changed on every call.
- A slot of another dynamic type is treated as `nil` and logged once at the first `Eval` that sees it. It is not a panic.
- `toInt64` and `toFloat64` cover the listed numeric types, `int` included.

## Acceptance Criteria

- `TestToInt64` and `TestToFloat64` of the polling services pass, extended with `int`.
- A slot with a `[]byte` value does not panic and compares as unknown.

## Verification Plan

- **Method**: test.
- **Procedure**: Unit tests of the three functions, with one non-comparable value.

## Notes

The drivers of the three services produce only the listed types today.
