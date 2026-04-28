#!/usr/bin/env bash
# Start MinIO (shared, idempotent) and all four app dev servers via turbo.
# Default ports: dashboard 3000, api 4000, mcp 4001, extension 3030.
# Enable "Nonconcurrent Mode" in Conductor Repository Settings so only one
# workspace's dev servers run at a time.
set -euo pipefail
cd "$CONDUCTOR_WORKSPACE_PATH"
pnpm minio:up
exec pnpm dev
