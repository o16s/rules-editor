---
id: "SWREQ-017"
type: software_requirement
name: "Service behavior tests"
description: >
  Each service replays a scripted sequence of values against its own adapter
  and the module, and compares what it publishes with an expected file.
specification: >
  Each service must hold a scripted sequence of values and the actions and
  incidents its rules must produce, and must replay it against the module in
  its test suite.
derives_from:
  - "SYSARCH-002"
depends_on:
  - "SWREQ-014"
  - "SWREQ-015"
  - "SWREQ-016"
---

# Software Requirement: Service behavior tests

## Requirement Specification

> Each service must hold a scripted sequence of values and the actions and incidents its rules must produce, and must replay it against the module in its test suite.

## Rationale

No service runs the shared engine yet, and no rule file in the field uses the
0.3 format, so there is no old behavior to preserve and nothing to record
from the engines the services are dropping. What each service still needs is
a test that shows its own adapter feeding the engine correctly: the catalog it
builds, the slots it fills, the timer it runs and the messages it publishes.

## Logic & Interface Details

- The sequence is a JSON file in the service: a list of steps, each with a time offset and a map of `device.tag` to value. `null` means offline.
- The expected file is a JSON list of the actions (`topic`, `payload`) and incidents (`action`, `dedup_key`, `severity`, `summary`) per step, written by hand from the rules of the service and its documentation.
- The test builds the catalog the way the service builds it, loads `examples/rules.xml`, replays the steps, and compares.
- The steps cover, for each service: a rising edge, a falling edge, a cooldown that holds, a device going offline, and one timer tick with no new data.

```json
{ "steps": [ { "t_ms": 0,    "values": { "pump1.error_code": 0 } },
             { "t_ms": 1000, "values": { "pump1.error_code": 5 } },
             { "t_ms": 2000, "values": { "pump1.error_code": null } } ] }
```

## Acceptance Criteria

- Each of the three services has the two files and the test.
- The test fails when the adapter stops filling a slot, stops calling the timer, or changes a topic.
- The expected file names the rule behind each message, so a reader sees why it is there.

## Verification Plan

- **Method**: test.
- **Procedure**: The test runs in the CI of each service.

## Notes

The module already loads and replays the example files of the three services
in `rules/service_test.go`. The test here is the other half: it drives the
service adapter, not the engine alone.
