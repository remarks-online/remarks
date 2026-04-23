#!/usr/bin/env bash
# Wait for MinIO to be reachable on localhost:9000. Used by `pnpm minio:up`
# so the compose-up script doesn't return until the service is actually
# accepting connections. Bails after ~30 seconds with a non-zero exit.
set -euo pipefail

for _ in $(seq 1 30); do
  if curl -sf http://localhost:9000/minio/health/live > /dev/null; then
    echo "minio ready"
    exit 0
  fi
  sleep 1
done

echo "minio failed to become ready within 30s" >&2
docker compose logs minio >&2 || true
exit 1
