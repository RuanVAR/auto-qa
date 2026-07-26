#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/lib/code-index-rollout.sh"

expect_pass() {
  "$@" >/dev/null 2>&1 || {
    echo "Expected rollout validation to pass: $*" >&2
    exit 1
  }
}

expect_fail() {
  if "$@" >/dev/null 2>&1; then
    echo "Expected rollout validation to fail: $*" >&2
    exit 1
  fi
}

expect_pass validate_code_index_rollout local 1 4 4096 ""
expect_pass validate_code_index_rollout external 1 4 512 "https://indexer.example.com"
expect_fail validate_code_index_rollout local 1 4 4095 ""
expect_fail validate_code_index_rollout local 2 4 8192 ""
expect_fail validate_code_index_rollout local 1 0 8192 ""
expect_fail validate_code_index_rollout local 1 61 8192 ""
expect_fail validate_code_index_rollout external 1 4 512 ""
expect_fail validate_code_index_rollout unsupported 1 4 8192 ""

detected="$(code_index_total_memory_mb)"
[[ "$detected" =~ ^[0-9]+$ ]] && [[ "$detected" -gt 0 ]]

echo "Code index rollout gate tests passed (detected ${detected} MB)"
