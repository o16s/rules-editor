---
id: "SYSREQ-016"
type: system_requirement
name: "Schema version agreement across the editor, the hub and the services"
description: >
  The editor, the hub validator and the engine implement one schema version,
  and the hub adopts a new version before the services need it.
specification: >
  The editor, the hub validator and the engine must implement the same schema
  version. The hub must adopt a new schema version before, or together with,
  the services that require it.
derives_from:
  - "SCEN-007"
  - "SCEN-011"
depends_on:
  - "SYSREQ-002"
---

# System Requirement: Schema version agreement across the editor, the hub and the services

## Requirement Specification

> The editor, the hub validator and the engine must implement the same schema version. The hub must adopt a new schema version before, or together with, the services that require it.

## Rationale

The hub validates every upload against its copy of the XSD. If a service
implements a newer or older version than the hub, a file gets two verdicts
again. The edge-hub repository is outside this specification, so the
requirement fixes the order of the rollout.

## Acceptance Criteria

- `schema/rules.xsd` `version`, `package.json` `version` and the module tag agree on the major and minor version.
- The release notes of the module name the schema version it implements.
- A release checklist in the module README lists the order: editor and XSD, then the hub, then the services.
- No service requires a module version whose schema the hub does not validate yet.

## Verification Plan

- **Method**: inspection.
- **Procedure**: The existing `vitest` test that compares the XSD version with `package.json`, extended to the module tag. The release checklist, followed at each release.

## Notes

The bump to `0.3.1` for the action cap (ADR-009) is the first case.
