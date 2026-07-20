# Web UI — Phase C

## Focus — what and where

| File | Change |
|---|---|
| `apps/web/src/pages/tests/TestEditorPage.tsx` (~line 1001-1088) | Replace the raw-JSON-only editor branch for API tests with a structured form |
| new component (picker) | Integration + Endpoint picker, pre-fills method/url/headers/body from the chosen Endpoint |
| `packages/shared` (new pure function) | Static variable-flow analysis — consumed (`{{VAR}}` scan) and produced (`EXTRACT`/`STORE` scan) per test |
| new pages under `apps/web/src/pages/` | Integrations list/detail page (create/edit, health-check button) |

## Why critical

This is the single biggest usability gap surfaced by investigation: API tests are currently
authored as hand-typed raw JSON with zero structure, while UI tests already get a full visual
editor. Without this phase, Phases A and B deliver a working **engine** that's still painful to
actually use day to day — the data model and import pipeline exist, but a test author still has to
know the exact JSON shape of a REQUEST step by heart. This phase is what makes the feature
actually adoptable, not just technically complete.

## Method

**Structured REQUEST-step form.** Method dropdown, an Integration + Endpoint picker (selecting an
Endpoint pre-fills method/url/headers/body from its stored defaults), and editable headers/query/
body fields. Critically, **every pre-filled field stays editable** — the same override precedence
already established in the engine (step-level input always wins over endpoint defaults, which
always win over integration defaults) applies identically in the UI, so what the form shows is
never a lie about what will actually execute.

**Auth is shown, not re-entered.** When an Integration is selected, the form shows an "auth:
inherited from &lt;Integration name&gt;" indicator rather than exposing a raw `Authorization`
header field — the whole point of the Integration abstraction is that a test author shouldn't need
to know or handle the actual secret.

**Variable-flow visibility.** The consumed/produced analysis is written as a **pure function** in
`packages/shared` — no side effects, just `Step[] → { consumes: string[], produces: string[] }` —
so the exact same implementation can run server-side (feeding a future "this test references an
undefined variable" validation) and client-side (feeding the live data-flow panel in the editor),
with zero duplication between the two. The panel surfaces the Test A → Test B relationship
directly: "Test A produces `ITEM_ID`" / "Test B consumes `ITEM_ID`" as a simple ordered list at the
feature level, not just within a single test's steps.

**Integrations management page.** List + create/edit modal (name, base URL, auth-type picker with
type-specific fields, default-headers table, health-check path, an Import button that opens the
Phase B flow), and a health-check button showing the classified ping result (healthy / auth-failed
/ unexpected-status / unreachable, with latency).

## Verification

- Author a full REQUEST step through the new UI with **no raw JSON involved at any point** →
  confirm the resulting `steps[]` is structurally identical to a hand-written equivalent (the UI
  must not introduce any shape drift from what the engine actually consumes).
- Select an Endpoint → confirm the form pre-fills correctly, and confirm overriding a pre-filled
  field (e.g. changing the body) actually takes effect at run time, not just visually.
- Confirm the data-flow panel correctly displays the Test A/B produce/consume relationship from
  the Phase A core scenario (the `ITEM_ID` example) — this is the direct UI proof that the
  engine-level feature (Phase A) is actually visible and legible to a real test author, not just
  working under the hood.
- Health-check button: confirm it surfaces the four distinct classifications (healthy /
  auth-failed / unexpected-status / unreachable) against a real test target for each case, not
  just a generic pass/fail.
