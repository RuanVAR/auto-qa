# Test anatomy

Every test in the platform is a single JSON object. This is the schema —
match it exactly when generating new tests for re-import.

## Required fields

```json
{
  "name": "User can log in with valid credentials",
  "type": "UI",
  "tags": ["smoke", "auth"],
  "steps": [
    { "type": "NAVIGATE", "url": "/login" },
    { "type": "FILL", "selector": "[data-testid=email]", "value": "user@example.com" },
    { "type": "FILL", "selector": "[data-testid=password]", "value": "Test123!" },
    { "type": "CLICK", "selector": "[data-testid=submit]" },
    { "type": "ASSERT_URL", "expected": "/dashboard" }
  ]
}
```

| Field         | Type            | Notes |
|---------------|-----------------|-------|
| `name`        | string          | One short sentence. Imperative or declarative. Title-case-ish. |
| `description` | string?         | Optional longer body. Markdown ok. |
| `type`        | enum            | `UI` / `API` / `SHELL` |
| `tags`        | string[]        | Lowercase, kebab-case. Examples below. |
| `steps`       | object[]        | At least one. Each step's shape depends on its `type` — see 02-step-types.md. |
| `config`      | object?         | Optional. Test-level config (timeouts, env overrides). Don't invent values. |

## Naming conventions

- Use **active voice** describing the user goal: "User can reset their password"
- Avoid implementation noise: no "(Playwright)", no "TODO", no ticket ids
- Keep under 80 chars
- Don't restate the feature name — it's the parent

## Tag conventions

| Tag       | Meaning |
|-----------|---------|
| `smoke`   | Critical-path; gate for any release |
| `regression` | Wider net; runs nightly or on PR |
| `auth` / `billing` / `search` / … | Functional area |
| `flaky` | Known to be unreliable; opt-out from gating |
| `manual` | Recommended for manual execution |

Use the union of these + tags you see in the existing data (look at
`data.json` to copy the team's vocabulary). Don't introduce a new tag
unless none of the existing ones fit.

## Step ordering

1. **Setup** (NAVIGATE, login, seed data)
2. **Actions** (CLICK, FILL, KEYBOARD)
3. **Assertions** (ASSERT_*)
4. **Cleanup** (rare — usually unnecessary because tests run in clean envs)

Group related actions; insert ASSERT after the action that should produce
the observable change. Don't bury all assertions at the end.

## Selector style

- Strongly prefer `[data-testid=…]` — stable, dev-owned
- Fall back to ARIA roles + names: `role=button name=Submit`
- Avoid: nth-child, deep CSS chains, full xpath

Look at the existing tests' selectors (`data.json`) to match the team's style.

## API tests (`type: "API"`)

Use `REQUEST` for the call, `ASSERT_STATUS` / `ASSERT_BODY` / `ASSERT_HEADER`
for assertions. `EXTRACT` lets later steps reuse a value from a response.

## Shell tests (`type: "SHELL"`)

Use `COMMAND`, `ASSERT_EXIT`, `ASSERT_OUTPUT`, `ASSERT_CONTAINS`. The runner
exec's commands in the worker container — keep them deterministic and
non-destructive.

## What NOT to include

- `id`, `createdAt`, `updatedAt`, `version` — assigned on import
- `featureId` — set by the parent feature wrapping the test
- `runs[]`, `issues[]` — runtime state, not authoring data
