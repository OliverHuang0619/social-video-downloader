#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONFIG="$ROOT/cloudflare/wrangler.jsonc"
cd "$ROOT"

node cloudflare/deploy-preflight.mjs "$CONFIG"

npm run build
npx wrangler d1 migrations apply svw-workbench --remote --config "$CONFIG"
npx wrangler r2 bucket cors set svw-workbench-media --file cloudflare/r2-cors.json --config "$CONFIG" --force
if [ -f "$ROOT/cloudflare/.secrets.json" ]; then
  npx wrangler deploy --config "$CONFIG" --secrets-file "$ROOT/cloudflare/.secrets.json"
  rm -f "$ROOT/cloudflare/.secrets.json"
else
  npx wrangler deploy --config "$CONFIG"
fi
