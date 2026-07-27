# Publishing Environment Versions from CI/CD

The QA platform accepts the deployed release identity from any CI/CD system. The
deployment system remains authoritative; repository manifest inference is only a fallback.

## One-Time Platform Setup

1. Open **Project → Environments → CI setup**.
2. Select the target environment.
3. Create an environment-scoped deployment token.
4. Store the displayed `qadp_` token in the CI system's encrypted secret store.
5. Record the project ID and environment ID shown in the deployment endpoint.

The plaintext token is shown once. The platform stores only its SHA-256 hash.

## Generic Publisher

The repository includes `scripts/publish-environment-release.sh`. It requires `curl` and
`jq` and accepts the same variables in every CI system:

| Variable | Required | Purpose |
|---|---:|---|
| `QA_PLATFORM_URL` | yes | QA platform origin, for example `https://qa.example.com` |
| `QA_PROJECT_ID` | yes | QA project UUID |
| `QA_ENVIRONMENT_ID` | yes | Target QA environment UUID |
| `QA_DEPLOY_TOKEN` | yes | Environment-scoped `qadp_` secret |
| `QA_RELEASE_VERSION` | yes | Human-readable deployed version |
| `QA_DEPLOYMENT_STATUS` | no | `SUCCESS`, `FAILED`, `PENDING`, or `ROLLED_BACK` |
| `QA_COMMIT_SHA` | no | Exact deployed source revision |
| `QA_BRANCH` | no | Deployed branch/tag |
| `QA_ARTIFACT_DIGEST` | no | Immutable image/package digest |
| `QA_PIPELINE_URL` | no | Link to the deployment pipeline |
| `QA_COMPONENTS_JSON` | no | JSON array of component versions |
| `QA_IDEMPOTENCY_KEY` | no | Stable retry key; a safe default is generated |

Example component metadata:

```json
[
  {
    "name": "API",
    "version": "5.4.0",
    "commitSha": "abc123",
    "branch": "main",
    "artifactDigest": "sha256:..."
  },
  {
    "name": "Frontend",
    "version": "3.8.1",
    "commitSha": "def456",
    "branch": "main"
  }
]
```

## GitHub Actions

Use `docs/ci-examples/github-actions.yml` in the repository that performs the deployment.
Create:

- Repository secret: `QA_DEPLOY_TOKEN`
- Repository variables: `QA_PLATFORM_URL`, `QA_PROJECT_ID`, `QA_ENVIRONMENT_ID`

The QA platform's own `.github/workflows/deploy.yml` includes the same guarded
post-deployment job. It does nothing until its variables are configured.

## Other Providers

- GitLab CI: `docs/ci-examples/gitlab-ci.yml`
- Azure DevOps: `docs/ci-examples/azure-pipelines.yml`
- Jenkins: `docs/ci-examples/Jenkinsfile`
- Direct API/curl: `docs/ci-examples/publish-with-curl.sh`

## Verification

After the deployment job succeeds:

1. Open **Project → Environments**.
2. Confirm the version is labelled **CI verified**.
3. Open release history and confirm commit, pipeline URL, and component versions.
4. Start a QA run against that environment.
5. Confirm **Tested version** appears in Testing View, run history, run detail, and report.
6. Retry the CI job and confirm the same idempotency key does not create a duplicate.

Do not use a user JWT or GitHub PAT for this API. Use only an environment-scoped
deployment token.
