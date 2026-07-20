# 09 — Build conventions

How to build in this codebase. Read before writing code for any phase.

These are derived from what the codebase already does well — they are mostly
documentation of existing practice, not new rules.

---

## 1. Definition of done

A change is done when **all** of these hold:

- [ ] `pnpm lint` passes (Biome — the actual CI gate)
- [ ] `tsc --noEmit` clean on every app touched
- [ ] Unit tests written for new logic, and the full suite passes
- [ ] Migration applied and **verified against a real database**, not just generated
- [ ] Manually exercised in the dev stack — not "it compiles"
- [ ] No new `any`; no `console.log` in API/worker (use the logger)
- [ ] Secrets: nothing new logged, persisted in plaintext, or added to a build context
- [ ] Conventional Commit, bullet-list body, **no Co-Authored-By trailer**

---

## 2. Database and migrations

### Rules
1. **Never edit an applied migration.** Write a new one.
2. **Expand → migrate → contract.** `prisma migrate deploy` runs in
   `deploy-prod.sh:167` **while the old containers are still serving**
   (`:172` restarts them). A destructive migration therefore breaks the running
   app for the build window. So:
   - Adding a column: safe, do it directly
   - Renaming: add new → backfill → dual-read → drop in a later release
   - Dropping: only after a release where nothing reads it
3. **Backfill in the migration** when a new column must be non-null for existing
   rows — see `20260718000000_project_transfer` for the pattern (add nullable →
   `UPDATE` → add constraint).
4. **Partial and conditional unique indexes must be hand-written** — Prisma cannot
   express them. Put them in the migration SQL with a comment saying why, and
   enforce the same rule in the service so callers get a clean 409 rather than a
   raw constraint error.
5. Every migration must be reversible **on paper** — write the down steps in a
   comment even though Prisma does not run them.

### Verifying a migration
```bash
docker exec qa-api-dev sh -lc "cd /app/apps/api && npx prisma migrate deploy"
docker exec qa-api-dev sh -lc "cd /app/apps/api && npx prisma generate"
docker exec qa-api-dev sh -lc "cd /app/apps/api && npx tsc --noEmit"
# then assert the data is actually as intended
docker exec qa-postgres psql -U qa_user -d qa_platform -c '<verification query>'
```

---

## 3. Concurrency — the rules that keep this system correct

The queue and executor are the most dangerous code here. Existing invariants:

1. **Claim before work.** State transitions that guard execution use a conditional
   `updateMany` (compare-and-swap), never read-then-write. Transactions run at
   READ COMMITTED, so a plain check passes in both racers.
   ```ts
   const claimed = await tx.x.updateMany({ where: { id, status: 'PENDING' }, data: {...} });
   if (claimed.count === 0) throw new ConflictException('already resolved');
   ```
2. **Deterministic job ids** (`run-${runId}`) so enqueue is idempotent.
3. **Side effects never fail the operation.** Email, notifications and audit are
   wrapped so a failure logs and continues.
4. **Audit into both orgs** for anything cross-org — `audit_logs` is queried
   per-org, so one row makes the event invisible from one side.
5. **The worker does not write to the database** except its own claim. Everything
   else goes through Redis events to the API. Preserve this — it is what keeps the
   worker deployable independently.

---

## 4. Security

1. **Every outbound URL from the worker goes through `assertSafeTargetUrl`.** No
   exceptions — [1.3](03-PHASE-1-CORRECTNESS.md) exists because one path skipped it.
2. **Secrets are classified at resolve time**, not detected by pattern later.
   Anything derived from `EnvironmentCredential` or an encrypted env var is marked
   secret and scrubbed from evidence.
3. **404, not 403, for cross-tenant access.** A non-member must not learn that a
   resource exists. Established pattern in `env-access.service.ts` and the
   transfers controller.
4. **Authorisation is resolved from the database, not the JWT**, wherever the
   route does not carry the org in its path. `user.orgRole === 'ORG_ADMIN'` means
   the caller is an admin *somewhere*, not *here*.
5. **Never add a file to a Docker build context that could contain a secret.**
   `.dockerignore` uses `.env*` — do not narrow it.

---

## 5. Testing

### What to test where
| Kind | Where | When |
|---|---|---|
| Pure logic (interpolation, fingerprinting, scoring) | Unit, mocked deps | Always |
| Concurrency, claims, transactions | **Integration against a real DB** | Always |
| Multi-table invariants | Integration | Always |
| UI rendering | Skip unless the logic is non-trivial | Rarely |

**Mocked-Prisma tests are not acceptable for anything involving a transaction, a
race, or a multi-table invariant.** They assert that the mocks were called. The
double-accept bug in the transfers feature was found only because those tests ran
against a real database.

Integration tests: `apps/api/test/*.e2e-spec.ts`, run via `pnpm test:e2e`. They
boot only the providers under test — not `AppModule` — so they do not collide with
the running dev stack.

### Test data hygiene
Unique per run (`Date.now()` + random suffix), and clean up in `afterAll` in
FK-safe order. Never touch seeded or real data.

---

## 6. Frontend

1. **`errMsg(err, fallback)` only unwraps the axios error shape.** A thrown
   `Error` falls through to the fallback — so expected, explainable failures
   should be *returned as data* and rendered inline, not thrown and toasted.
   (This caused a real bug; see the transfer UI commit.)
2. **Toast for unexpected failures; inline for expected ones.** An invalid code, a
   validation failure, a business-rule rejection all belong next to the input.
3. **`data-testid` on every interactive element**, `{feature}-{descriptor}`.
4. **The app is not on a data router** — `useBlocker` is unavailable. Unsaved-changes
   guards need `beforeunload` plus an explicit confirm.
5. Match the surrounding style. Several pages are light-mode inside a dark app
   (`RunDetailPage`, `AiPage`, `PipelinesPanel`, `SchedulesPanel`) — do not add more.
6. Files over ~1,500 lines are past maintainable. `TestingView.tsx` (4,501) and
   `FeaturePage.tsx` (4,995) should be split when touched substantially.

---

## 7. Worker

1. **Every step type must handle its own timeout** and surface the *actual* value
   seen on failure, not just "assertion failed".
2. **Never one-shot read for an assertion.** Poll. A one-shot read races the
   application and was the cause of a real flake class.
3. **Resolve relative URLs against `baseUrl` before the SSRF check**, not after.
4. **Artifacts are uploaded then unlinked**; the staging dir is removed in
   `finally`. Do not leave temp files.
5. New step types must be added in **four** places, and there is no enforcement
   linking them:
   - `StepType` enum — `schema.prisma:143`
   - `STEP_TYPES` — `packages/shared/src/types/index.ts:20`
   - AI catalogue — `ai/prompts/base/output-schemas.ts:18` (deliberately a subset)
   - DSL verbs — `packages/shared/src/dsl/verbs.ts`

   **Consider unifying these** — the stable-selector regex is currently
   triplicated verbatim across three of them.

---

## 8. AI

1. **The Zod schema in `output-schemas.ts` is the single source of truth** — it
   drives runtime validation, the JSON-schema block injected into the prompt, and
   the TS types via `z.infer`. Do not add a parallel definition.
2. **Proposals never auto-save.** Everything routes through explicit human
   acceptance. This is correct and matches where the whole market has landed.
3. **Prompts are versioned** (`promptVersion`, e.g. `tests-from-feature@1.2`) and
   the version is stored on every `AISummary`. Bump it on any material change.
4. **Cost is always recorded** — `AISummary.costUsd`. No AI call without a ledger entry.
5. **Beware coverage circularity.** Generating tests from acceptance criteria and
   then reporting AC coverage as traceability confirms the requirements' blind
   spots as if they were rigour. Say so in the UI.

---

## 9. Naming and copy

- **"Selector drift detection"**, never "self-healing" — the term is damaged in
  this market ([Phase 2](04-PHASE-2-HEALING.md) §2).
- Never claim a capability the code does not have. Two existing examples caused
  real credibility damage: "AI Description (helps self-healing)" on a field the
  worker never reads, and a "Heals Today" tile hardcoded to `0`.
- Prefer honest, specific numbers over superlatives. **Publishing a measured
  heal-precision or flake rate is a differentiator precisely because no competitor
  does it.**

---

## 10. Documentation

- Every phase document in this folder states its own preconditions, file targets,
  schema changes, acceptance criteria and rollback.
- **Every claim about the codebase carries a `file:line`.** If you cannot cite it,
  verify it before writing it down.
- When a plan item ships, update its checkbox **and** note any deviation from the
  spec, with the reason. The deviation is usually the most valuable part.
