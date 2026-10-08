#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONFIG="$ROOT/cloudflare/wrangler.jsonc"
SECRETS="$ROOT/cloudflare/.secrets.json"
cd "$ROOT"

npm run build
if [ -f "$SECRETS" ]; then
  npx wrangler deploy --config "$CONFIG" --secrets-file "$SECRETS"
  rm -f "$SECRETS"
else
  npx wrangler deploy --config "$CONFIG"
fi
