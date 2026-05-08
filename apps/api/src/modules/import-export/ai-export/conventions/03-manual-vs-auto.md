# Manual vs automated tests

The platform supports both — they share the same `TestDefinition` shape.
What differs is **how the steps are executed**.

## Test type vs run mode

Two orthogonal axes:

- `TestDefinition.type` — `UI` | `API` | `SHELL` — what the test asserts against
- A run's `runMode` — `AUTOMATED` | `MANUAL` — *who* drives the steps at run time

A `UI` test can be executed in either mode. Same `steps[]` JSON. The
automated runner uses Playwright; the manual runner shows steps as
checklists in the testing view and the engineer ticks them off.

## When to recommend MANUAL

- Steps require human judgement ("does this look right?")
- The system under test isn't accessible to Playwright (native mobile,
  third-party tools, payment redirects)
- Exploratory test cases without a fixed flow

In test JSON: nothing distinguishes manual from automated. The user picks
the mode at run time. If the user's prompt is "draft a manual test", just
write the same step-by-step structure — selectors are still useful as
human navigation hints.

## When to recommend AUTOMATED

- Deterministic flows with stable selectors
- Regression coverage that runs in CI
- API contract tests
- High-volume scenarios

## Hybrid runs

The platform records `executedBy` per step (`AUTOMATED` | `MANUAL`), so a
run can be "mostly automated, two steps manual". Don't try to model that in
the test definition — it's a runtime concept.

## Don't bias toward one mode in your output

The user's prompt sets intent. If unclear, default to writing tests that
work in either mode — concrete selectors, observable assertions, no
human-in-the-loop steps unless the prompt asks for them.
