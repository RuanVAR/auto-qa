# Test Recorder — Phase 2: AI Polish

> **Status:** Future / not committed
> **Prereqs:** `docs/TEST_RECORDER.md` MVP shipped and stable; ≥10 active users using recorder weekly
> **Tentative phase:** Phase 8 (AI Intelligence) sub-section
> **Decision check-in:** 90 days after MVP launch — verify users are recording but hitting friction this phase would relieve

This doc captures the **AI polish layer** on top of the MVP recorder. Each feature here is independently shippable — pick whichever pain point users complain about first.

---

## 2.1 AI-Suggested Assertions from DOM-Diff

**The problem in MVP:** users have to manually toggle Assert mode and click each thing they want to assert. They forget. Recorded tests have weak assertions.

**The fix:** mirror Cypress Studio's approach. Between each user interaction, snapshot the DOM. After each interaction, diff vs the previous snapshot. Surface the meaningful changes as **suggested assertions** the user can accept with one click.

### How it works

```
User clicks [Sign In] → CLICK step recorded
  ↓
Capture script snapshots DOM (lightweight — visible text + url + form values)
  ↓
500ms debounce — let the page settle
  ↓
Snapshot again
  ↓
Diff: { urlChanged?, newTexts[], removedTexts[], newElements[], removedElements[] }
  ↓
AI ranks the diff for assertion-worthiness:
  - URL change → suggest ASSERT_URL
  - "Welcome, John" appearing → suggest ASSERT_TEXT
  - Modal disappearing → suggest ASSERT_NOT_VISIBLE
  - Form input value retained → no assertion (rarely useful)
  ↓
Top 3 suggestions shown as inline ghost-step chips below the click step:
  ┌──────────────────────────────────────────────┐
  │ Step 4   CLICK Sign In                       │
  │   💡 [+ Assert URL is /dashboard]            │
  │   💡 [+ Assert text "Welcome" visible]       │
  │   💡 [+ Assert "Sign In form" not visible]   │
  └──────────────────────────────────────────────┘
  ↓
User clicks suggestion → assertion step inserted; chip dismisses
```

### Tech

- DOM snapshot: serialize `document.body.innerText` (capped 50KB) + `location.href` + visible form values
- Diff: lightweight string-diff library (e.g. `fast-diff`) for text changes; element diff via Mutation Observer record
- AI ranking: new task `ASSERTION_SUGGESTION` in `AI_LAYER.md`; prompt receives diff + user action context, returns ranked candidates
- Surface chips inline in step list (no modal interruption — flow stays unbroken)

### Acceptance bar

- ≥80% of accepted suggestions become non-flaky assertions on first 5 runs
- Suggestion latency <800ms after step recorded
- User can dismiss / collapse all suggestions with `Cmd+Shift+H`

> **Open question:** do we ever auto-apply high-confidence assertions, or always require click? Lean: always click — too easy to bake bad assertions in otherwise.

---

## 2.2 AI Step Name Cleanup

**The problem in MVP:** auto-generated step names are mechanical:
- "Click button.btn-primary"
- "Fill input#email-input"
- "Navigate to /users/47/edit"

**The fix:** post-record AI pass renames steps to human-readable:
- "Click Sign In button"
- "Fill email field with test user email"
- "Navigate to user 47's edit page"

### How it works

After user clicks `[Save]` (before persisting), recorder offers a `[✦ Clean up names]` option in the save modal. If accepted:

1. Send the full step list + page route context to LLM
2. Receive renamed steps preserving order, types, selectors, values
3. Show diff modal — user can accept all / reject / pick individually
4. Save with renamed steps

Reuses existing `AI_GENERATION_SPEC.md` pipeline — new task type `STEP_NAME_REFINEMENT`.

### Edge cases

- Sensitive values stay redacted in names ("Fill password" not "Fill 'mySecretPassword123'")
- Don't rename if user typed a name manually during recording
- Cap output length at 80 chars per name

> **Open question:** offer this on save OR run automatically as a background job after save (with notification "AI cleaned up your step names — review changes")? Lean: opt-in modal — keeps trust.

---

## 2.3 Agentic Post-Processing — "Refine This Recording"

**The problem in MVP:** raw recordings are verbose. Users record a "happy path checkout" and end up with 47 steps including 3 redundant scrolls and 2 throwaway hovers. The test is brittle and slow.

**The fix:** after save, run an Agent (per `docs/AGENTIC_AI_TESTING.md`) that:

1. **Removes redundant steps** — back-to-back scrolls collapse to one; redundant hovers dropped
2. **Adds smart waits** — between a CLICK and the next step, infer if a `WAIT` is needed (network in flight, DOM mutating)
3. **Splits long recordings** — recording with two distinct flows (login + create order) splits into two TestCases
4. **Adds boundary assertions** — at logical "milestones" (after navigation, after form submit), insert verification
5. **Names the test better** — based on the actual flow content
6. **Suggests parameterization** — values used multiple times → suggest extracting as a step variable

### UX

After save, banner on TestEditorPage:

```
✨ Refine this recording with AI?
   The agent will remove redundant steps, add smart waits, and suggest assertions.
   You'll see the proposed changes before they're applied.
   [Yes, refine] [Not now]
```

Click → opens diff view (left: original, right: refined) with per-change checkbox; user accepts changes individually or all.

### Tech

- New `RecordingRefinementAgent` extends `Explorer`/`Planner`/`Healer` agent base from `AGENTIC_AI_TESTING.md`
- LangGraph workflow: analyze → propose changes → present → apply
- Reuses the planner agent's experience evaluating step quality

> **Open question:** is "refine" a one-off action OR can users re-refine multiple times? Lean: one-off post-save; re-running re-applies original heuristics with no new info.

---

## 2.4 Shadow DOM Piercing

**The problem in MVP:** `event.target` in shadow DOM components is the shadow root, not the inner element. Recorder captures `<my-button>` instead of `<button>` inside it. Selectors are useless on replay.

**The fix:** use `event.composedPath()[0]` everywhere instead of `event.target`. Generate selectors using shadow-aware traversal:

```javascript
function generateShadowAwareSelector(el) {
  const path = [];
  let current = el;
  while (current) {
    if (current.shadowRoot || current.getRootNode() instanceof ShadowRoot) {
      // Cross shadow boundary — record host + inner selector
      path.unshift({ host: getHost(current), inner: getSelector(current) });
    } else {
      path.unshift(getSelector(current));
    }
    current = current.parentNode;
  }
  return formatPath(path); // Playwright supports `>>> ` shadow piercing in selectors
}
```

Output: Playwright shadow-piercing selector, e.g. `my-button >>> button.primary`.

### Acceptance bar

- Recorded test against a Web Component-heavy app (e.g. a Lit / Stencil app) plays back without selector failures
- Playwright `>>> ` selectors execute correctly in our existing executor (verify Playwright support)

> **Open question:** do we surface shadow DOM detection in the UI ("ℹ️ this app uses Web Components — using shadow-aware selectors") or just do it silently? Lean: silent unless it fails.

---

## 2.5 Inline AI Help During Recording

**The problem in MVP:** user records halfway through a flow and gets stuck — "what's the right way to wait for this dropdown?" They have to stop recording and ask for help.

**The fix:** during recording, a `[? Ask AI]` button in the recorder top bar. Click → modal:

```
What's confusing? Describe what you're trying to do.
[ ............................................. ]
                                       [Ask AI]
```

Sends the question + current step list + page DOM snapshot to LLM. Response:
- "It looks like the dropdown is animating — add a `WAIT 300ms` step here"
- Or: "You can record a hover step on the parent menu first"

If response includes a suggested step, offer `[+ Insert this step]` button.

### Tech

- New AI task `RECORDER_ASSIST` — context-aware Q&A grounded in current recording state
- Reuses `AI_LAYER.md` LangChain wrapper

> **Open question:** is this a separate panel vs modal? Modal is less invasive but interrupts flow. Lean: side panel slide-out from right edge.

---

## 2.6 Recording from a Saved Test ("Record from Step N")

**Currently in Phase 3 of original plan but small enough to land here.**

User loads an existing TestCase in StepEditor → wants to add steps after step 5. Today they have to use record-append mode but that just appends at the end. This adds:

- "Insert recorded steps after step 5" action
- Recorder opens with steps 1-5 marked read-only at the top of the live list
- New steps recorded by the user are inserted after step 5 (not appended)
- On save, modified TestCase shows diff for review

### Tech

- Add `?insertAfter=N` query param to `/.../record` route
- Recorder store treats first N steps as locked
- Save mode = `INSERT` (vs `CREATE` / `APPEND`)

---

## 2.7 Network-Level Capture (XHR/Fetch as Steps)

**The problem in MVP:** recorder only captures DOM-level interactions. If the user's flow involves API calls (e.g. login fires `POST /auth/login` then redirects), the recorded test only knows about the click + the navigation — not the API call shape.

**The fix:** parallel network capture:

- `PerformanceObserver` for `resource` entries → all XHR/Fetch URLs and timings
- Inject a `fetch` / `XMLHttpRequest` proxy → capture request/response bodies
- Surface in a separate "Network" tab in the recorder left pane:
  ```
  [Steps (12)]  [Network (47)]
  ```
- User can promote a network call to an `API_REQUEST` step (existing step type) — useful for bypassing UI in pre-conditions

### Use cases

- "Skip the login UI in this test — just call the API to set up auth"
- "Verify the API returned the right shape before asserting on UI"
- "Capture the auth token from the login response and use it in subsequent steps"

### Tech

- Capture script extension — shipped via same `test-recorder.js` bundle
- New step type already exists (`REQUEST` per STEP_DEFINITION_SPEC)
- UI: tabbed left pane

> **Open question:** privacy implications of capturing request bodies — could leak PII. Mitigation: redact body by default, user opts in per-call to capture body.

---

## 2.8 Roll-up

**Phase 2 estimated effort:** ~6-8 weeks (1 dev) for all of §2.1 through §2.7. Each section is independently shippable; pick whichever users want most.

**Recommended order:**
1. §2.2 step name cleanup (low-effort, high-delight)
2. §2.4 Shadow DOM (unblocks WC-heavy users — small group but very vocal)
3. §2.1 assertion suggestions (biggest quality lift)
4. §2.6 record-from-step-N (frequent request likely)
5. §2.3 agentic refinement (complex; ships well after we have refine telemetry)
6. §2.7 network capture (powerful but niche)
7. §2.5 inline AI help (overlaps with broader platform AI assistant — defer)
