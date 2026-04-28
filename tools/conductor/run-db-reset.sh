#!/usr/bin/env bash
# Reset the Neon dev branch and reapply migrations. Destructive.
set -euo pipefail
cd "$CONDUCTOR_WORKSPACE_PATH"
exec pnpm db:dev:reset
