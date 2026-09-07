---
id: "SWREQ-001"
type: software_requirement
name: "Structural validation of the 0.3 vocabulary"
description: >
  rulesxml.Validate walks the document with fixed tables and reports every
  structural fault with a path.
specification: >
  `rulesxml.Validate` must accept exactly the elements and attributes of
  schema 0.3, report every structural fault with a path, and never allocate
  per element.
derives_from:
  - "SYSARCH-001"
---

# Software Requirement: Structural validation of the 0.3 vocabulary

## Requirement Specification

> `rulesxml.Validate` must accept exactly the elements and attributes of schema 0.3, report every structural fault with a path, and never allocate per element.

## Rationale

`encoding/xml` unmarshal drops what it does not know. A misspelled attribute
becomes a rule that publishes an empty payload. The validator catches it.

## Logic & Interface Details

```go
package rulesxml
type Problem struct { Path, Message string }
func Validate(r io.Reader) []Problem
```

Vocabulary, as fixed tables in `schema.go`:

| Element | Parent | Attributes | Children |
|---|---|---|---|
| `rules` | root | none | `rule` (0 to 1000) |
| `rule` | `rules` | `name` (required), `cooldown`, `edge` | `variables` (0 or 1), one of `cond`, `and`, `or`, then `actions` (0 or 1), `incident` (0 or 1), in this order |
| `variables` | `rule` | none | `var` (0 to 64) |
| `var` | `variables` | `name` (required, identifier), `formula` (required, non-empty), `description` (240 characters) | none |
| `cond` | `rule`, `and`, `or` | `expr`, `description`, `device`, `tag`, `op`, `value` | none |
| `and`, `or` | `rule`, `and`, `or` | `description` (not on the level-1 group) | 1 to 16 of `cond`, `and`, `or`, to depth 4 |
| `actions` | `rule` | none | `publish` (1 to 64) |
| `publish` | `actions` | `topic` (required, non-empty), `payload` | none |
| `incident` | `rule` | `source`, `severity`, `summary` (required), `first_step`, `cause` | none |

Value checks:

- A `cond` carries either `expr`, or `tag` and `op`, never both and never neither.
- With an `op` other than `changed`, `value` is required and not empty.
- `op` matches the operator list exactly.
- `cooldown` is a Go duration, `0` included.
- `edge` is `none` or `rising`.
- `severity` is one of four values.
- `summary` has 1 to 120 code points.
- Rule names are unique in the file.
- Variable names are unique in the rule and match `[A-Za-z_][A-Za-z0-9_]*`.
- Text inside `rules`, `rule`, `variables`, `and`, `or` and `actions` is a problem.

The path form is `rules/rule[2]/and/cond[1]@value`. Indexed children are
`rule` under `rules`, `var` under `variables`, `cond`, `and` and `or` under a
group, and `publish` under `actions`.

## Acceptance Criteria

- Every fixture in `schema/fixtures/` gets the verdict of the parity test (SYSREQ-002).
- A file with N independent faults produces N problems, up to 200.
- `go test -bench Validate -benchmem` reports 0 allocs/op per element after the first call.
- The input is limited to 1 MiB and 2^18 tokens.

## Verification Plan

- **Method**: test.
- **Procedure**: The existing `rulesxml_test.go` and `parity_test.go`, extended with 0.3 fixtures. New fixtures cover `variables`, `expr`, `description`, `first_step` and `cause`. Others cover a `cond` with both forms, a `cond` with no form, 65 variables, 65 actions, and a 241-character description.

## Notes

The `cooldown="0"` refusal of the modbus2mqtt version is removed.
