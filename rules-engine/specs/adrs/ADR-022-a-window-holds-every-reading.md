---
id: "ADR-022"
type: architecture_decision_record
name: "A window holds every reading, and RATE measures the span it holds"
description: >
  The engine records one reading per evaluation, not one per change, and RATE
  divides by the time between the two readings it used.
status: accepted
deciders:
  - "octanis engineering"
justifies:
  - "SWDD-008"
---

# Architecture Decision: A window holds every reading, and RATE measures the span it holds

## Context and problem statement

Two questions had two answers each, and the shared case file avoided both.

**What does a window contain?** The engine recorded a sample only when a value
moved. The editor's simulator averaged every sample. So `AVG(temp, 10min)` on a
value that sits at 10 for nine minutes and 100 for one minute read 55 on the
gateway and 19 in the editor. Every `AVG` and `RATE` case in
`../schema/eval-cases.json` used a constant series or an unknown value, which
are the two places the two models agree.

**What does RATE divide by?** It divided by the width of the window. A window
that is not yet full then reports a fraction of the truth: two minutes into a
thirty minute window, a fifteenth of it. The old acceptance criterion recorded
this as a rounding note of one part in sixty-four, which is what it becomes
only once the window is full.

## Key factors

- An operator reads "the mean over ten minutes" as the mean of the readings. A mean over the distinct values is not something a person asks for.
- A number that is wrong by a factor is worse than no number. The engine already answers unknown where it knows nothing.
- Memory must not depend on the poll rate. Recording every reading must not cost more than recording the changes.
- Ten more functions read this window. A wrong answer here is a wrong answer eleven times over.

## Considered options

- A window holds every reading, and RATE measures the span between the two readings it used.
- A window holds only the changes, and the editor is changed to match.
- Leave both, and keep the case file away from the disagreement.

## Decision Outcome

Chosen option: "A window holds every reading, and RATE measures the span
between the two readings it used."

The engine records one reading per evaluation for every slot a window follows.
Change detection is untouched: a rule still evaluates only when one of its
inputs moved, and `STALE` still reads the last change.

`RATE` divides by the time between the oldest and the newest reading in the
window. Those two moments are the starts of their buckets, so the span is
exact to one bucket, which is at worst a sixty-fourth of the window. Readings
in a single bucket give no span, and the answer is unknown.

### Positive Consequences

- A thirty minute window told the truth after thirty minutes. It now tells it after about a minute.
- The one-part-in-sixty-four note is gone with its cause.
- The window functions added beside RATE all read a window that means what it says.

### Negative Consequences

- Sampling every slot on every evaluation would have cost the product of slots and windows, so the windows are indexed by slot. Most slots carry none, and the common case is one length check. `Eval` still allocates nothing.
- `AVG` and `RATE` answer differently than they did in v0.3.1. No file in the field uses them.

## Pros and Cons of the Options

### Every reading, and the span

- Good, because a mean is the mean of the readings, which is what was asked for.
- Good, because a partly filled window is useful instead of misleading.
- Bad, because it changes two functions that were already released.

### Only the changes

- Good, because the engine does not change.
- Bad, because `AVG` stays the mean of the distinct values, which is hard to explain and harder to justify.

### Leave both

- Bad, because the editor is meant to tell an operator what the plant will do.

## Links

- SWREQ-010, SWDD-008, SYSREQ-008.
