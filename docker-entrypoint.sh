#!/bin/sh
set -eu

chown -R node:node /downloads /config
exec gosu node "$@"
