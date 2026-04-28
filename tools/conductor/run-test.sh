#!/usr/bin/env bash
set -euo pipefail
cd "$CONDUCTOR_WORKSPACE_PATH"
exec pnpm test
