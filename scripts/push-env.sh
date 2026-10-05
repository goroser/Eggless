#!/usr/bin/env bash
# Copies the app's variables from .env.local to Vercel production without printing their values.
# DATABASE_URL is not copied: the Neon integration already sets it on Vercel.
# Run: bash scripts/push-env.sh
set -uo pipefail
cd "$(dirname "$0")/.."

NAMES=(GOOGLE_PLACES_API_KEY NEXT_PUBLIC_GOOGLE_MAPS_API_KEY NEXT_PUBLIC_GOOGLE_MAP_ID ANTHROPIC_API_KEY
  ANTHROPIC_WORKSPACE_ID LLM_MODEL MENU_TOKEN_SECRET ACCESS_KEY)

# Optional: pass variable names to upload only those, e.g. bash scripts/push-env.sh NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
if [ $# -gt 0 ]; then NAMES=("$@"); fi

for name in "${NAMES[@]}"; do
  # NEXT_PUBLIC_ values are sent to every visitor's browser by design (the Maps key is
  # restricted by HTTP referrer), so they are stored as plain config, not secrets.
  type_flag=()
  case "$name" in NEXT_PUBLIC_*) type_flag=(--type config) ;; esac
  value=$(grep -E "^${name}=" .env.local | head -1 | cut -d= -f2- || true)
  if [ -z "$value" ]; then
    echo "skip  $name (empty in .env.local)"
    continue
  fi
  npx --yes vercel@latest env rm "$name" production --yes >/dev/null 2>&1 || true
  # The CLI never echoes the value, so its output is safe to show on failure.
  if out=$(printf '%s' "$value" | npx --yes vercel@latest env add "$name" production ${type_flag[@]+"${type_flag[@]}"} 2>&1); then
    echo "set   $name"
  else
    echo "FAIL  $name: $(printf '%s' "$out" | grep -v '^\s*$' | tail -3 | tr '\n' ' ')"
  fi
done
echo "Done. Ask Claude to redeploy."
