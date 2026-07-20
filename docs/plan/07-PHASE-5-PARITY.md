# 07 — Phase 5: Parity

**These are sales gates, not user gates.** Existing users do not churn without
them; *prospects refuse to evaluate* without them. Schedule against a sales need.

Every item here was verified present in both Qase and Testomat (and mostly in
TestRail, Xray, Zephyr and PractiTest too). Pricing context: TestRail **$37–74**
per seat/mo, PractiTest **$47** (10-seat minimum), Qase **$24–30**, Testomat
**$27–30**, Allure **$39**, Xray/Zephyr ~**$5–6** per Jira user.

**Total effort: ~4–6 weeks** for the full set.

---

## 5.1 — Shared / reusable steps `[ ]` M ⭐ first thing evaluators check

Every single tool in the survey has this. We have **nothing** — each test's steps
are a private JSON blob, so a login flow is copy-pasted N times and edited N times.

### Copy Qase's 2026 implementation specifically
- Project-level **and** workspace-global scope
- **Folder hierarchies** for organising the step library
- **Nested child steps** inside a shared step
- Bulk local→global promotion
- **Cascading-delete safety** — show which cases break before deleting

Plus from Allure: an **archive** state (stop new reuse, preserve existing
references) and an "inspect dependents before editing" view.

### Scoping — project-first, org-global by deliberate promotion

**The default scope is the project.** Org-global exists, but only as an explicit
promotion, never as the place things are created.

The reasoning is blast radius. A shared step is a *live reference*, not a copy —
that is the whole point of the feature. So editing one changes every test that
references it, and the scope decides how far that change reaches:

| Scope | Blast radius | When it is right |
|---|---|---|
| **Project** (default) | Tests in one project | Almost always. A login flow for Project A is rarely Project B's login flow, even inside one org. |
| **Org-global** | Every test in every project in the org | One org testing several products that genuinely share a surface — the same SSO login, the same design-system component, the same cookie banner. |

Creating org-global by default would mean a routine edit to "Login" silently
changes the behaviour of tests in projects the editor has never opened. That is
how shared-step libraries become things teams are afraid to touch.

So: **create in the project, promote to org-global as an explicit action** that
names the projects about to be affected. Same rule for parameters (5.2).

Promotion needs `ORG_ADMIN`, because it is the point where one project's decision
starts affecting others.

### Schema
```prisma
model SharedStep {
  id          String   @id @default(uuid())
  orgId       String
  /// NULL = org-global. Non-null = scoped to one project, which is the default
  /// and the only scope things are created in. Promotion to global is explicit
  /// and ORG_ADMIN-gated, because it widens the blast radius of every future
  /// edit from one project to the whole organisation.
  projectId   String?
  folderId    String?
  name        String
  description String?
  steps       Json                // Step[] — same shape as TestDefinition.steps
  isArchived  Boolean  @default(false)
  version     Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([orgId, projectId, isArchived])
}
```

Resolution order when a test references a shared step by name: project scope
first, then org-global. A project-level step **shadows** an org-global one of the
same name, so a project can locally override a shared definition without forking
the whole library.

Reference from a test step: `{ type: 'SHARED', input: { sharedStepId, params } }`,
expanded at execution time by the worker and at display time by the UI.

**Design decision — expand at execution, store the reference.** Storing expanded
copies would break the propagation guarantee that makes the feature worth having.

### Acceptance
- [ ] Editing a shared step propagates to every referencing test immediately
- [ ] Deleting warns with the list of affected tests
- [ ] Worker expands shared steps correctly, including nested ones
- [ ] Archived steps stay resolvable for existing references but cannot be newly added

---

## 5.2 — Parameterised / data-driven tests `[ ]` M

Also universal, also absent here — environment variables are our only injection
mechanism, so you cannot run one test over 50 rows of input.

### Copy Qase's two-model split
- **Single parameters** — independent variables; the system generates the full
  **Cartesian product**
- **Parameter groups** — each row is one *meaningful* combination (e.g. a "Secure
  network" row bundling VPN + HTTPS + SSO), which is what people actually want most
  of the time
- **Shared parameters** at workspace level, propagating cross-project

### Add Xray's dataset override
Override the dataset **at test-plan or test-run level**, so the same test runs
against different data per campaign. This is the feature that makes
parameterisation usable in real release cycles rather than a one-time authoring
convenience.

### ⚠️ Adopt Allure's display rule
**A parameterised test is ONE test case with collected parameters, not N cases.**
The run view shows each parameter set separately; the repository shows one case.

Most competitors get this wrong and pollute the repository. Getting it right is
cheap at design time and near-impossible to retrofit.

### Acceptance
- [ ] Single parameters produce a Cartesian product at run time
- [ ] Parameter groups produce one run per row
- [ ] Repository shows one test case; run shows N instances
- [ ] Dataset overridable at plan/run level
- [ ] Interpolation reuses the existing `{{VAR}}` grammar from `interpolate.ts`

---

## 5.3 — Versioning with real diff and restore `[ ]` M ⭐ positioning wedge

### Market context
TestRail and Xray charge **~2× (Enterprise)** for this. Qase appears **not to have
it** at all — only trash-bin restore and a changelog inside the review flow.
Testomat has the best implementation but gates it at **Enterprise**.

**Ship it in the base tier and say so loudly.** It is the most-complained-about
gate in the market.

### Current state
`TestDefinitionVersion` exists with max 5 snapshots, and `ModuleVersion`/
`FeatureVersion` similarly — but there is **no diff UI and no restore action**.

### Target (Testomat's model)
- Timestamped entry per change with **author**
- **Field-level diff**, side-by-side "Compare with Current"
- **One-click restore**
- Raise the snapshot cap well above 5, with age-based pruning instead

### ⚠️ Then add Xray's killer detail
**Persist the executed specification onto the run record.** Editing a test must
never rewrite the history of what was actually executed. That single decision is
what makes versioning *audit-credible* rather than merely convenient — and it is
what sign-off depends on.

```prisma
model TestRun {
  executedSpec  Json?   // frozen copy of steps as executed
}
```

### Acceptance
- [ ] Every edit creates a version with author and timestamp
- [ ] Side-by-side diff renders field-level changes
- [ ] Restore works and itself creates a new version (never destructive)
- [ ] `TestRun.executedSpec` frozen at execution; run detail renders from it

---

## 5.4 — Requirement traceability matrix `[ ]` M

### Current state
Traceability exists only as AI-generated `mappedAcceptanceCriteria` inside
`aiGenerationMetadata` — a JSON blob, not a queryable relation. There is no
Requirement model.

### Target — two reports minimum, both proven in the market
1. **Coverage by requirement** — which requirements have cases, and critically
   **which have none**. The gap view is what people actually use.
2. **Defects by requirement** — which requirements attract the most bugs.

Copy **Qase's versioned coverage snapshots** so coverage can be diffed across
releases, and **Xray's pattern of rendering coverage status back onto the
requirement itself**, not only in a separate report.

### ⚠️ Market gap worth taking
**ClickUp traceability is nearly unserved** — only Allure and PractiTest integrate
it. Qase supports Jira/GitLab/GitHub only. We already have a deep ClickUp plugin
with docs, tickets, epics and user linking.

**Make ClickUp a first-class traceability source, not an afterthought.**

### Acceptance
- [ ] Requirement is a queryable entity, sourced from ClickUp/Jira or authored locally
- [ ] Coverage report highlights uncovered requirements
- [ ] Coverage status renders on the requirement itself
- [ ] Snapshots versioned so coverage is diffable across releases

---

## 5.5 — Test plans `[ ]` M

> **Revised.** An earlier draft of this section proposed copying TestRail's
> three-level Plans / Suites / Cycles model. That was wrong for us — we already
> have two of the three concepts under different names, and adding a third
> vocabulary would have created overlap rather than capability. What follows is
> the corrected, smaller scope.

### The actual gap

The existing hierarchy is a **taxonomy** — it answers *"what is this test about?"*
It is not a **selection** — *"what am I running this time?"* Those are genuinely
different questions, and today only the first is expressible.

What we already have:

| Concept | What it is | Limit |
|---|---|---|
| Module → Feature tree | Taxonomy. Where a test lives. | One test lives in exactly one place |
| `TestRunSession` | A named manual sitting spanning features | **Ad-hoc — no reusable template.** You cannot re-run "the 3.2 regression" next month |
| `Pipeline` | Ordered multi-feature execution | **Automation-only**, stage-based, capped at 20 stages |
| `tags[]` | Ad-hoc cross-cutting labels | No saved selection, no run history as a unit |

So the missing piece is exactly one thing: **a reusable, named selection of tests
that spans features and works for manual, automated, or mixed.**

### Why it matters — the cases that are unexpressible today

1. **A smoke suite** — 20 tests drawn from 8 different features, run on every
   deploy. Today: run 8 features separately and mentally ignore the tests you
   didn't want.
2. **A release regression cycle** — "everything touching payments, plus the 30
   tests that failed last release." Today: no way to express it, and no object to
   attach a pass rate to.
3. **A UAT cycle for a client** — a specific set assigned for external sign-off.
   Today: sign-off is per feature × environment, so a client signing off "the
   release" has to sign off features one at a time.
4. **"Run everything tagged `@critical` against staging"** — tags exist, but there
   is no saved, re-runnable selection built from them.
5. **Historical comparison** — "is 3.2 regression better or worse than 3.1?"
   requires the cycle to be an entity with runs attached.

The through-line: **you cannot currently answer "how did the release go?"** — only
"how did each feature go?" That is the gap, and it is the one thing evaluators
from TestRail/Xray/Zephyr will immediately look for.

### Scope — one new concept, not three

```
TestPlan  (new)      reusable named selection + intended environment(s)
   │
   └─ executed as ─▶ TestRunSession  (exists)   ← the execution, manual/auto/mixed
                        │
                        └─ contains ─▶ TestRun (exists)
```

**Do not add "Suite" or "Cycle" as separate entities.** A suite is a plan whose
selection is static; a cycle is a session executed from a plan. Adding three
nouns where one suffices is how test-management tools become confusing — and
TestRail's Milestones/Plans/Runs split is a frequent source of "which one do I
create?" complaints.

```prisma
model TestPlan {
  id          String   @id @default(uuid())
  projectId   String
  name        String
  description String?
  /// Static picks. Union'd with anything selectorQuery resolves.
  testIds     String[] @default([])
  /// Saved dynamic selection (tag query / filter), resolved at execution time so
  /// a plan stays current as tests are added. Null = static selection only.
  selectorQuery Json?
  defaultEnvironmentIds String[] @default([])
  isArchived  Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  sessions    TestRunSession[]
  @@index([projectId, isArchived])
}
```

`TestRunSession` gains an optional `testPlanId`, which is what makes
"3.2 regression vs 3.1 regression" a query rather than a spreadsheet.

**Static + dynamic together matters.** A purely static plan goes stale the moment
someone adds a test; a purely dynamic one cannot pin an exact release scope.
Supporting both, union'd, is what makes it usable in a real release cycle.

### Relationship to Phase 6
This is the prerequisite for [6.2 run-from-tool](08-PHASE-6-MOAT.md) — the plan
*is* the execution manifest. Build the plan model here; dispatch it there.

### Acceptance
- [ ] A plan assembles tests across features and modules
- [ ] Selection can be static picks, a saved query, or both
- [ ] Many sessions from one plan; the plan itself holds no results
- [ ] Plans work for manual, automated and mixed execution
- [ ] Plan detail shows run-over-run history ("3.2: 94 % · 3.1: 89 %")
- [ ] **No new "Suite" or "Cycle" entity is introduced**

---

## 5.6 — Configurations (browser × OS matrix) `[ ]` M

TestRail *Configurations*, Xray *Test Environments*, Qase *Configurations* —
anyone doing cross-browser work asks in the first demo.

Define groups (browser, OS, device), select across them, get the cross-product
with **independent result sets per combination**. Make environment a first-class
reporting dimension that any report can be sliced by, per Xray.

### ⚠️ Prerequisite
**Only Chromium is installed** (`apps/worker/Dockerfile:23`). The code will
dispatch to firefox/webkit and fail at runtime. Install all three browsers before
shipping this, and note the image-size and memory implications on a 2 GB host.

### Acceptance
- [ ] Firefox and WebKit installed and verified
- [ ] Configuration groups definable per project
- [ ] Cross-product runs with independent results
- [ ] Any report sliceable by configuration

---

## 5.7 — JUnit XML / Cucumber JSON import `[ ]` S

We have a native Playwright path, which is better. But **JUnit XML is how every
non-Playwright suite in a prospect's estate gets in on day one**, and its absence
blocks evaluations outright.

Add JUnit XML first, Cucumber JSON second. Include **glob support for sharded
runs** (`"reports/**/*.xml"`) — the most-used flag in TestRail's `trcli`.

### Acceptance
- [ ] `POST /projects/:id/results/junit` ingests JUnit XML
- [ ] Glob patterns merge sharded reports into one run
- [ ] Unmatched tests auto-create cases (configurable)

---

## 5.8 — Free read-only / stakeholder seats `[ ]` S

Per-seat pricing that taxes read-only stakeholders is a **recurring, specific
complaint across every tool surveyed**. Testiny charges $3.70, Testpad gives
guests away free, PractiTest charges a seat and gets complaints for it.

**Make viewers free.** Then pair with **PractiTest's external dashboards** — a
public URL, iframe-embeddable into Confluence/ClickUp docs, **auto-refreshing
every 5 minutes** for wall monitors. That is a cheap, high-goodwill feature nobody
would expect from us.

### Acceptance
- [ ] `VIEWER` project role with read-only access, excluded from seat billing
- [ ] Shareable read-only dashboard URL with auto-refresh
- [ ] Embeddable via iframe with a scoped, revocable token

---

## 5.9 — Migration importers `[ ]` M

Testomat maintains **six** public migration scripts (TestRail, Xray, QMetry,
Testmo, Allure, TestCaseLab). This is pure switching-cost demolition and it is
cheap to build.

Publish them on GitHub where they are findable — **they double as marketing**.

Priority order by market share: **TestRail → Xray → Zephyr → Qase**.

### Acceptance
- [ ] TestRail importer maps suites/cases/steps/custom fields into our hierarchy
- [ ] Dry-run mode reports what would be created
- [ ] Published as a public repo with a README

---

## 5.10 — PR-style review workflow `[ ]` M

We have sign-off for *results*. This is review for *test definitions* — a
different thing, and Qase's is the best in the survey.

Copy the configuration surface exactly:
- *Review enabled*
- **Review is mandatory** (removes the Save button entirely)
- *Self-merge allowed*
- **N approvals required**

Reviewers can approve, request changes, **suggest edits inline**, merge or
decline, and see a **changelog inside the review** plus other reviewers' comments.

Testomat has no review workflow at all; Qase gates it at Business; TestRail gates
approvals at Enterprise. **Ship it in base.**

`TestDefinition.isAiDraft` already exists but nothing gates promotion — this is
the gate.

### Acceptance
- [ ] Mandatory mode genuinely prevents direct saves
- [ ] N-approval requirement enforced
- [ ] Changelog visible in the review
- [ ] AI-generated drafts route through review by default

---

## 5.11 — Recorder: assertion capture `[ ]` M

**The biggest single authoring gap.** The recorder captures actions only — every
assertion is hand-added afterwards in the step editor, which is where recorded
tests go to die.

### Target
An **assert mode** in the recorder: toggle it, click an element, choose what to
assert (text / visible / value / URL / count). The extension already computes
multi-strategy selectors, so the hard part is done.

Also fix the two adjacent gaps while in there:
- Recorded steps cannot be edited (selector or value) — only deleted
- No element picker in the step editor; you type selectors or record a whole flow

### Acceptance
- [ ] Assert mode captures the five common assertion types
- [ ] Captured assertions carry the same `fallbackSelectors` as actions
- [ ] Recorded step selectors and values are editable in the recorder

---

## Phase 5 exit criteria

- [ ] Shared steps, parameterisation, versioning, traceability and plans all ship
- [ ] Versioning and review are in the **base tier**, and marketed as such
- [ ] JUnit import works, unblocking non-Playwright evaluations
- [ ] Viewer seats are free
- [ ] At least the TestRail migration importer is public
- [ ] A competitive evaluation against Qase can be completed without a "we don't
      have that" answer on any table-stakes item
