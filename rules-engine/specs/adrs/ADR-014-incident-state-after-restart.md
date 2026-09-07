---
id: "ADR-014"
type: architecture_decision_record
name: "Assume every incident active at startup, and let the first evaluation decide"
description: >
  Three ways to recover the incident state after a restart: resolve all at
  startup, persist the active keys, or assume active and decide on the first
  evaluation.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-004"
---

# Architecture Decision: Assume every incident active at startup, and let the first evaluation decide

## Context and problem statement

The `active` flag of an incident rule lives in memory. After a restart the
engine does not know which incidents the forwarder shows as open. Three
cases exist. The condition is still true. The condition became false during
the restart. The rule is no longer in the file.

## Key factors

- An incident that stays open without a cause is a false page.
- An incident that closes and reopens on every deployment is noise, and a new page for the on-call staff.
- The service directory `/svc` is read-only on the BL335. A state file needs another writable path.
- The forwarder treats a trigger for an open key as a duplicate, and a resolve for an unknown key as a no-op.

## Considered options

- Option 1: publish a resolve for every incident rule at startup.
- Option 2: persist the set of active dedup keys in a state file.
- Option 3: mark every incident rule active at startup, and let the first evaluation emit a trigger or a resolve.

## Decision Outcome

Chosen option: "Option 3". It is stateless, it closes stale incidents as soon as data arrives, and it does not reopen a live incident. It does not cover a rule that the new file no longer contains. Option 2 covers that case and can come later.

### Positive Consequences

- No state file, no writes to flash, no corrupt-file handling.
- A still-true condition produces one duplicate trigger, which the forwarder absorbs. No flap.
- A false condition produces one resolve per incident rule, which closes stale incidents.

### Negative Consequences

- A rule that was renamed or removed leaves its incident open until an operator closes it.
- A device that never reports after the restart leaves its incident open. This is the safe choice: the state is unknown.
- One resolve per incident rule at the first evaluation, even for incidents that were never open. The forwarder ignores them.

## Pros and Cons of the Options

### Option 1: resolve all at startup

- Good, because it is stateless and two lines of code.
- Good, because it closes every stale incident at once, before any data arrives.
- Bad, because a still-true condition closes and reopens on every deployment. The forwarder creates a new incident and pages again.
- Bad, because it does not cover a removed rule either.

### Option 2: persist the active keys

- Good, because it covers all three cases, the removed rule included.
- Good, because the cooldown timers can persist with the keys.
- Bad, because it needs a writable path outside `/svc`, an atomic write, and a corrupt-file path.
- Bad, because it writes to flash on every trigger and resolve.
- Bad, because a state file that belongs to an older rules file needs reconciliation logic.

### Option 3: assume active, decide on the first evaluation

- Good, because it is stateless and covers the two common cases.
- Good, because a live incident does not flap.
- Bad, because it does not cover a removed rule.
- Bad, because the resolve waits for the first data of the device. A device that never reports keeps the incident open.

## Links

- SYSREQ-015, SCEN-014.
- tsend2mqtt `Reset` on reconnect keeps its immediate resolves (SYSREQ-014). It can adopt option 3 in a later version.
