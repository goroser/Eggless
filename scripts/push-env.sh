#!/usr/bin/env bash
# Copies the app's variables from .env.local to Vercel production without printing their values.
# DATABASE_URL is not copied: the Neon integration already sets it on Vercel.
# Run: bash scripts/push-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NAMES=(GOOGLE_PLACES_API_KEY NEXT_PUBLIC_GOOGLE_MAPS_API_KEY NEXT_PUBLIC_GOOGLE_MAP_ID ANTHROPIC_API_KEY
  ANTHROPIC_WORKSPACE_ID LLM_MODEL MENU_TOKEN_SECRET ACCESS_KEY)

for name in "${NAMES[@]}"; do
  value=$(grep -E "^${name}=" .env.local | head -1 | cut -d= -f2-)
  if [ -z "$value" ]; then
    echo "skip  $name (empty in .env.local)"
    continue
  fi
  npx --yes vercel@latest env rm "$name" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | npx --yes vercel@latest env add "$name" production >/dev/null 2>&1
  echo "set   $name"
done
echo "Done. Ask Claude to redeploy."
