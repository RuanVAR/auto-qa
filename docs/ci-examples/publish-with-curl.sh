#!/usr/bin/env bash
set -euo pipefail

curl --fail-with-body --silent --show-error \
  --request POST \
  --header "Authorization: Bearer ${QA_DEPLOY_TOKEN}" \
  --header 'Content-Type: application/json' \
  --header "Idempotency-Key: ${QA_IDEMPOTENCY_KEY}" \
  --data "{
    \"status\": \"SUCCESS\",
    \"releaseVersion\": \"${QA_RELEASE_VERSION}\",
    \"commitSha\": \"${QA_COMMIT_SHA}\",
    \"branch\": \"${QA_BRANCH}\",
    \"pipelineUrl\": \"${QA_PIPELINE_URL}\"
  }" \
  "${QA_PLATFORM_URL%/}/api/v1/projects/${QA_PROJECT_ID}/environments/${QA_ENVIRONMENT_ID}/deployments"
