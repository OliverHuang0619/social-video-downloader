#!/bin/sh
set -eu

mkdir -p /downloads /config/codex-home/.codex/skills /config/analysis /config/publish-artifacts /config/publish-temp
ln -sfn /app/skills/english-video-catalog /config/codex-home/.codex/skills/english-video-catalog
chown -R node:node /downloads /config
exec gosu node "$@"
