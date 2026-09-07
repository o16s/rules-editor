---
id: "SWREQ-018"
type: software_requirement
name: "Editor package changes for the shared engine"
description: >
  The TypeScript package changes that the shared engine needs: the action cap
  in the XSD, the fixture files, the case and registry files, and a type-aware
  literal rewrite.
specification: >
  The rules-editor package must add the action cap to the XSD and to
  `model.ts`, and read its fixtures from files. It must write the formula case
  and registry files. It must make the 0.2 rewrite type-aware when a catalog
  is present.
derives_from:
  - "SYSARCH-001"
depends_on:
  - "SWREQ-012"
---

# Software Requirement: Editor package changes for the shared engine

## Requirement Specification

> The rules-editor package must add the action cap to the XSD and to `model.ts`, and read its fixtures from files. It must write the formula case and registry files. It must make the 0.2 rewrite type-aware when a catalog is present.

## Rationale

The engine and the editor share one truth. Half of that truth lives in the
TypeScript package.

## Logic & Interface Details

| Change | File | Detail |
|---|---|---|
| Action cap | `schema/rules.xsd` | `maxOccurs="64"` on `publish`. Schema version `0.3.1`. |
| Action cap | `src/model.ts`, `src/parse.ts` | `LIMITS.maxActions = 64`. `validate()` reports a rule with more than 64 actions. |
| Fixture files | `src/xsd.test.ts`, `scripts/export-fixtures.ts` | The fixture tables move to `schema/fixtures/`. The test reads the directories. |
| Case file | `src/formula.test.ts` | The parse and print expectations move to `schema/formula-cases.json`. The test reads the file. |
| Registry file | `src/formula.test.ts` | The test writes `schema/formula-functions.json` from `FUNCTIONS` and fails when the committed file differs. |
| Type-aware rewrite | `src/formula.ts`, `src/parse.ts` | `legacyCondToFormula` takes the field type from the host catalog when present. On a boolean field, `1` becomes `true`. On a string field, `true` becomes `"true"`. Without a catalog the current behavior stays. |
| Documentation | `README.md` | The Go module, its tags, and the shared files. |
| Package | `package.json`, `.npmignore` | Version `0.3.1`. The fixture files ship, or `.npmignore` excludes them. |

## Acceptance Criteria

- `npm test` passes with the fixtures read from files.
- The XSD, `model.ts` and the Go constants agree on 64 actions, and a test compares them.
- A 0.2 file with `value="1"` on a boolean tag opens in the editor with a catalog as `TAG("B") = true`.

## Verification Plan

- **Method**: test.
- **Procedure**: The vitest suite. The Go registry test on the same commit.

## Notes

The schema version bump to `0.3.1` adds a constraint. No deployed file has
more than 5 actions, so no file breaks. The module starts at
`rules-engine/v0.3.1` to match.
