# Test Suite Export & Import

## Overview

Test suites can be exported and imported at every level of the hierarchy. This allows teams to:
- Share test suites between projects or platform instances
- Version-control test suites alongside source code
- Back up and restore test definitions
- Bootstrap new projects from existing ones

---

## Export Levels

| Level | Button location | What is included |
|-------|----------------|-----------------|
| **Project** | Project page header → Actions → Export Project | All modules, all features, all test cases |
| **Module** | Module page header → Actions → Export Module | The module, all its features, all test cases |
| **Feature** | Feature page header → Actions → Export Feature | The feature and all its test cases |
| **Test Case** | Test editor toolbar → Export Test | Single test case definition |

All exports download as a `.json` file directly in the browser.

**Filename format:** `{slug}-{level}-export-{YYYY-MM-DD}.json`

Examples:
- `my-app-project-export-2026-04-14.json`
- `authentication-module-export-2026-04-14.json`
- `login-flow-feature-export-2026-04-14.json`
- `login-success-test-export-2026-04-14.json`

---

## Export Format

All exports share the same envelope with a `type` field that determines the structure.

### Project export

```json
{
  "version": "1.0",
  "exportType": "project",
  "exportedAt": "2026-04-14T10:30:00.000Z",
  "platformVersion": "0.1.0",
  "project": {
    "name": "My App",
    "slug": "my-app",
    "description": "Main application test suite",
    "modules": [
      {
        "name": "Authentication",
        "description": "Login, registration, password flows",
        "features": [
          {
            "name": "Login Flow",
            "description": "All login-related test cases",
            "testCases": [
              {
                "name": "Login with valid credentials",
                "description": "Happy path login test",
                "tags": ["smoke", "auth"],
                "steps": [
                  { "index": 0, "name": "Navigate to login", "type": "NAVIGATE", "input": { "url": "/auth/login" } },
                  { "index": 1, "name": "Fill email", "type": "FILL", "input": { "selector": "#email", "value": "qa@test.com" } },
                  { "index": 2, "name": "Fill password", "type": "FILL", "input": { "selector": "#password", "value": "password123" } },
                  { "index": 3, "name": "Click submit", "type": "CLICK", "input": { "selector": ".btn-login" } },
                  { "index": 4, "name": "Assert redirected", "type": "ASSERT_URL", "input": { "url": "/dashboard" } }
                ],
                "config": {
                  "browser": "chromium",
                  "headless": true,
                  "timeout": 30000,
                  "retries": 1
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### Module export

```json
{
  "version": "1.0",
  "exportType": "module",
  "exportedAt": "2026-04-14T10:30:00.000Z",
  "platformVersion": "0.1.0",
  "module": {
    "name": "Authentication",
    "description": "Login, registration, password flows",
    "features": [ ... ]
  }
}
```

### Feature export

```json
{
  "version": "1.0",
  "exportType": "feature",
  "exportedAt": "2026-04-14T10:30:00.000Z",
  "platformVersion": "0.1.0",
  "feature": {
    "name": "Login Flow",
    "description": "All login-related test cases",
    "testCases": [ ... ]
  }
}
```

### Test case export

```json
{
  "version": "1.0",
  "exportType": "testCase",
  "exportedAt": "2026-04-14T10:30:00.000Z",
  "platformVersion": "0.1.0",
  "testCase": {
    "name": "Login with valid credentials",
    "description": "Happy path login test",
    "tags": ["smoke", "auth"],
    "steps": [ ... ],
    "config": { ... }
  }
}
```

---

## Import

### Where to import

Import is available from the **Project page** via the "Import" button. The import file can contain any export type — the platform detects it automatically from the `exportType` field.

### Import modal flow

```
1. Click "Import" on the project page
2. Select or drag-and-drop a .json file
3. Platform reads the file and shows a preview:
   ┌──────────────────────────────────────────┐
   │  Import Preview                          │
   │                                          │
   │  Type:     Module export                 │
   │  Source:   Authentication                │
   │  Contains: 3 features, 12 test cases     │
   │  Exported: 14 April 2026                 │
   │                                          │
   │  Import into project: My App      ✓      │
   │                                          │
   │  [ Cancel ]              [ Import ]      │
   └──────────────────────────────────────────┘

   For feature imports:
   │  Target module: [ Authentication  ▼ ]   │

   For test case imports:
   │  Target module:  [ Authentication ▼ ]   │
   │  Target feature: [ Login Flow     ▼ ]   │

4. Click Import
5. Success summary shown:
   "Imported successfully: 1 module, 3 features, 12 test cases"
```

### Import rules

| Rule | Behaviour |
|------|-----------|
| Duplicate name | Appends `(imported)` to the name — never silently overwrites |
| Transaction | Entire import runs in a single DB transaction — if any step fails, nothing is created |
| Schema version | If `version` field is incompatible, import is rejected with a clear error before anything is created |
| IDs | All IDs from the export file are ignored — new UUIDs are generated for every record |
| Environments | Not included in exports — test steps referencing environment URLs remain as-is |
| Run history | Not included — only test definitions are exported/imported |

### Import response

```json
{
  "success": true,
  "summary": {
    "modulesCreated": 1,
    "featuresCreated": 3,
    "testCasesCreated": 12,
    "skipped": []
  }
}
```

On failure:
```json
{
  "success": false,
  "error": "Incompatible export version: 2.0. This platform supports version 1.x only."
}
```

---

## API Endpoints

```
# Export
GET  /api/v1/projects/:id/export          Download project export JSON
GET  /api/v1/modules/:id/export           Download module export JSON
GET  /api/v1/features/:id/export          Download feature export JSON
GET  /api/v1/tests/:id/export             Download test case export JSON

# Import (accepts any export type)
POST /api/v1/projects/:id/import          Multipart or JSON body with export file
```

All export endpoints respond with:
```
Content-Type: application/json
Content-Disposition: attachment; filename="my-app-project-export-2026-04-14.json"
```

---

## Use Cases

**Sharing between team members**
Export a feature, send the JSON file, colleague imports it into their project.

**Promoting from staging to production project**
Export the staging project's test suite, import into the production project.

**Version-controlling tests**
Export the full project on each release, commit the JSON to your repo alongside the code.

**Bootstrapping a new project**
Export a standard set of smoke tests from a template project, import into every new project.

**Backing up before a refactor**
Export project before making bulk changes to test definitions.
