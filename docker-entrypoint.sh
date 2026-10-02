#!/bin/sh
set -eu

mkdir -p /downloads /config/codex-home /config/analysis /config/publish-artifacts /config/publish-temp
chown -R node:node /downloads /config
exec gosu node "$@"
