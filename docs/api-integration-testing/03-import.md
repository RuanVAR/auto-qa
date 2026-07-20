# Postman & OpenAPI Import — Phase B

## Focus — what and where

| File | Change |
|---|---|
| `apps/api/package.json` | New dependency: `@apidevtools/swagger-parser` |
| `apps/api/src/modules/integrations/import/openapi-parser.ts` (new) | OpenAPI 3.x JSON/YAML → common draft shape |
| `apps/api/src/modules/integrations/import/postman-parser.ts` (new) | Postman Collection v2.1 → common draft shape |
| `apps/api/src/modules/integrations/integrations.controller.ts` | New route: `POST /projects/:projectId/integrations/:id/import` |

## Why critical

Without import, every Integration and every Endpoint has to be hand-typed one field at a time —
technically complete, but not what makes this feature actually useful at real-world scale. A
real API under test can easily have dozens of endpoints; hand-typing them defeats the purpose of
"integrate with a system and run a full data flow." Import is what turns the Phase A data model
into a genuinely fast onboarding path, which is the whole point of the feature from a user's
perspective.

## Method

**No Postman or OpenAPI parsing library exists anywhere in this monorepo today** — confirmed by
searching every `package.json` in the workspace. This is new dependency surface, scoped
deliberately narrow:

- **OpenAPI 3.x**: use `@apidevtools/swagger-parser`. Hand-rolling `$ref` resolution is a real
  correctness trap (nested refs, circular refs, external refs) — not worth reinventing when a
  well-maintained library does it correctly. Added to `apps/api/package.json` only (parsing is an
  API-side, not worker-side, concern).
- **Postman Collection v2.1**: hand-rolled parser, not the official SDK. The v2.1 schema is
  public, stable, and straightforward to walk (`item[]` recursively, mapping
  `request.url`/`request.method`/`request.header[]`/`request.body`/`request.auth`) — the official
  Postman SDK is heavy for what's actually needed here and pulls in assumptions not relevant to
  this codebase.

Both parsers converge on **one common output shape**, so the API/UI layer above them never needs
to know which format was uploaded:

```ts
interface IntegrationImportResult {
  baseUrl?: string;
  authType?: IntegrationAuthType;
  authConfig?: Record<string, unknown>;
  endpoints: Array<{
    name: string;
    method: string;
    path: string;
    defaultHeaders?: Record<string, string>;
    defaultQuery?: Record<string, string>;
    defaultBody?: unknown;
    requestSchema?: unknown;   // OpenAPI only
    responseSchema?: unknown; // OpenAPI only
    sourceOperationId?: string;
  }>;
  warnings: string[];
}
```

**Auth-type mapping is deliberately best-effort, never a hard failure.** Postman supports auth
types this plan's v1 doesn't (`aws4`, `ntlm`, `digest`, `hawk`, `oauth2`) — those import as
`authType: NONE` with a warning message, leaving the user to fill in auth manually afterward. A
partial import that surfaces what it couldn't map is more useful than a rejected import.

**Base URL inference**: OpenAPI's `servers[0].url`, or Postman's `{{baseUrl}}` collection variable
(or the first request's origin as a fallback) — pre-filled into `Integration.baseUrl` for the user
to **confirm**, not silently accept, since specs frequently point at a sandbox/staging host that
differs from what the user actually wants to test against.

**Flow**: upload a file or paste text on the Integration setup page → parse → **preview** the
drafted endpoints + any warnings → user confirms → `IntegrationEndpoint` rows are created, and
`Integration.baseUrl`/`authType` are pre-filled (still user-editable). The raw parsed spec is
stored in `Integration.sourceRaw` (size-capped) so a future re-sync/diff feature (explicitly
deferred — see `05-security-rbac.md`'s Deferred section) has something to diff against without
re-uploading.

## Verification

- Import a real, small OpenAPI 3.x spec → confirm endpoints are created with correct
  method/path/default headers/query/body, and `baseUrl` is pre-filled from `servers[0].url`.
- Import a real, small Postman v2.1 collection → same checks, plus confirm an endpoint using an
  unsupported auth type (e.g. `aws4`) imports as `authType: NONE` **with a warning surfaced in the
  API response** — not a silent drop, and not a crash that aborts the whole import.
- Import a spec with `$ref`s (OpenAPI) → confirm they resolve correctly (this is exactly the case
  hand-rolling would have gotten wrong — explicit reason for the dependency choice above).
- Confirm re-uploading the same spec doesn't duplicate endpoints in an obviously broken way (v1
  behavior can be "create new drafts, let the user delete stale ones" — full re-sync/diff is
  explicitly deferred, but a naive re-import shouldn't corrupt existing data either).
