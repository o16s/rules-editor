---
id: "SWDD-014"
type: software_detailed_design
name: "tsend2mqtt adapter"
description: >
  Slot filling from ChangedTag, first-frame decode, mutex, ticker, Reset(now),
  and the source attribute.
satisfies:
  - "SWREQ-016"
---

# Software Implementation: tsend2mqtt adapter

## Overview

About 120 changed lines in `cmd/tsend2mqtt/main.go`. The engine no longer
imports `udt` or `decode`.

## Static View (Structure)

```go
type ruleState struct {
    mu     sync.Mutex
    eng    *rules.Engine
    values []any
}
func typeOf(t udt.S7Type) rules.Type
func loadRules(path string, fields []udt.Field, topicPrefix string) (*ruleState, error)
```

## Dynamic View (Logic)

```mermaid
sequenceDiagram
    participant F as frame loop
    participant R as ruleState
    participant T as ticker (1 s)
    F->>R: lock; first frame: decode all fields into values
    F->>R: later frames: values[c.Index] = c.Value for each ChangedTag
    F->>R: Eval(values, now); unlock; publish
    T->>R: lock; Eval(values, now); unlock; publish
    Note over F,R: reconnect
    F->>R: lock; Reset(now); unlock; publish resolves
```

`publishIncident(pub, inc, now)`: `json.Marshal(inc.Message(now))`, then
`pub.PublishIncident`. The `source` parameter disappears: the source ID is in
the incident.

## Interface & API Definitions

The catalog: `Device ""`, `Tag` = field name, `Type` from `typeOf`.
`Sources` are the device names of the configuration, and `Period` is one second.
`SourceIDs` are `cfg.DeviceIdentity(d)` for each device, which is `plc1` for the
shipped configuration, because the device sets `topic: plc1` (ADR-021). The
module gains `Catalog.SourceIDs` in v0.4.2, and this adapter requires that tag.

## Error Handling & Edge Cases

- The frame timestamp from the PLC is not used for rules. Cooldown and time functions use receive time, as today.
- The ticker goroutine ends with the connection goroutine, through the same `done` channel.
- A rules file without `source` on an incident now fails at startup. The release notes tell operators to add `source="<device name>"`.

## Notes

ADR-021 supersedes ADR-019.
