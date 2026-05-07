#!/usr/bin/env bash
# Smoke-test Issue Viewer API flows with curl (requires jq).
# Prerequisites: API up on API_URL (default http://localhost:3001); seeded users (Demo123!).
#
#   export DEMO_EMAIL='ruan15viljoen@gmail.com'
#   export DEMO_PASSWORD='Demo123!'
#   bash scripts/issue-viewer-api-smoke.sh
#
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
DEMO_EMAIL="${DEMO_EMAIL:-ruan15viljoen@gmail.com}"
DEMO_PASSWORD="${DEMO_PASSWORD:-Demo123!}"

echo "=== API Issue Viewer curl smoke (${API_URL}) ==="

need_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "Install jq so we can parse JSON (brew install jq)." >&2
    exit 1
  }
}
need_jq

echo "→ Login"
LOGIN_JSON="$(curl -sS -X POST "${API_URL}/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${DEMO_EMAIL}\",\"password\":\"${DEMO_PASSWORD}\"}")"

if echo "${LOGIN_JSON}" | jq -e '.statusCode' >/dev/null 2>&1; then
  echo "LOGIN FAILED:"
  echo "${LOGIN_JSON}" | jq .
  exit 1
fi

TOKEN="$(echo "${LOGIN_JSON}" | jq -r '.accessToken // empty')"
if [[ -z "${TOKEN}" ]] || [[ "${TOKEN}" == "null" ]]; then
  echo "No accessToken in response:"
  echo "${LOGIN_JSON}" | jq .
  exit 1
fi
echo "  OK — got access token"

AUTH=( -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' )

echo "→ List projects"
PROJECTS="$(curl -sS "${API_URL}/api/v1/projects" "${AUTH[@]}")"
if echo "${PROJECTS}" | jq -e '.statusCode' >/dev/null 2>&1; then
  echo "PROJECTS FAILED:"
  echo "${PROJECTS}" | jq .
  exit 1
fi
PROJECT_ID="$(echo "${PROJECTS}" | jq -r '.[0].id // empty')"
if [[ -z "${PROJECT_ID}" ]] || [[ "${PROJECT_ID}" == "null" ]]; then
  echo "No project in response:"
  echo "${PROJECTS}" | jq .
  exit 1
fi
echo "  OK — project ${PROJECT_ID}"

echo "→ Create issue (minimal)"
CREATE_BODY="$(jq -nc --arg title "curl smoke $(date +%s)" '{"type":"BUG","severity":"MEDIUM","title":$title,"description":"Created by issue-viewer-api-smoke.sh"}')"
CREATE_RES="$(curl -sS -X POST "${API_URL}/api/v1/projects/${PROJECT_ID}/issues" \
  "${AUTH[@]}" -d "${CREATE_BODY}")"
if echo "${CREATE_RES}" | jq -e '.statusCode' >/dev/null 2>&1; then
  echo "CREATE ISSUE FAILED:"
  echo "${CREATE_RES}" | jq .
  exit 1
fi
ISSUE_ID="$(echo "${CREATE_RES}" | jq -r '.id')"
echo "  OK — issue ${ISSUE_ID}"

echo "→ GET /issues/:id"
GET_ONE="$(curl -sS "${API_URL}/api/v1/issues/${ISSUE_ID}" "${AUTH[@]}")"
echo "${GET_ONE}" | jq '{ id, title, status, comments: (.comments|length), statusHistory: (.statusHistory|length) }'

echo "→ POST /issues/:id/view"
VIEW_RES="$(curl -sS -X POST "${API_URL}/api/v1/issues/${ISSUE_ID}/view" "${AUTH[@]}" -d '{}')"
echo "${VIEW_RES}" | jq .

echo "→ GET /issues/:id/views"
curl -sS "${API_URL}/api/v1/issues/${ISSUE_ID}/views" "${AUTH[@]}" | jq .

echo "→ GET /issues/:id/mentionable"
curl -sS "${API_URL}/api/v1/issues/${ISSUE_ID}/mentionable" "${AUTH[@]}" | jq 'length'

echo "→ GET /issues/:id/viewer (access-checked payload)"
curl -sS "${API_URL}/api/v1/issues/${ISSUE_ID}/viewer" "${AUTH[@]}" | jq '{ id, title, projectId }'

echo "→ POST comment with @mention"
COMMENT_BODY="$(jq -nc --arg c 'Ping from curl — @'"${DEMO_EMAIL%%@*}"' please check.' '{content:$c}')"
COMMENT_RES="$(curl -sS -X POST "${API_URL}/api/v1/issues/${ISSUE_ID}/comments" \
  "${AUTH[@]}" -d "${COMMENT_BODY}")"
if echo "${COMMENT_RES}" | jq -e '.statusCode' >/dev/null 2>&1; then
  echo "COMMENT FAILED:"
  echo "${COMMENT_RES}" | jq .
  exit 1
fi
COMMENT_ID="$(echo "${COMMENT_RES}" | jq -r '.id // .comment.id // empty')"
echo "  OK comment id: ${COMMENT_ID}"

echo "→ POST /issues/:id/status"
STATUS_BODY='{"status":"IN_PROGRESS","note":"curl smoke"}'
curl -sS -X POST "${API_URL}/api/v1/issues/${ISSUE_ID}/status" \
  "${AUTH[@]}" -d "${STATUS_BODY}" | jq '{ id, status }'

echo "→ PATCH /issues/:id (severity)"
PATCH_BODY='{"severity":"HIGH"}'
curl -sS -X PATCH "${API_URL}/api/v1/issues/${ISSUE_ID}" \
  "${AUTH[@]}" -d "${PATCH_BODY}" | jq '{ id, severity }'

echo ""
echo "=== All curls completed successfully ==="
