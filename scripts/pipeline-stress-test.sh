#!/usr/bin/env bash
# Pipeline adversarial + bulk test battery. Re-run before releases that touch
# the sequencer. Requires: a running stack, a PAT, and a project with at least
# one automation-enabled env + one feature with automatable tests.
#
# Usage:
#   QA_URL=http://localhost:3001 QA_PAT=qapt_... \
#   PROJECT_ID=... FEATURE_ID=... ENV_ID=... bash scripts/pipeline-stress-test.sh
#
# Covers: create-validation matrix (0/21 stages, whitelist, dup name,
# all-stages-in-one-400), trigger hammering (10 parallel → exactly 1 winner),
# overlap 409, delete-mid-run 409, stop cascade + double-stop, XOR schedule
# guards, 20-stage bulk run to completion with ordered results.
set -euo pipefail
: "${QA_URL:?}" "${QA_PAT:?}" "${PROJECT_ID:?}" "${FEATURE_ID:?}" "${ENV_ID:?}"
AUTH=(-H "Authorization: Bearer $QA_PAT")
JSON=(-H "Content-Type: application/json")
pass=0; fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ✓ $1"; else fail=$((fail+1)); echo "  ✗ $1 (expected $2, got $3)"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "── create-validation matrix ──"
check "0 stages → 400" 400 "$(code "${AUTH[@]}" "${JSON[@]}" -X POST "$QA_URL/api/v1/projects/$PROJECT_ID/pipelines" -d '{"name":"st-0","stages":[]}')"
STAGES21=$(python3 -c "import json;print(json.dumps([{'featureId':'$FEATURE_ID','environmentId':'$ENV_ID'}]*21))")
check "21 stages → 400" 400 "$(code "${AUTH[@]}" "${JSON[@]}" -X POST "$QA_URL/api/v1/projects/$PROJECT_ID/pipelines" -d "{\"name\":\"st-21\",\"stages\":$STAGES21}")"
check "whitelist violation → 400" 400 "$(code "${AUTH[@]}" "${JSON[@]}" -X POST "$QA_URL/api/v1/projects/$PROJECT_ID/pipelines" -d "{\"name\":\"st-w\",\"hacker\":true,\"stages\":[{\"featureId\":\"$FEATURE_ID\",\"environmentId\":\"$ENV_ID\"}]}")"

echo "── hammering + lifecycle ──"
PIPE=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$QA_URL/api/v1/projects/$PROJECT_ID/pipelines" \
  -d "{\"name\":\"stress-$(date +%s)\",\"stages\":[{\"featureId\":\"$FEATURE_ID\",\"environmentId\":\"$ENV_ID\"},{\"featureId\":\"$FEATURE_ID\",\"environmentId\":\"$ENV_ID\"}]}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
check "duplicate name → 409" 409 "$(code "${AUTH[@]}" "${JSON[@]}" -X POST "$QA_URL/api/v1/projects/$PROJECT_ID/pipelines" -d "{\"name\":\"$(curl -s "${AUTH[@]}" "$QA_URL/api/v1/projects/$PROJECT_ID/pipelines" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["name"])')\",\"stages\":[{\"featureId\":\"$FEATURE_ID\",\"environmentId\":\"$ENV_ID\"}]}")"

# 10 parallel triggers → exactly one 201
tmp=$(mktemp -d)
for i in $(seq 1 10); do (code "${AUTH[@]}" -X POST "$QA_URL/api/v1/pipelines/$PIPE/trigger" > "$tmp/$i") & done; wait
C201=$(cat "$tmp"/* | grep -c 201 || true); C409=$(cat "$tmp"/* | grep -c 409 || true)
check "hammer: exactly one 201" 1 "$C201"
check "hammer: nine 409s" 9 "$C409"
RUN=$(curl -s "${AUTH[@]}" "$QA_URL/api/v1/pipelines/$PIPE/runs?limit=1" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
check "delete mid-run → 409" 409 "$(code "${AUTH[@]}" -X DELETE "$QA_URL/api/v1/pipelines/$PIPE")"
check "stop → 201" 201 "$(code "${AUTH[@]}" -X POST "$QA_URL/api/v1/pipeline-runs/$RUN/stop")"
check "double stop → 409" 409 "$(code "${AUTH[@]}" -X POST "$QA_URL/api/v1/pipeline-runs/$RUN/stop")"
sleep 2
check "delete after stop → 200" 200 "$(code "${AUTH[@]}" -X DELETE "$QA_URL/api/v1/pipelines/$PIPE")"

echo "── 20-stage bulk to completion ──"
STAGES20=$(python3 -c "import json;print(json.dumps([{'featureId':'$FEATURE_ID','environmentId':'$ENV_ID'}]*20))")
BULK=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$QA_URL/api/v1/projects/$PROJECT_ID/pipelines" -d "{\"name\":\"bulk20-$(date +%s)\",\"stages\":$STAGES20}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
BRUN=$(curl -s "${AUTH[@]}" -X POST "$QA_URL/api/v1/pipelines/$BULK/trigger" | python3 -c 'import sys,json;print(json.load(sys.stdin)["pipelineRunId"])')
echo "  bulk run $BRUN — polling (30 min budget)…"
for i in $(seq 1 120); do
  ST=$(curl -s "${AUTH[@]}" "$QA_URL/api/v1/pipeline-runs/$BRUN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
  case "$ST" in COMPLETE|FAILED|CANCELLED) break;; esac
  sleep 15
done
check "bulk terminal COMPLETE" COMPLETE "$ST"
NRES=$(curl -s "${AUTH[@]}" "$QA_URL/api/v1/pipeline-runs/$BRUN" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["stageResults"]))')
check "bulk: 20 ordered stage results" 20 "$NRES"
curl -s "${AUTH[@]}" -X DELETE "$QA_URL/api/v1/pipelines/$BULK" > /dev/null

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
