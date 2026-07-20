# Security & RBAC

## Secret storage — reusing the proven pattern, not inventing one

Investigated three existing encrypted-secret paths in the codebase before choosing:

| Path | Scope | Notes |
|---|---|---|
| `SecretsService` (`apps/api/src/common/secrets/`) | API-only | NestJS `@Injectable`, used for `OrgAiCredential`/`OrgGitCredential`. Cannot be imported by the worker process. |
| `packages/shared/src/crypto/secret-box.ts` | API **and** worker | Functional (not class-based), explicitly documented as byte-identical envelope format to `SecretsService`. Already used by `EnvironmentCredential` and `Project.webhookSecretCiphertext`. |
| `Project.webhookSecretCiphertext` | API | Reuses path B above directly. |

**Decision: use `packages/shared/src/crypto/secret-box.ts` (path B).** It's the only one
importable from both the API (where secrets are created/updated) and the worker (where they need
to be decrypted at run time to actually make an authenticated call to an external API) — exactly
the same reason `EnvironmentCredential` uses it.

Envelope: AES-256-GCM, `[IV (12 bytes) | authTag (16 bytes) | encrypted JSON]`. KEK sourced from
the `SECRETS_KEK` env var (already required on both API and worker for `EnvironmentCredential` to
function — no new deployment requirement). Plaintext is always a `Record<string,string>` JSON
object, matching the shape convention (e.g. `{API_KEY: "..."}`, `{USERNAME, PASSWORD}`).

**Explicitly not a real external KMS (AWS KMS / GCP KMS / Vault).** Considered and rejected for
this plan — it would add a new infrastructure dependency, a credentials-to-manage-the-credentials
problem, and deployment complexity, for no material security gain over the existing in-house
scheme this codebase already trusts for the same class of secret (per-environment logins,
AI/Git provider tokens, webhook signing secrets).

## The `EnvironmentCredential` pattern, mirrored precisely

| Aspect | `EnvironmentCredential` (existing) | `Integration` secrets (this plan) |
|---|---|---|
| Multiple per scope | `@@unique([environmentId, name])` | Not multi-named in v1 — one credential set per Integration (simpler; an Integration already represents one external system) |
| List response | Field keys only, values never returned | Same |
| Write | Normalizes field keys, encrypts via `encryptSecret` | Same |
| Worker decrypt | Best-effort per credential — a failure is skipped, not fatal to the run | Same, via `resolveIntegrationSecrets` |

## RBAC — the bar, and why it's stricter than `EnvironmentCredential`'s

Two RBAC tiers already exist in the codebase for different risk classes:

- **`LEAD_ROLES`** (`environment-credentials.controller.ts`): `{OWNER, TECH_LEAD, MANAGER}` + org/
  platform admins. Used for managing environment login credentials — a config value that gets
  injected as a variable, nothing more.
- **`assertElevatedProjectAccess`** (`env-access.service.ts`): `{OWNER, TECH_LEAD}` + org/platform
  admins (notably **excludes MANAGER**). Used for SCRIPT/SHELL test authoring and environment
  config mutation via MCP — the explicit doc comment on this function calls out its purpose:
  *"privileged authoring actions — e.g. creating tests that execute shell commands or arbitrary JS
  on the worker, which a plain member shouldn't be able to introduce."*

**Decision: Integrations use the stricter `assertElevatedProjectAccess` bar** for create/update/
delete, not the looser `LEAD_ROLES`. Rationale: an Integration isn't just a config value like an
environment credential — it combines secret storage **with** the ability to direct outbound HTTP
calls to an arbitrary configured host, as instructed by any test author who references it. That
combination (credentials + attacker-directable outbound requests) is the same risk class as
SCRIPT/SHELL code execution (SSRF, credential exfiltration via a crafted endpoint URL), not the
"just a stored value" risk class of an environment credential.

**Ping is the one exception, deliberately looser.** `POST .../integrations/:id/ping` is gated at
plain project membership, not the elevated tier, because it never returns secret values (mirrors
the existing openness of `checkIframeEmbeddability`) and is genuinely a read-like convenience
action. It **is** logged to the audit trail, since it still fires a real outbound request using
stored credentials — auditability substitutes for a stricter access gate here.

## SSRF discipline — reusing the existing guard, not introducing a new trust boundary

Every outbound call from `IntegrationClient` runs through the existing `assertSafeTargetUrl`
guard (`apps/worker/src/utils/ssrf-guard.ts`) before firing — the identical discipline already
applied to `ApiStepRunner`'s REQUEST step and the SCRIPT sandbox's `api.*` helpers. This plan does
not introduce a new class of outbound request that bypasses existing protections; it extends the
same protected path to a new source of target URLs (Integration base URLs + endpoint paths,
instead of `Environment.baseUrl`).

The outbound-webhook-firing code (`FeatureRunsService.fireCompletionWebhook`) has its own inline
SSRF check (protocol allowlist + metadata/link-local host blocklist) — worth noting as a precedent
for the same defensive pattern, though `IntegrationClient` should use the shared worker-side guard
rather than duplicating that inline check.

## Deferred (Phase E) — explicitly out of scope for this plan

- **OAuth2 client-credentials + HMAC auth types.** Both need real engine work beyond static-secret
  injection: OAuth2 needs token minting, in-memory caching, and refresh-on-401 or refresh-on-expiry
  logic in `IntegrationClient`; HMAC needs a signing-scheme configuration surface (header names for
  signature/timestamp, algorithm choice). Deferred as a fast-follow once the static-auth core (API
  Key/Bearer/Basic) is proven in production use, not because it's unimportant — many real-world
  enterprise APIs are OAuth2-only, so this is a genuine near-term follow-up, not a someday-maybe.
- **MCP tools for Integrations** (`list_integrations`/`create_integration`/`update_integration`/
  `ping_integration`/`list_integration_endpoints`). Mechanical once the REST API exists — follow
  the exact conventions already established in `mcp.server.ts`: docstring-documented security
  semantics (e.g. "secret values are never returned" stated directly in the tool description so an
  LLM caller doesn't need to read code to know it), whitelisted `select` clauses (never rely on
  stripping secrets after the fact), and `assertElevated` on every mutating tool. Document these in
  `docs/API_TRIGGERING.md` in place — that doc already covers the equivalent environment-management
  MCP tools; an Integration section belongs alongside them, not in a new competing doc.
- **Spec re-sync/diff on re-import**, using the `sourceRaw` column already being stored in Phase B
  for exactly this future purpose.
- **Hardening `getJsonPath`** (`apps/worker/src/steps/api.step.runner.ts`) — the current resolver
  supports dot notation plus a single `key[n]` array index per segment; no wildcards, no `..`
  recursive descent, no multiple indices in one segment. Fine for v1 given typical REST response
  shapes, but OpenAPI-derived deep/nested responses may eventually need real JSONPath support.
- **`ASSERT_SCHEMA` step type**, validating a response against an imported OpenAPI
  `responseSchema` — would need `ajv` (not currently a dependency anywhere in the repo). A natural
  next step once `requestSchema`/`responseSchema` are actually being populated by import (Phase B
  stores them but doesn't use them yet).
