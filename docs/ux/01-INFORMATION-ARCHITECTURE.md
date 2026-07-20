# 01 — Information architecture

Navigation, hierarchy, and the missing global search.

---

## 1. The depth problem

The data model is five levels deep before you reach the thing people actually work
on:

```
Organisation → Project → Module → Feature → Test → Step
                                      └─ Run → RunStep → Artifact
```

That is correct as a *model*. It is punishing as *navigation*, because the unit of
work — a test, a run, an issue — sits at the bottom, and everything above it is
scaffolding a user has to traverse.

Two consequences to design around:

1. **People do not navigate down the tree.** They arrive from a link, a
   notification, or a search for a name they half-remember. The tree is how things
   are *stored*, not how they are *found*.
2. **Position must be visible at all times.** At level four you cannot tell where
   you are from the page content alone.

### Breadcrumbs `[ ]` S

There are none. Add a persistent breadcrumb on every nested route, with each
segment clickable **and** switchable:

```
Acme  ›  Checkout  ›  Payments  ›  Card capture  ›  Declined card
 ▲        ▲            ▲            ▲
 org      project      module       feature   ← each opens a picker, not just a link
```

The switcher matters more than the link. The common action at level four is not
"go up" — it is "same view, different feature".

---

## 2. Global search `[ ]` M ⭐ the biggest navigation gap

### Current state: none

There is no global search anywhere in the application. Every list has its own
local filter, and they do not share a pattern. To find a test whose name you
half-remember you must already know which project and module it lives in — which
is precisely the knowledge you lack when searching.

For a product where the entity count grows without bound (tests, runs, issues,
docs), this is the defect that gets worse every day the platform is used.

### What it must search

Ranked by how often people look for each:

| Entity | Match on | Result shows |
|---|---|---|
| **Test** | name, tags, step text, description | module › feature path, last status |
| **Feature** | name, tags, description | module path, pass rate |
| **Issue / bug** | title, description, repro steps | severity, status, assignee |
| **Run** | id, test name, failure message | status, when, environment |
| **Module** | name, tags | project path |
| **Project** | name, slug | org |
| **Doc** | title, markdown body | scope it is attached to |
| **Requirement** *(after 5.4)* | title, external key | coverage state |

### Behaviour

- **⌘K / Ctrl+K** from anywhere. Also a visible search affordance in the top bar,
  because a shortcut nobody discovers is not a feature.
- **Scoped by default to the active project**, with a one-key toggle to search the
  whole org. Most searches are local; the escape hatch must exist but not be the
  default.
- **Results grouped by type**, keyboard-navigable, `Enter` opens, `⌘Enter` opens in
  a new tab.
- **Recent items when the query is empty** — the highest-value state of the whole
  feature, because "the thing I was just looking at" is the most common target.
- **Debounced at ~150 ms**, cancel in-flight requests on new keystrokes.

### Query syntax — align it with the future query language

Do not invent a second syntax. [Phase 6.8](../plan/08-PHASE-6-MOAT.md) plans a
query language uniform across UI, API, dashboards and MCP. Global search should be
its friendliest surface:

```
checkout                      free text
status:failed checkout        filtered
tag:@critical env:staging     structured
is:flaky                      saved concept
```

Plain text must always work. Structured syntax is progressive enhancement for
people who learn it — never a requirement.

### Implementation notes

- **Postgres full-text search first**, not a new service. `tsvector` columns on
  the searchable entities with a GIN index; add `pg_trgm` for fuzzy name matching.
  `pgvector` is already in the stack if semantic search is wanted later — but do
  not start there. People search for names they nearly remember, which is a
  trigram problem, not an embedding problem.
- **One endpoint**, `GET /api/v1/search?q=&scope=`, returning grouped results with
  a hard cap per group.
- **RBAC is applied at query time**, not filtered afterwards. Search must never be
  a way to discover the existence of something you cannot open — the same 404-not-403
  rule as everywhere else.
- Log queries that return nothing. A list of failed searches is the cheapest
  possible source of truth about vocabulary mismatch between us and our users.

---

## 3. Top-level navigation

Current destinations: **Dashboard · Projects · AI · Org · Settings**.

Two problems:

1. **`AI` is a top-level destination pointing at a dead end.** The page dumps JSON
   and instructs the user to copy-paste it into the test editor. It occupies one of
   five slots in the most valuable navigation real estate in the product.
   → **Remove it.** AI belongs *inside* the flows it assists — generation lives on
   the feature and test pages, where it already works well.
2. **There is no destination for the thing people do most.** A tester's job is
   "run tests and record results"; a lead's is "look at what failed". Neither has
   a home. Both are reached by navigating into a project first.

### Proposed

```
Dashboard   what needs my attention
Testing     active sessions, assigned work, start a run     ← new
Projects    the tree
Insights    runs, failures, flaky, analytics                ← consolidates
Org         team, plugins, settings
```

`Testing` and `Insights` are the two jobs the current structure makes people dig
for. `AI` disappears as a destination and becomes a capability.

---

## 4. Within-project navigation

Currently a quick-links row of text links (`Environments · Test Definitions ·
Access & Members · Sign-off · Transfer`). It works, but:

- The links are visually identical regardless of importance
- They sit *below* the stats block, so the primary navigation for a project is
  below the fold on smaller screens
- There is no indication of which are populated — a project with no environments
  looks the same as one with twelve

Give each a count and a state, and move them above the stats.

---

## 5. Deep-linking and shareability

Every meaningful view should be addressable, because the dominant sharing
mechanism in QA is pasting a link into chat.

Currently **not** addressable:
- Filter state on `RunsPage` and `OrgAnalyticsPage` (both have rich filters, none
  in the URL — so "look at this" cannot be shared)
- Selected step within a run
- Active tab on multi-tab pages

Fix by putting filter and selection state in the query string. This is small work
with an outsized effect on how teams actually use the tool.

---

## 6. Notifications → work

33 `NotificationType` values exist and the bell shows unread counts. What is
missing is the loop back to work: a notification should land the user **on the
thing**, in the state where they can act on it — a failed run opens at the failed
step, a sign-off request opens the sign-off modal.

---

## Acceptance for this document

- [ ] Breadcrumbs on every nested route, with switchers
- [ ] ⌘K global search across the eight entity types, project-scoped by default
- [ ] Recent items shown on empty query
- [ ] Search RBAC applied in-query
- [ ] `/ai` removed from top-level navigation
- [ ] Filter and selection state reflected in the URL on the analytics and runs pages
- [ ] Notifications deep-link into an actionable state
