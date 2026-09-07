---
id: "SYSARCH-002"
type: system_architecture
name: "Service adapter and data flow"
description: >
  Each service keeps a thin adapter: it builds the catalog, owns the value
  slots, calls Eval on data and on a timer, and publishes.
platform: "Go services on IOT2050 (arm64) and BL335 (arm/v7)"
satisfies:
  - "SYSREQ-007"
  - "SYSREQ-010"
  - "SYSREQ-011"
  - "SYSREQ-013"
  - "SYSREQ-014"
---

# Architecture: Service adapter and data flow

## Technical Strategy

The engine does not know PLC frames, IO-Link ports or Modbus registers. Each
service maps its decoded data to a flat slot array and hands the array to the
engine. The service keeps its transport, its discovery, its publisher and its
logging.

## Terms

- **Device report**: the decoded fields that one successful poll of one device returns. In modbus2mqtt this is a `bus.Report` with values. In iolinkmaster2mqtt it is the decoded process data of one port in one poll cycle. In tsend2mqtt it is one frame, which always carries every field.
- **Slot**: one entry of the value array. Slot `i` holds the value of `Catalog.Fields[i]`.
- **Firing**: one evaluation in which a rule emits its actions, its incident trigger, or both.
- **Pulse**: a condition that is true only in the evaluation where a value changed.

## Static View (Structure)

```mermaid
graph LR
    subgraph svc["ingestion service"]
        disc["discovery<br/>fields and types"]
        cat["Catalog<br/>Fields, Sources, TopicPrefix, Period"]
        slots["[]any slots<br/>one per field"]
        tick["timer<br/>every Period"]
        pub["publisher<br/>QoS 1 actions and incidents"]
    end
    subgraph eng["rules-engine"]
        load["Load"]
        e["Engine.Eval / Reset"]
    end
    disc --> cat
    cat --> load
    load --> e
    slots --> e
    tick --> e
    e --> pub
```

| Responsibility | Service | Engine |
|---|---|---|
| Know the devices, tags and types | yes | no |
| Read and validate the rules file | calls `Load` | yes |
| Own the slot array, write values and `nil` | yes | reads |
| Write `nil` for a catalog field that a device report lacks | yes | no |
| Detect changes between calls | no | yes |
| Edge, cooldown, incident state, time windows | no | yes |
| Render the incident JSON | calls `Message` | provides |
| Publish to MQTT | yes | no |
| Timer for time functions | yes | evaluates |
| `Reset` on reconnect | calls | provides |

## Dynamic View (Behavior)

```mermaid
sequenceDiagram
    participant T as transport
    participant A as adapter (one goroutine)
    participant E as Engine
    participant M as MQTT
    T->>A: decoded values for device d
    A->>A: slots[i] = value for each field of d
    A->>E: Eval(slots, now)
    E-->>A: actions, incidents
    A->>M: publish actions (QoS 1, in order)
    A->>M: publish incidents (QoS 1, incidents/)
    Note over A,E: every Period without data
    A->>E: Eval(slots, now)
    Note over A,E: device d offline
    A->>A: slots of d = nil
    A->>E: Eval(slots, now)
```

## Per service

| Service | Catalog source | Device in `<cond>` | Timer | Reset |
|---|---|---|---|---|
| tsend2mqtt | `.udt` layout fields, S7 types | absent, `Device == ""` | 1 s, under the frame mutex | on TCP reconnect |
| iolinkmaster2mqtt | `driver.DiscoverFieldTypes` | required | the poll cycle | no |
| modbus2mqtt | driver field types | required | the aggregator loop | no |
