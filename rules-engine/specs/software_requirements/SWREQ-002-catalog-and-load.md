---
id: "SWREQ-002"
type: software_requirement
name: "Catalog and binding"
description: >
  rules.Load binds a validated document to the catalog of a service and
  returns every binding problem.
specification: >
  `rules.Load` must resolve every `TAG` and 0.2 `cond` to a catalog slot, and
  parse every 0.2 `value` as the field type. It must resolve incident sources,
  compile every formula, and return every problem it finds.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-001"
  - "SWREQ-008"
---

# Software Requirement: Catalog and binding

## Requirement Specification

> `rules.Load` must resolve every `TAG` and 0.2 `cond` to a catalog slot, and parse every 0.2 `value` as the field type. It must resolve incident sources, compile every formula, and return every problem it finds.

## Rationale

The structure is sound after SWREQ-001. Binding is where a file meets a
service: its devices, tags and types.

## Logic & Interface Details

```go
type Type uint8            // Bool, Integer, Number, String
type Field struct { Device, Tag string; Type Type }
type Catalog struct {
    Fields      []Field
    Sources     []string
    TopicPrefix string
    Period      time.Duration
}
func TypeFromJSONSchema(name string) (Type, bool)
type Problem struct { Path, Rule, Message string }
func Load(data []byte, cat Catalog) ([]Rule, []Problem)
func Parse(r io.Reader, cat Catalog) ([]Rule, error)
```

Resolution rules:

- `<cond device="D" tag="T">` and `TAG("D", "T")` resolve to the field with `Device == D` and `Tag == T`.
- `<cond tag="T">` and `TAG("T")` resolve to the field with `Device == ""` and `Tag == T`. When no field has an empty device, the problem is `device is required`.
- A 0.2 `value` parses as the field type: `strconv.ParseBool`, `ParseInt`, `ParseFloat`, or the string itself. `lt`, `leq`, `gt`, `geq` on a `Bool` or `String` field is a problem.
- A 0.2 `cond` compiles to the same program as its formula form, so both forms behave the same.
- `<incident source="S">` must name an entry of `Sources`. Source ID is `TopicPrefix + "/" + S`, or `S` when `TopicPrefix` is empty. Dedup key is source ID `+ "-" +` rule name.
- `cooldown` parses with `time.ParseDuration`. A negative value is a problem.
- Duplicate `Fields` entries (same device and tag) make `Load` return one problem and no rule.
- `Load` returns no rule when the problem list is not empty.

## Acceptance Criteria

- Every `TestParse_*` test of the three services passes, adapted to the `Catalog` type.
- A file with an unknown tag in rule 1 and a bad value in rule 3 returns two problems with paths.
- `Parse` returns one error that lists every problem, one per line.

## Verification Plan

- **Method**: test.
- **Procedure**: The union of the `parse_test.go` files of the three services, plus tests for `device is required`, the empty-prefix source ID, duplicate fields, and the multi-problem return.

## Notes

`Parse` exists for tests and for callers that keep the one-error style.
