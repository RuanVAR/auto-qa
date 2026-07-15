# Triggering automated runs from CI / scripts

Every REST endpoint accepts a **Personal Access Token** (Settings → API tokens)
via the same header as a browser session:

```
Authorization: Bearer qapt_<your-token>
```

Tokens inherit your user's RBAC — env-restricted users can only trigger runs
against environments they can access.

## Start an automated feature run

```bash
curl -s -X POST "$BASE_URL/api/v1/features/$FEATURE_ID/run" \
  -H "Authorization: Bearer $QA_PAT" \
  -H "Content-Type: application/json" \
  -d '{
    "runMode": "AUTOMATED",
    "environmentId": "'$ENV_ID'",
    "trigger": "ci"
  }'
```

- `trigger` labels the run's origin in history: `manual` (default) | `scheduled`
  | `api` | `ci` | `promotion`. CI pipelines should send `ci`.
- Requires the target environment to have **Supports automation** enabled;
  otherwise the call returns 400.
- Response contains `featureRun.id` and the child `testRuns`.

## Poll for the result

```bash
curl -s "$BASE_URL/api/v1/feature-runs/$FEATURE_RUN_ID" \
  -H "Authorization: Bearer $QA_PAT"
```

`status` reaches `COMPLETE` when every test is terminal; per-test statuses are
in `testRuns[]`. Or skip polling entirely and use the outbound webhook below.

## Scheduled runs

Recurring runs need no external cron: **Test Runs page → Scheduled runs →
Schedule** (cron per feature + environment, e.g. `0 2 * * *` nightly). Managed
via `POST /api/v1/projects/:projectId/run-schedules` with
`{ featureId, environmentId, cronExpr, timezone? }`.

## Completion webhook

Set **webhookUrl** (+ optional **webhookSecret**) on the project to receive a
POST when any feature run finishes:

```json
{
  "event": "feature_run.completed",
  "featureRunId": "…", "featureId": "…", "featureName": "…",
  "projectId": "…", "environmentId": "…",
  "runMode": "AUTOMATED", "trigger": "scheduled",
  "passed": 12, "failed": 0, "completedAt": "2026-07-15T02:00:41.000Z"
}
```

When a secret is set the request carries
`x-signature: hex(HMAC-SHA256(secret, rawBody))` — verify with a
constant-time comparison before trusting the payload.

## MCP

The MCP endpoint (`POST /api/v1/mcp`, PAT-authenticated) lets an AI agent drive
the full loop. A typical run/inspect flow:

1. `list_projects` → `list_modules` → `list_features` — navigate to a feature.
2. `list_environments({ projectId })` — find the `environmentId` (and whether
   automation is enabled). **Required** before triggering.
3. `trigger_feature_run({ featureId, environmentId })` — returns
   `{ runId, status, testRunCount }` (trigger recorded as `api`).
4. `list_feature_runs({ featureId })` / `get_feature_run({ runId })` — poll
   status + per-test results (each test carries an `id`).
5. `get_run_logs({ testRunId })` — per-step results with error messages +
   captured artifacts (trace / video / screenshot / log).

Authoring tools are also exposed:
- **Tests** — `search_tests`, `get_test` (returns steps + `config`, incl. a
  SCRIPT test's `config.script`), `create_test`, `update_test` (edit steps, or a
  SCRIPT test's source). SHELL / SCRIPT / raw-JS content requires elevated
  (lead/admin) rights.
- **Structure** — `create_feature`/`update_feature`, `create_module`/`update_module`,
  `create_project`/`update_project`.
- **Environments** — `list_environments`, `create_environment`,
  `update_environment` (name/baseUrl/type/supportsAutomation and `variables` —
  passing `variables` replaces the whole set; secret values are stored
  encrypted and never returned).
- **Context** — `get_feature_context`, `get_test_context`, `get_docs` derive a
  feature/test's scope, acceptance criteria and linked docs.

Every MCP tool call is written to the org audit log; reads respect env-RBAC.
