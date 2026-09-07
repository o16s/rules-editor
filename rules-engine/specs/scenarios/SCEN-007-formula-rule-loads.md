---
id: "SCEN-007"
type: scenario
name: "Operator saves a formula rule and the service loads it"
description: >
  A rule with variables and a formula row, written by the 0.3 editor, loads on
  the service and behaves as documented.
refines:
  - "UC-001"
  - "UC-004"
---

# Scenario: Operator saves a formula rule and the service loads it

## Overview

This is the main path of the formula language. Today it fails on every
service.

## Initial State

- The editor is at 0.3. The service uses the shared engine.
- The catalog has `vibration1.temperature` (number) and `vibration1.maintenance` (boolean).

## Trigger

The operator saves this rule and uploads the file to the hub:

```xml
<rule name="hot-and-live" cooldown="10m" edge="rising">
  <variables>
    <var name="temp" formula='TAG("vibration1", "temperature")' description="Housing temperature"/>
    <var name="hot" formula="temp &gt; 50"/>
  </variables>
  <cond expr='AND(hot, NOT(TAG("vibration1", "maintenance")))' description="Hot outside maintenance"/>
  <incident source="vibration1" severity="warning" summary="=condition.description"/>
</rule>
```

## Step-by-Step Flow

1. [Reaction]: The hub validates the file against the XSD and stores it.
2. [Reaction]: At startup the service validates the structure. There is no problem.
3. [Reaction]: The service binds the rule. `temp` and `hot` are inlined into the condition. `TAG` calls resolve to slots.
4. [Reaction]: The condition has the boolean type. The Then field `summary` compiles.
5. [Reaction]: The service logs `rules loaded count=1`.
6. [Action]: A poll returns `temperature` = 55 and `maintenance` = false.
7. [Reaction]: The rule triggers an incident with `summary` `Hot outside maintenance`.

## Expected Outcome

- [Success Condition]: The service loads the rule without a problem and triggers once.
- [Verification]: A `Load` test with this file, and an `Eval` test with the two values.

## Exceptions & Edge Cases

- [Unknown tag]: If `vibration1.humidity` is not in the catalog, `Load` reports `rules/rule[1]/variables/var[1]@formula: unknown tag`.
- [Not boolean]: If the condition is `temp + 1`, `Load` reports that the condition must be true or false, with the same words as the editor.
- [Old engine]: A service without the shared engine fails with `<cond> missing tag attribute`.
