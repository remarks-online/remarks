#!/usr/bin/env bash
# Reset the Neon `dev` branch from `main` so its schema + data match, then
# apply any drizzle migrations that exist locally. Run this after pulling new
# migrations, or whenever dev schema has drifted.
#
# Usage:
#   pnpm db:dev:reset
#
# Environment:
#   NEON_ORG_ID      Override auto-detected org id (optional).
#   NEON_PROJECT_ID  Override auto-detected project id (optional).
set -euo pipefail

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required tool: $1" >&2
    exit 1
  }
}
require neonctl
require jq
require pnpm

# neonctl prompts for org interactively unless --org-id is passed. Auto-pick
# when the account has exactly one org; otherwise require NEON_ORG_ID.
ORG_ID="${NEON_ORG_ID:-}"
if [[ -z "$ORG_ID" ]]; then
  ORGS=$(neonctl orgs list --output json)
  ORG_COUNT=$(echo "$ORGS" | jq 'length')
  if [[ "$ORG_COUNT" != "1" ]]; then
    echo "Expected exactly 1 Neon org, found $ORG_COUNT. Set NEON_ORG_ID explicitly." >&2
    exit 1
  fi
  ORG_ID=$(echo "$ORGS" | jq -r '.[0].id')
fi

PROJECT_ID="${NEON_PROJECT_ID:-}"
if [[ -z "$PROJECT_ID" ]]; then
  PROJECTS=$(neonctl projects list --org-id "$ORG_ID" --output json)
  COUNT=$(echo "$PROJECTS" | jq 'length')
  if [[ "$COUNT" != "1" ]]; then
    echo "Expected exactly 1 Neon project in org $ORG_ID, found $COUNT. Set NEON_PROJECT_ID explicitly." >&2
    exit 1
  fi
  PROJECT_ID=$(echo "$PROJECTS" | jq -r '.[0].id')
fi
echo "Using Neon project: $PROJECT_ID"

DEV_EXISTS=$(neonctl branches list --project-id "$PROJECT_ID" --output json \
  | jq 'any(.name == "dev")')

if [[ "$DEV_EXISTS" == "true" ]]; then
  echo "Resetting 'dev' branch from main..."
  neonctl branches reset dev --project-id "$PROJECT_ID" --parent >/dev/null
else
  echo "Creating 'dev' branch from main..."
  neonctl branches create --project-id "$PROJECT_ID" --name dev --parent main >/dev/null
fi

DEV_URL=$(neonctl connection-string dev \
  --project-id "$PROJECT_ID" \
  --database-name neondb \
  --role-name neondb_owner)

# Write DATABASE_URL into each app .env.local that needs it (currently just api).
# Preserves other lines in the file; adds DATABASE_URL if missing.
write_env() {
  local file="$1"
  local url="$2"
  [[ -f "$file" ]] || return 0
  if grep -q "^DATABASE_URL=" "$file"; then
    awk -v url="$url" '
      /^DATABASE_URL=/ { print "DATABASE_URL=\"" url "\""; next }
      { print }
    ' "$file" > "$file.tmp"
    mv "$file.tmp" "$file"
  else
    printf 'DATABASE_URL="%s"\n' "$url" >> "$file"
  fi
  echo "  updated DATABASE_URL in $file"
}

REPO_ROOT=$(git rev-parse --show-toplevel)
write_env "$REPO_ROOT/apps/api/.env.local" "$DEV_URL"

echo "Applying drizzle migrations..."
DATABASE_URL="$DEV_URL" pnpm --filter @remarks/db db:migrate

echo "Dev DB ready."
