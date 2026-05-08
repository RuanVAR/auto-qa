# Data model

The QA platform organises work in this hierarchy:

```
Organisation
└── Project          (a product / app under test)
    ├── Modules      (a feature area: "Authentication", "Reporting", "Search")
    │   └── Features (a deliverable: "Login flow", "Password reset")
    │       └── Tests (a single test case: UI / API / SHELL)
    │           └── Steps  (the actual instructions — see 02-step-types.md)
    ├── Phases       (workflow gates: Dev → QA → UAT → Sign-off)
    └── Environments (Local / Staging / Production / …)
```

When you (the AI) are asked to author **new** content for re-import, work
top-down — pick the right module, then the feature, then the tests under it.

## Identity

- Names are how items are matched on re-import (case-sensitive). Renaming
  an existing item creates a new row; don't rename to "fix typos" unless the
  user explicitly asks.
- IDs (`id`, `featureId`, `moduleId`, etc.) are platform-assigned. **Never set
  them in your output.** The importer will reject any payload with `id`.

## Soft-delete model

Anything you see with `deletedAt: null` (or absent) is live. Don't generate
content with `deletedAt`.

## Ownership / RBAC

Out of scope for AI authoring. Don't generate `createdById`, `assignees`,
project membership, etc.

## What you'll see in `data.json`

The exported envelope mirrors the live structure but stripped of audit
fields. Use it as your source of truth for **what already exists**. New
items you propose go alongside, not in place of, what's there.
