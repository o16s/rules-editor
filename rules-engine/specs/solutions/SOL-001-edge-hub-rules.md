---
id: "SOL-001"
type: solution
name: "Rules on the octaview Edge Hub"
description: >
  One rule file format, one editor and one evaluation engine for every
  ingestion service of the Edge Hub.
---

# Solution: Rules on the octaview Edge Hub

## Overview

An operator writes rules in the rules editor and saves a `rules.xml` file.
The Edge Hub validates the file against `schema/rules.xsd` and stores it in
the service directory. Each ingestion service loads the file at startup and
evaluates the rules against its decoded data. A rule publishes MQTT actions,
raises incidents, or does both. tsend2mqtt reads PLC frames,
iolinkmaster2mqtt polls IO-Link masters, and modbus2mqtt polls Modbus devices.

## Business Context

Today each service has its own copy of the rule engine. The copies drifted in
behavior, and a fix in one copy did not reach the others. The editor writes
the formula language of schema 0.3, and no service evaluates it. An operator
gets different results for the same file on different services. This
solution gives every service one engine, one meaning per rule, and the full
formula language.

## Goals & KPIs

- **Goal**: One engine for all services.
    - *KPI*: The three services import one Go module. No service keeps its own `internal/rules` package.
- **Goal**: A file that the hub accepts loads on every service.
    - *KPI*: Every fixture of `schema/rules.xsd` gets the same verdict from the XSD, the editor and the engine.
- **Goal**: Formulas evaluate at runtime.
    - *KPI*: Every function in `FUNCTIONS` of `src/formula.ts` has a Go implementation and a test.
- **Goal**: No regression for deployed rules.
    - *KPI*: The golden replay test of each service gives the same actions and incidents before and after the migration.
- **Goal**: The hot path stays free of allocations.
    - *KPI*: A benchmark of `Eval` with the example rules reports zero allocations per call.

## Stakeholders

- **Operators**: Write rules in the editor and expect one behavior on every service.
- **On-call staff**: Receive incidents through the `incidents/` topic and the forwarder.
- **Service developers**: Maintain tsend2mqtt, iolinkmaster2mqtt and modbus2mqtt.
- **Edge Hub team**: Validates each uploaded file against the XSD on the server.
- **Editor developers**: Own `schema/rules.xsd` and `src/formula.ts`.

## Constraints

- **Regulatory**: None.
- **Physical & Design Context**: The BL335 gateway (linux/arm/v7) and the IOT2050 gateway (linux/arm64). Static Go binaries with `CGO_ENABLED=0`. No 64-bit atomics.
- **Operational**: The rules file is `/svc/rules.xml` on the BL335 and a configured path on the IOT2050. The incident wire format of `tsend2mqtt/docs/events-protocol.md` stays valid.
- **Safety & Security**: A rule can command a device, for example stop a pump. A wrong evaluation is a safety problem. The engine must refuse a bad file at startup, not at runtime.
- **Business**: The Power of Ten coding rules apply. The library uses the Go standard library only. The XSD stays the single definition of the format.
