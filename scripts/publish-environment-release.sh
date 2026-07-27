#!/usr/bin/env bash
set -euo pipefail

required=(
  QA_PLATFORM_URL
  QA_PROJECT_ID
  QA_ENVIRONMENT_ID
  QA_DEPLOY_TOKEN
  QA_RELEASE_VERSION
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 2
  fi
done

for command_name in curl jq; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "${command_name} is required to publish an environment release" >&2
    exit 2
  fi
done

status="${QA_DEPLOYMENT_STATUS:-SUCCESS}"
case "${status}" in
  SUCCESS|FAILED|PENDING|ROLLED_BACK) ;;
  *)
    echo "QA_DEPLOYMENT_STATUS must be SUCCESS, FAILED, PENDING, or ROLLED_BACK" >&2
    exit 2
    ;;
esac

components_json="${QA_COMPONENTS_JSON:-[]}"
if ! jq -e 'type == "array"' >/dev/null 2>&1 <<<"${components_json}"; then
  echo "QA_COMPONENTS_JSON must be a valid JSON array" >&2
  exit 2
fi

payload="$(
  jq -n \
    --arg status "${status}" \
    --arg releaseVersion "${QA_RELEASE_VERSION}" \
    --arg commitSha "${QA_COMMIT_SHA:-}" \
    --arg branch "${QA_BRANCH:-}" \
    --arg artifactDigest "${QA_ARTIFACT_DIGEST:-}" \
    --arg pipelineUrl "${QA_PIPELINE_URL:-}" \
    --arg deployedAt "${QA_DEPLOYED_AT:-}" \
    --argjson components "${components_json}" \
    '{
      status: $status,
      releaseVersion: $releaseVersion,
      commitSha: $commitSha,
      branch: $branch,
      artifactDigest: $artifactDigest,
      pipelineUrl: $pipelineUrl,
      deployedAt: $deployedAt,
      components: $components
    }
    | with_entries(select(.value != "" and .value != []))'
)"

endpoint="${QA_PLATFORM_URL%/}/api/v1/projects/${QA_PROJECT_ID}/environments/${QA_ENVIRONMENT_ID}/deployments"
idempotency_key="${QA_IDEMPOTENCY_KEY:-${QA_PROJECT_ID}:${QA_ENVIRONMENT_ID}:${QA_RELEASE_VERSION}:${status}}"

response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT

http_status="$(
  curl --silent --show-error \
    --output "${response_file}" \
    --write-out '%{http_code}' \
    --request POST \
    --header "Authorization: Bearer ${QA_DEPLOY_TOKEN}" \
    --header 'Content-Type: application/json' \
    --header "Idempotency-Key: ${idempotency_key}" \
    --data "${payload}" \
    "${endpoint}"
)"

if [[ "${http_status}" -lt 200 || "${http_status}" -ge 300 ]]; then
  echo "Release publication failed with HTTP ${http_status}" >&2
  cat "${response_file}" >&2
  exit 1
fi

jq '{
  id,
  version,
  status,
  source,
  environmentId,
  deployedAt,
  components: [.components[]? | {
    componentName,
    version,
    commitSha,
    branch
  }]
}' "${response_file}"
