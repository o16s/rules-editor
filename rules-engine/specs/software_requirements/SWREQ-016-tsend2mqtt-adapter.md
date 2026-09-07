---
id: "SWREQ-016"
type: software_requirement
name: "tsend2mqtt adapter"
description: >
  tsend2mqtt decodes changed fields into slots, keeps its dedup key, adds a
  timer and a source attribute, and deletes internal/rules.
specification: >
  tsend2mqtt must build a Catalog from the .udt layout with Device empty. It
  must fill a slot array from the decoded changed fields, and from a full
  decode on the first frame. It must call Eval on each frame and on a 1 s
  timer, under one mutex. It must call Reset on reconnect, and set its topic
  prefix like the other services.
derives_from:
  - "SYSARCH-002"
depends_on:
  - "SWREQ-002"
  - "SWREQ-005"
---

# Software Requirement: tsend2mqtt adapter

## Requirement Specification

> tsend2mqtt must build a `Catalog` from the `.udt` layout with `Device` empty. It must fill a slot array from the decoded changed fields, and from a full decode on the first frame. It must call `Eval` on each frame and on a 1 s timer, under one mutex. It must call `Reset` on reconnect, and set its topic prefix like the other services (ADR-019).

## Rationale

The engine no longer decodes frames. tsend2mqtt has the largest change.

## Logic & Interface Details

- `loadRules`: `Fields[i] = Field{Device: "", Tag: layout.Fields[i].Name, Type: typeOf(layout.Fields[i].Type)}`. `typeOf` maps `TypeBool` to `Bool`, `TypeReal` and `TypeLReal` to `Number`, `TypeString` and `TypeWString` to `String`, and every other S7 type to `Integer`. `TypeTime` decodes to `int32`, `TypeLInt` and `TypeLTime` to `int64`, and `TypeLWord` to `uint64`, all `Integer`. `TypeDate` and `TypeTOD` are not decoded today, so their slots stay `nil`. `Sources` are the device names of the configuration, `TopicPrefix` is the configured prefix, and `Period` is one second.
- The slot array has `len(layout.Fields)` entries. On the first frame of a connection, `decode.DecodeField` fills every slot. On each later frame, `ruleValues[c.Index] = c.Value` for each `ChangedTag`.
- `Eval(ruleValues, time.Now())` comes after the change detection of the frame. A `time.Ticker` of 1 s calls `Eval` as well. Both hold one mutex around the slots and the engine.
- On reconnect, `Reset(now)` replaces `Reset()`. Resolves publish through `Message`.
- `publishIncident` becomes `json.Marshal(inc.Message(now))` and `pub.PublishIncident`.
- `examples/rules.xml` and the deployed files gain `source="<topic_prefix>"` on each `<incident>`.

### What must not change

- The MCAP writer keeps its own input. It logs the report as it arrived, or the raw frame. The slot array never reaches it, so a `nil` written for an offline device or an absent field does not enter the log.
- The timer that calls `Eval` without new data must not write to MCAP. A log row means a poll happened.

## Acceptance Criteria

- `go build ./...` with no `internal/rules`.
- The dedup key of every incident is `{topic_prefix}/{source}-{rule}`, the same shape the other services publish.
- A compound rule over a field that never changed after startup evaluates with the first-frame value.
- The replay test of SWREQ-017 matches the golden file, except for the two documented changes: incident rules with `edge="none"` load, and no orphan resolve.

- A test drives one poll cycle and one timer tick, and checks that MCAP received one message, not two.
- A test takes a device offline and checks that the MCAP message of the last real report is unchanged.

## Verification Plan

- **Method**: test.
- **Procedure**: The service test suite, a first-frame test, a mutex race test with `-race`, and the replay test.

## Notes

The frame loop blocks in `sc.Scan()`. The mutex is the smallest change. A channel design is possible later.
