# Shared Steps E2E Verification

Run this after applying `20260722090000_shared_steps_and_executed_specs` and starting API, worker, web, Postgres, and Redis. Use a disposable organisation and a project with one reachable automated environment.

## Preconditions

- Sign in as an `ORG_ADMIN` who is also an `OWNER` or `TECH_LEAD` on the target project.
- Add environment variables `ADMIN_EMAIL` and `ADMIN_PASSWORD`; mark the password secret in the environment configuration.
- Ensure the worker can reach the environment base URL.
- Create one UI test with a login page and one feature containing that test.

## Core Authoring

1. Open `Projects -> Tests -> Shared Steps`.
2. Create `Admin login` with `FILL email`, `FILL password`, `CLICK sign in`, and `ASSERT_VISIBLE dashboard` steps.
3. Declare `email` and `password` parameters. Mark `password` secret.
4. Confirm it is labelled `PROJECT`, shows version `1`, and has zero references.
5. Open a UI test in the visual editor, choose `Use shared step...`, and select `Admin login`.
6. Bind `email` to `{{ADMIN_EMAIL}}` and `password` to `{{ADMIN_PASSWORD}}`.
7. Save, reload the test, and confirm the test still stores one `SHARED` row rather than copied login rows.

Pass criteria: the library, picker, bindings, and test persistence all survive a refresh.

## Automated Execution And Snapshot

1. Trigger the saved test in automated mode.
2. Confirm the worker creates concrete `FILL`, `CLICK`, and assertion RunSteps; it must not create a `SHARED` RunStep.
3. Inspect the TestRun row/API response. `executedSpec.steps` must contain flattened concrete steps and `sharedStepDependencies` must include `Admin login` at version `1`.
4. Change the shared assertion to a different, valid dashboard selector and save the shared step.
5. Trigger a new run. Confirm its `executedSpec` contains the changed selector and shared dependency version `2`.
6. Compare the first completed run. Its snapshot must still contain the original selector and version `1`.

Pass criteria: new runs use live shared definitions; created runs never change retrospectively.

## Manual Feature Execution

1. Start the containing feature in Manual mode.
2. Open the test in Testing View.
3. Confirm the sidebar lists the resolved concrete login steps immediately.
4. Mark one resolved step passed and verify normal manual status updates work.

Pass criteria: no `SHARED` placeholder is presented to a manual tester and no step is missing.

## Nested Steps And Scope

1. Create project shared step `Open login page`.
2. Create project shared step `Admin login via form` that references `Open login page` then contains form steps.
3. Reference the nested definition in a test and run it.
4. Promote both definitions together to org-global.
5. Open a second project in the same organisation and confirm both appear with `ORG GLOBAL` scope.
6. Use the global definition in a test in the second project and run it.

Pass criteria: nested expansion preserves order; global definitions work cross-project only within their organisation.

## Recorder

1. Open the recorder against the test environment and type a real password into a password input.
2. Inspect captured steps before save. The password value must be `{{PASSWORD}}`, never the real literal.
3. Use `Save shared`, give the captured flow a name, then open it in Shared Steps.
4. Insert that shared definition into a test and replace `{{PASSWORD}}` with a configured environment token before running.

Pass criteria: plaintext passwords never appear in recorder payloads, browser state, API request bodies, test definitions, shared definitions, or run evidence.

## Negative And Security Cases

1. POST a test with `{ input: { wasPassword: true, value: "plain-secret" } }`; expect HTTP `400`.
2. Bind a shared secret parameter to `plain-secret`; expect run creation to fail with `400` before queueing.
3. Bind an unknown parameter key; expect `400` and no TestRun row.
4. Omit a required parameter; expect `400` and no TestRun row.
5. Reference a shared-step ID from another organisation; expect `400` and no information disclosure.
6. Reference a project-local shared step from another project; expect `400`.
7. Create a nested loop `A -> B -> A`; expect a readable cycle error and no queued run.
8. Nest more than five levels; expect a depth-limit error and no queued run.
9. Try to promote a global shared step that still depends on a non-promoted local nested step; expect `400`.
10. Try promotion as `QA_ENGINEER`, `DEVELOPER`, `CLIENT`, and cross-org `ORG_ADMIN`; expect `403`.
11. Archive a referenced shared step. Confirm it cannot be selected for a new test but existing tests still create and execute snapshots.
12. Start a run, edit/archive its referenced shared step before worker pickup, then let it run. Confirm it executes the original `executedSpec`.
13. Submit an empty shared step, over-2000-step payload, duplicate parameter keys, and non-identifier parameter key; expect `400`.
14. Run a `SCRIPT` test with a `SHARED` reference; expect pre-run validation failure.

## Regression Suite

1. `pnpm db:generate`
2. `pnpm --filter api build`
3. `pnpm --filter worker build`
4. `pnpm --filter web build`
5. `pnpm test:api`
6. `pnpm test:worker`
7. `pnpm test:web`
8. Run the existing Playwright smoke suite after services are started.

Record the organisation, project, environment, feature, test, shared-step IDs, run IDs, and screenshots for each failed assertion.
