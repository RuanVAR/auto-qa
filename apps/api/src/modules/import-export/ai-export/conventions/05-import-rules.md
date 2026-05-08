# Import rules

When you produce content for re-import, the platform's importer runs these
checks. Failing any check means the whole import is rejected — you'll get
a 400 with the offending path.

## Envelope shape

The importer accepts the same envelope shape as `data.json` — only fields
that need to differ:

- `version` — keep what you saw on export.
- `exportedAt` — irrelevant on import; you can omit.
- `platformVersion` — irrelevant on import.

For project-level imports, the top-level `project` object can include new
modules / features / tests. Existing items (matched by `name`) are
**skipped**, not overwritten — so your output is additive only.

## Match-by-name idempotency

| Layer    | Match key                              | If match exists |
|----------|----------------------------------------|-----------------|
| Module   | `(projectId, name)`                    | Skipped         |
| Feature  | `(moduleId, name)`                     | Skipped         |
| Test     | `(featureId, name)`                    | Skipped         |
| Doc      | (re-importing local docs not supported in v1; skip) | n/a |

This means: re-running your import with the same names is a no-op. The
user can re-prompt you for "more tests for the Login feature" and your
new tests slot in beside the existing ones.

## Rejection rules — most common reasons

1. Top-level `project.name` doesn't match the destination project. Don't
   change the project name in your output. If the user wants a new
   project, they'll create one separately and re-target the import.
2. A test has `steps: []` AND `type: "UI"`. Empty steps are allowed only
   on stub tests (rare). Default: include at least one step.
3. A step's `type` isn't in the `StepType` enum. See 02-step-types.md for
   the canonical list.
4. A step is missing a required field for its type (e.g. CLICK without
   `selector`).
5. `tags` contains a non-string entry.

## What you should leave alone

If `data.json` already has a feature called "Login flow" with 4 tests, and
the user prompts "add more login tests" — your output should:

- Reference the existing feature **by name** (so the importer matches it
  and slots tests inside, not creates a duplicate feature)
- Add ONLY the new tests under that feature
- Not re-emit the existing tests (the importer skips them by name anyway,
  but cleaner output = easier review for the user)

## Round-trip-safe output

If the user wants to verify your output before importing, they can:

1. Load `data.json` into a JSON viewer
2. Diff your output against it
3. Spot-check the new items
4. Then run the import

Make this easy — don't reorder existing items, don't reformat existing
strings, don't regenerate fields unnecessarily.
