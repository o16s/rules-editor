---
id: "SWREQ-005"
type: software_requirement
name: "Outputs and the incident message"
description: >
  Eval returns Action and Incident values in reused slices. Incident.Message
  renders the wire JSON outside the engine.
specification: >
  `Eval` must return `Action` and `Incident` values in slices that the next
  call reuses. `Incident.Message` must render the incident JSON of the events
  protocol, with the additive fields `first_step` and `cause`.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-004"
---

# Software Requirement: Outputs and the incident message

## Requirement Specification

> `Eval` must return `Action` and `Incident` values in slices that the next call reuses. `Incident.Message` must render the incident JSON of the events protocol, with the additive fields `first_step` and `cause`.

## Rationale

The engine stays free of allocations. The publisher renders JSON once per
incident, which is rare.

## Logic & Interface Details

```go
type Action struct { Rule, Topic string; Payload []byte }
type Incident struct {
    Rule string; Trigger bool
    Source, DedupKey, Severity, Summary, FirstStep, Cause string
}
const IncidentTopic = "incidents/"
type IncidentMsg struct {
    Action string `json:"action"`; DedupKey string `json:"dedup_key"`
    Source string `json:"source"`; Severity string `json:"severity,omitempty"`
    Summary string `json:"summary,omitempty"`; FirstStep string `json:"first_step,omitempty"`
    Cause string `json:"cause,omitempty"`; Time string `json:"time"`
    Data map[string]any `json:"data"`
}
func (i Incident) Message(now time.Time) IncidentMsg

// Stats are counters since NewEngine. The service logs them; the engine
// never logs.
type Stats struct {
    Evals, Firings, Triggers, Resolves uint64
    TruncatedRenders, DroppedActions, UnknownSlotTypes, ClockStepsBack uint64
}
func (e *Engine) Stats() Stats
```

- `Message` sets `Action` to `trigger` or `resolve`, `Time` to `now.UTC()` in `2006-01-02T15:04:05.000Z`, and `Data` to `{"rule": i.Rule}`.
- On a resolve, `Severity`, `Summary`, `FirstStep` and `Cause` are empty.
- The `Action.Payload` of a literal payload points at the bytes parsed at `Load`. The payload of a formula points into the rule buffer (SWREQ-011).
- The slices and the buffers are valid until the next `Eval` or `Reset` call.
- The engine never writes to a log. Every condition worth a log line increments a counter in `Stats`. The service reads `Stats` on its status ticker and logs a change.

## Acceptance Criteria

- A golden test of `Message` for a trigger and a resolve matches the JSON in `docs/rules.md` of iolinkmaster2mqtt, plus the two new fields.
- The capacity of the result slices equals the sum of actions and the count of incident rules, computed in `NewEngine`.
- The `rules` package imports neither `log` nor `log/slog`.

## Verification Plan

- **Method**: test.
- **Procedure**: A golden JSON test. A test that keeps a returned slice across two calls and observes the overwrite.

## Notes

`data.rule` stays for the forwarder. `Incident.Rule` replaces `IncidentMsg.RuleName()` for the status page.
