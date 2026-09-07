---
id: "UC-001"
type: use_case
name: "Write a rule once and deploy it to any service"
description: >
  An operator writes one rules file in the editor and deploys it to any
  ingestion service with the same meaning.
refines:
  - "SOL-001"
---

# Use Case: Write a rule once and deploy it to any service

## Actor(s)

- **Primary Actor**: The operator who writes the rules.
- **Secondary Actors**: The rules editor, the Edge Hub, and the ingestion service.

## Pre-conditions

- The operator knows the device names and the tag names of the service.
- The service is installed and knows its fields (the catalog).
- The editor and the service implement the same schema version.

## Main Success Outcome

The operator saves one file in the editor. The Edge Hub accepts the file. The
service loads it and evaluates every rule with the documented meaning. The
same file loads on a second service that has the same devices and tags.

## Key Functional Scope

- **One format**: `schema/rules.xsd` defines the file. The editor, the hub and the engine agree on every fixture.
- **Portability**: A `<cond>` without `device` is valid for a service with one data source.
- **Feedback**: The service logs every problem of the file at startup, each with a path.
- **One meaning**: Every service evaluates with the same engine code.

## Post-conditions

- **Success Condition**: The service logs `rules loaded` with the rule count and evaluates the rules.
- **Failure Condition**: The service exits at startup and logs every problem with its path. No rule is loaded.
