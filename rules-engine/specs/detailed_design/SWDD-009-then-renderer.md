---
id: "SWDD-009"
type: software_detailed_design
name: "Then fields renderer and rule buffer"
description: >
  Formula Then fields render into a 4 KiB buffer per rule, in a fixed order,
  with truncation flags.
satisfies:
  - "SWREQ-011"
---

# Software Implementation: Then fields renderer and rule buffer

## Overview

Each rule that has at least one formula Then field owns a `[4096]byte`
buffer. Literal fields never touch the buffer.

## Static View (Structure)

```go
type thenField struct { literal []byte; program *formula.Program }
type ruleBuf struct { b [4096]byte; n int; truncated bool }
```

## Dynamic View (Logic)

At fire time, `n = 0`. For each action in order, the renderer renders `topic`,
then `payload`. Then it renders `source`, `summary`, `first_step` and `cause`.
`render` evaluates the program with the context of the rule, formats the
`Value` with the `&` rules, and appends to the buffer. The returned `[]byte`
is `b[start:n]`.

A render that does not fit stops at the end and sets `truncated`. `summary`
is cut to 120 code points. `condition.description` is computed once per
firing, before the first render.

## Interface & API Definitions

Internal. `Action.Topic` and `Action.Payload`, and the incident strings,
reference the buffer or the literal bytes. A truncation increments
`Stats.TruncatedRenders`. The service logs the counter on its status
ticker.

## Error Handling & Edge Cases

- An empty rendered `topic` drops the action and increments `Stats.DroppedActions`.
- A rendered `source` that is not in `Sources` is not checked at fire time. The dedup key uses it as rendered. The README documents that a formula `source` bypasses the `Sources` check.

## Notes

The buffer is per rule, not per action, so 64 actions with long payloads can truncate. The limit is documented.
