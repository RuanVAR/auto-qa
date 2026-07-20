# 05 — Public landing / feature page

**Plan only. Do not build yet.**

A modern, clean, formal marketing page that doubles as the unauthenticated entry
point to the application, fully brandable from configuration.

---

## 1. Why this exists

Today, hitting the root URL unauthenticated lands on `/login` — a form. There is
nowhere that explains what the product is, and nothing that can be sent to a
prospect, a client, or a colleague.

Three jobs, in priority order:

1. **Explain the product in ten seconds** to someone who has never seen it
2. **Get an existing user to `/login` without friction** — they are the majority
   of traffic and must not be slowed down by marketing
3. **Be re-brandable from config**, so it can be white-labelled for a client
   deployment without touching code

---

## 2. Branding configuration

Some of this already exists — build on it, do not reinvent.

### What exists today

| Thing | Where | Notes |
|---|---|---|
| `PLATFORM_NAME` | `apps/web/src/hooks/useOrgBranding.ts:12` | reads `VITE_APP_NAME`, falls back to `'AdVantage'` |
| Platform branding service | `apps/api/src/modules/platform/platform-branding.service.ts` | app name + logo, set by a platform admin |
| Org branding | Org settings | name, `logoUrl`, `primaryColor` — used in-app, on PDFs, in emails |
| Email branding | `apps/api/src/email/branding.ts` | resolves org → platform → env defaults |

So there is already a **three-tier resolution chain**: org override → platform
setting → environment default. The landing page should use the same chain, minus
the org tier (a public page has no org context).

### What to add

A single typed config module, so nothing about the brand is hardcoded in a
component:

```ts
// apps/web/src/config/brand.ts
/**
 * Every brand-variable string and asset in one place, resolved from env at build
 * time. Nothing here may be hardcoded in a component — a white-label deployment
 * changes only this file's inputs, never JSX.
 */
export const brand = {
  name:        import.meta.env.VITE_APP_NAME        ?? 'AdVantage',
  tagline:     import.meta.env.VITE_APP_TAGLINE     ?? 'Manual and automated QA in one place',
  logoUrl:     import.meta.env.VITE_APP_LOGO_URL    ?? '/logo.svg',
  logoMarkUrl: import.meta.env.VITE_APP_LOGO_MARK   ?? '/mark.svg',   // square, for favicon/avatar
  primary:     import.meta.env.VITE_BRAND_PRIMARY   ?? '#7c3aed',
  supportEmail:import.meta.env.VITE_SUPPORT_EMAIL   ?? 'support@example.com',
  docsUrl:     import.meta.env.VITE_DOCS_URL        ?? null,
  // Feature switches for the public page
  showPricing:  import.meta.env.VITE_SHOW_PRICING  === 'true',
  allowSignup:  import.meta.env.VITE_ALLOW_SIGNUP  !== 'false',
} as const;
```

Rules:
- **No brand string appears in a component.** Every one comes from `brand`.
- `allowSignup: false` hides every signup affordance — required for private/client
  deployments where accounts are provisioned by an admin.
- The page must render correctly with **only** `name` set and everything else at
  defaults. A deployment that has not configured branding should look plain, not
  broken.

---

## 3. Page structure

Single scrolling page. Formal and quiet — the audience is QA leads and engineering
managers, not consumers. **No animated gradients, no floating 3D mockups, no
autoplay video.**

```
┌────────────────────────────────────────────────────────┐
│ [logo] Name          Features  How it works  Docs      │
│                                    [Sign in] [Get started] │  ← top right
├────────────────────────────────────────────────────────┤
│                                                        │
│   HERO                                                 │
│   Manual and automated testing in one place.           │
│   One-sentence sub-headline naming the actual problem. │
│   [Get started]  [Sign in]                             │
│                                                        │
│   [ product screenshot — real UI, not an illustration ]│
│                                                        │
├────────────────────────────────────────────────────────┤
│   PROBLEM        three columns, the honest version      │
├────────────────────────────────────────────────────────┤
│   FEATURES       4–6 blocks, each: what it does,        │
│                  why it matters, one real screenshot    │
├────────────────────────────────────────────────────────┤
│   HOW IT WORKS   three numbered steps                   │
├────────────────────────────────────────────────────────┤
│   PROOF          reserved — leave empty until real      │
├────────────────────────────────────────────────────────┤
│   PRICING        optional, config-gated                 │
├────────────────────────────────────────────────────────┤
│   FINAL CTA                                            │
├────────────────────────────────────────────────────────┤
│   FOOTER   product · docs · legal · support             │
└────────────────────────────────────────────────────────┘
```

### Top-right auth — the detail that matters

Two buttons, always visible, sticky on scroll:

- **Sign in** — secondary/ghost. Existing users are the majority of traffic; this
  must be findable instantly and never hidden behind a menu.
- **Get started** — primary. Hidden entirely when `brand.allowSignup === false`.

If a valid session exists, replace both with **"Open [Name]"** linking to
`/dashboard`. Returning users should never be shown a marketing page they have to
click past.

---

## 4. Content

### Hero

Say what it is, not what it will do for you. QA people distrust outcome claims.

> **Manual and automated testing in one place.**
> Run exploratory sessions, automate what repeats, and see both in the same
> report — with the evidence attached.

Avoid: "revolutionise", "AI-powered", "10× faster", "effortless". Every competitor
uses them, and the audience discounts them.

### Features — pick four to six

Lead with what is genuinely differentiated, not what is expected:

1. **Manual and automated in one report** — the actual differentiator. Same
   sessions, same evidence model, same sign-off.
2. **Evidence capture built in** — annotated screenshots, narrated recordings,
   structured failure reasons. This is our strongest existing feature and it is
   invisible today.
3. **Playwright underneath** — real code, exportable, no proprietary lock-in.
   Directly addresses the objection every technical evaluator raises.
4. **Selector drift detection** — with the honest framing from
   [Phase 2](../plan/04-PHASE-2-HEALING.md): proposals, review, and a published
   precision number. **Not** "self-healing".
5. **Sign-off with a certificate** — feature × environment approval, audit trail,
   branded PDF.
6. **Works with your tracker** — ClickUp/Jira two-way, tickets from failures.

Each block: a short heading, two sentences, one **real screenshot**. Never a
stock illustration and never a fabricated dashboard — a QA audience will spot an
invented screenshot immediately, and it costs more credibility than it buys.

### Rules for claims

Same rule as the product ([CONVENTIONS §9](../plan/09-CONVENTIONS.md)):
**never claim a capability the code does not have.** Anything in Phases 3–6 is
absent from this page until it ships. The "Proof" section stays empty until there
are real customers to name, with permission.

---

## 5. Technical shape

- **Route**: `/` when unauthenticated. Authenticated users redirect to `/dashboard`.
- **Location**: `apps/web/src/pages/public/LandingPage.tsx` plus
  `components/public/*`. Keep it entirely separate from the app shell — no
  sidebar, no top nav, no auth store dependency.
- **Bundle**: lazy-loaded, so the landing page never adds weight to the
  authenticated app. It should be the smallest route in the build.
- **Rendering**: static — no data fetching. It must render with the API down,
  because "is it up?" is exactly when people load it.
- **Theme**: light **and** dark, respecting `prefers-color-scheme`. Note the app
  itself is dark-first; the public page should not be locked to dark.
- **Responsive**: mobile-first. Realistically this is opened on a phone from a
  chat link more often than anywhere else.
- **SEO**: title, description, OG tags and a `mark` image, all from `brand`.
- **Accessibility**: semantic landmarks, one `h1`, visible focus, contrast ≥ 4.5:1
  including against `brand.primary` — which is configurable, so **contrast must be
  computed, not assumed**. If a configured brand colour fails contrast against the
  button text, fall back to a computed accessible shade rather than shipping an
  unreadable button.

---

## 6. Explicitly out of scope

- A CMS or editable content — content lives in the repo
- A blog, changelog, or docs site
- Cookie banners or third-party analytics *(if analytics is added later, it must
  be privacy-preserving and consent-free by construction — do not add a banner)*
- Live chat widgets
- Pricing tables, until pricing is decided ([DECISION-MATRIX §4](../plan/01-DECISION-MATRIX.md)
  records the intent: versioning in base tier, bundled AI, free viewer seats)

---

## 7. Acceptance

- [ ] Renders correctly with only `VITE_APP_NAME` set
- [ ] Every brand string and asset resolves through `config/brand.ts`
- [ ] `allowSignup=false` removes every signup path
- [ ] Authenticated visitors are redirected, never shown marketing
- [ ] Sign in / Get started visible above the fold and sticky
- [ ] Renders with the API unreachable
- [ ] Light and dark, mobile through desktop
- [ ] Contrast verified against a *configured* brand colour, not just the default
- [ ] No claim on the page that the shipped product cannot do
