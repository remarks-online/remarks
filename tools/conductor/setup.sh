#!/usr/bin/env bash
# Conductor workspace bootstrap. Runs once when a new workspace is created.
# Env: CONDUCTOR_ROOT_PATH (origin checkout), CONDUCTOR_WORKSPACE_PATH (this workspace).
set -euo pipefail

cd "$CONDUCTOR_WORKSPACE_PATH"

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> Copying .env.local files from $CONDUCTOR_ROOT_PATH"
copy_env() {
  local rel="$1"
  local src="$CONDUCTOR_ROOT_PATH/$rel"
  local dst="$CONDUCTOR_WORKSPACE_PATH/$rel"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "    copied $rel"
  else
    echo "    skipped $rel (not present in root checkout)"
  fi
}
copy_env apps/api/.env.local
copy_env apps/dashboard/.env.local
copy_env apps/extension/.env.local
copy_env apps/mcp/.env.local
copy_env packages/db/.env.local

echo "==> Prebuilding packages (required for typecheck/test/build)"
pnpm turbo build --filter='./packages/*'

echo "==> Setup complete."
