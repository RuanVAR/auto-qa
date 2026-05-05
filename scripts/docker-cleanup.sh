#!/usr/bin/env bash
# Daily Docker cleanup — installed as a cron job by the deploy workflow.
#
# Strategy:
#   - Remove dangling images (intermediate build layers no longer tagged)
#   - Remove images older than 72h that aren't currently in use by a container
#   - Trim BuildKit cache to 3 GB (keeps recent layers for fast rebuilds)
#   - Remove stopped one-shot containers (e.g. migration/seed runners)
#   - Log what was freed so we can audit via `journalctl` or cron mail
#
# Safe: never touches running containers, named volumes, or the :latest images
# that active containers depend on.

set -euo pipefail

echo "=== Docker cleanup $(date -Iseconds) ==="

echo "→ Removing stopped containers..."
docker container prune -f

echo "→ Removing dangling images..."
docker image prune -f

echo "→ Removing unused images older than 72h..."
docker image prune -a -f --filter "until=72h"

echo "→ Trimming build cache (keeping 3 GB)..."
docker builder prune -f --keep-storage=3GB || true

echo "→ Current disk usage:"
docker system df

echo "=== Cleanup done ==="
