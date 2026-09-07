# Specification set of the rules engine

This directory holds the requirements and the design of the shared rules
engine as a SARA knowledge graph. Each file is Markdown with YAML front
matter. The front matter carries the identifier, the type and the links.
[SARA](https://github.com/cledouarec/sara) validates the graph and answers
traceability queries. The plan that these documents refine is `../PLAN.md`.

## Structure

```
specs/
  solutions/               SOL-001      the solution
  use_cases/               UC-001..006  what an actor wants
  scenarios/               SCEN-001..014 concrete paths, with verification
  system_requirements/     SYSREQ-001..015 what the system must do, measurable
  system_architecture/     SYSARCH-001..002 the module and the service adapter
  software_requirements/   SWREQ-001..018 what each package and each adapter must do
  detailed_design/         SWDD-001..016 how each package and adapter is built
  adrs/                    ADR-001..016 the decisions and their alternatives
```

## Links

The links point upstream, from the detail to the purpose:

| Child | Relation | Parent |
|---|---|---|
| UC | `refines` | SOL |
| SCEN | `refines` | UC |
| SYSREQ | `derives_from` | SCEN |
| SYSREQ | `depends_on` | SYSREQ |
| SYSARCH | `satisfies` | SYSREQ |
| SWREQ | `derives_from` | SYSARCH |
| SWREQ | `depends_on` | SWREQ |
| SWDD | `satisfies` | SWREQ |
| ADR | `justifies` | SYSARCH, SWDD |

## Terms

One word has one meaning in every document:

- **Device report**: the decoded fields that one successful poll of one device returns. tsend2mqtt has one report per frame.
- **Slot**: one entry of the value array that the service owns. Slot `i` holds `Catalog.Fields[i]`.
- **Firing**: one evaluation in which a rule emits actions, an incident trigger, or both.
- **Pulse**: a condition that is true only in the evaluation where a value changed.
- **Problem**: one fault that `Load` reports, with a path.

## How to use SARA on this set

Install SARA with `cargo install sara-cli`. Then, in the `rules-engine`
directory:

1. To validate the graph, enter `sara check`. The configuration `sara.toml` sets strict mode.
2. To see everything under the solution, enter `sara query SOL-001 --downstream`.
3. To see why a design exists, enter `sara query SWDD-003 --upstream`.
4. To see the coverage per type, enter `sara report coverage`.
5. To export the traceability matrix, enter `sara report matrix --format csv -o matrix.csv`.
6. To add a document, enter `sara init <type> <path>`, for example `sara init swreq specs/software_requirements/SWREQ-018-name.md`.

## Writing rules

The documents obey ASD-STE100 Simplified Technical English. Requirements
use `must`. A specification is one to three sentences of at most 25 words.
Code, identifiers and file paths are exact and count as one word. Every ADR
has the status `proposed` until the team accepts it.

## Open decisions

The ADRs with the status `proposed` list the decisions the team must take.
Each one names the alternatives and a recommendation. Section 6 of
`../PLAN.md` has the same list in one table.
