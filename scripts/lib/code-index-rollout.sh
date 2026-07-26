#!/usr/bin/env bash

code_index_total_memory_mb() {
  if [[ -r /proc/meminfo ]]; then
    awk '/^MemTotal:/ { print int($2 / 1024); exit }' /proc/meminfo
    return
  fi
  if command -v sysctl >/dev/null 2>&1; then
    local bytes
    bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
    if [[ "$bytes" =~ ^[0-9]+$ ]]; then
      echo $((bytes / 1024 / 1024))
      return
    fi
  fi
  return 1
}

validate_code_index_rollout() {
  local deployment="$1"
  local concurrency="$2"
  local jobs_per_minute="$3"
  local total_memory_mb="$4"
  local external_health_url="${5:-}"

  case "$deployment" in
    local|external) ;;
    *)
      echo "CODE_INDEXER_DEPLOYMENT must be local or external" >&2
      return 1
      ;;
  esac

  if [[ ! "$concurrency" =~ ^[0-9]+$ ]] || [[ "$concurrency" -ne 1 ]]; then
    echo "CODE_INDEX_CONCURRENCY must be 1 for the initial production rollout" >&2
    return 1
  fi
  if [[ ! "$jobs_per_minute" =~ ^[0-9]+$ ]] \
    || [[ "$jobs_per_minute" -lt 1 ]] \
    || [[ "$jobs_per_minute" -gt 60 ]]; then
    echo "CODE_INDEX_JOBS_PER_MINUTE must be an integer between 1 and 60" >&2
    return 1
  fi

  if [[ "$deployment" == "local" ]]; then
    if [[ ! "$total_memory_mb" =~ ^[0-9]+$ ]] || [[ "$total_memory_mb" -lt 4096 ]]; then
      echo "Local code indexing requires at least 4096 MB physical RAM (detected ${total_memory_mb:-unknown} MB)" >&2
      return 1
    fi
  elif [[ -z "$external_health_url" ]]; then
    echo "CODE_INDEXER_EXTERNAL_HEALTH_URL is required for external deployment" >&2
    return 1
  fi
}
