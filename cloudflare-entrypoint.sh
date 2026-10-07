#!/bin/sh
set -eu
umask 077

mkdir -p /downloads /imports /config/douyin-profile /tmp/.X11-unix
chown -R node:node /downloads /config
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
chmod 1777 /tmp/.X11-unix

profile_key=${SVD_CF_CONTAINER_ID}/browser-profile.enc
if curl --silent --show-error --fail --max-time 60 \
  -H "authorization: Bearer ${SVD_CF_BRIDGE_TOKEN}" \
  "http://svw.r2.internal/${SVD_CF_CONTAINER_ID}/workbench-config.enc" -o /tmp/workbench-config.enc; then
  node /usr/local/bin/cloudflare-profile-crypto.mjs decrypt /tmp/workbench-config.enc /tmp/workbench-config.tar.gz
  tar -xzf /tmp/workbench-config.tar.gz -C /config
  rm -f /tmp/workbench-config.enc /tmp/workbench-config.tar.gz
fi

if curl --silent --show-error --fail --max-time 60 \
  -H "authorization: Bearer ${SVD_CF_BRIDGE_TOKEN}" \
  "http://svw.r2.internal/${profile_key}" -o /tmp/profile.enc; then
  node /usr/local/bin/cloudflare-profile-crypto.mjs decrypt /tmp/profile.enc /tmp/profile.tar.gz
  tar -xzf /tmp/profile.tar.gz -C /config
  rm -f /tmp/profile.enc /tmp/profile.tar.gz
fi
chown -R node:node /config

(
  config_snapshot_counter=0
  while :; do
    sleep 45
    if ! tar -czf /tmp/profile.tar.gz -C /config --exclude='douyin-profile/Singleton*' douyin-profile; then
      rm -f /tmp/profile.tar.gz /tmp/profile.enc
      continue
    fi
    if node /usr/local/bin/cloudflare-profile-crypto.mjs encrypt /tmp/profile.tar.gz /tmp/profile.enc; then
      curl --silent --show-error --fail --max-time 120 \
        -X PUT -H "authorization: Bearer ${SVD_CF_BRIDGE_TOKEN}" \
        -H 'content-type: application/octet-stream' \
        --data-binary @/tmp/profile.enc \
        "http://svw.r2.internal/${profile_key}" >/dev/null || echo 'Encrypted browser profile backup failed' >&2
    fi
    rm -f /tmp/profile.enc /tmp/profile.tar.gz
    config_snapshot_counter=$((config_snapshot_counter + 1))
    if [ "$config_snapshot_counter" -ge 7 ]; then
      config_snapshot_counter=0
      tar_status=0
      tar -czf /tmp/workbench-config.tar.gz -C /config \
        --exclude='./workbench.sqlite*' --exclude='./*.sqlite' --exclude='./*.sqlite-*' \
        --exclude='./douyin-profile' . || tar_status=$?
      if [ "$tar_status" -gt 1 ]; then
        rm -f /tmp/workbench-config.tar.gz /tmp/workbench-config.enc
        continue
      fi
      if node /usr/local/bin/cloudflare-profile-crypto.mjs encrypt /tmp/workbench-config.tar.gz /tmp/workbench-config.enc; then
        curl --silent --show-error --fail --max-time 120 \
          -X PUT -H "authorization: Bearer ${SVD_CF_BRIDGE_TOKEN}" \
          -H 'content-type: application/octet-stream' \
          --data-binary @/tmp/workbench-config.enc \
          "http://svw.r2.internal/${SVD_CF_CONTAINER_ID}/workbench-config.enc" >/dev/null || echo 'Encrypted workbench config backup failed' >&2
      fi
      rm -f /tmp/workbench-config.enc /tmp/workbench-config.tar.gz
    fi
  done
) &

Xvfb :99 -screen 0 1440x960x24 -ac +extension RANDR &
sleep 1
gosu node openbox-session &
gosu node chromium \
  --no-first-run --no-default-browser-check --no-sandbox --disable-dev-shm-usage \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --remote-allow-origins='*' --user-data-dir=/config/douyin-profile \
  --window-size=1440,960 about:blank &
gosu node x11vnc -display :99 -forever -shared -nopw -rfbport 5900 &
websockify --web=/usr/share/novnc 6080 127.0.0.1:5900 &

# Do not block the application port on browser startup. Cloudflare waits for
# the configured container port before routing traffic; making Chromium/noVNC
# readiness a prerequisite can cause cold starts to be terminated before the
# API (including login) ever becomes available.
exec gosu node node /app/dist/server/index.js
