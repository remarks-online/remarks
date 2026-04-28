#!/usr/bin/env bash
set -euo pipefail
cd "$CONDUCTOR_WORKSPACE_PATH"
pnpm minio:up
exec pnpm test:integration
