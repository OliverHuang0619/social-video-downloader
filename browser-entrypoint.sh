#!/bin/sh
set -eu

chown -R browser:browser /browser-profile
rm -f /browser-profile/SingletonCookie /browser-profile/SingletonLock /browser-profile/SingletonSocket
rm -f /tmp/.X99-lock
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix
rm -f /tmp/.X11-unix/X99

gosu browser Xvfb :99 -screen 0 1440x960x24 -ac +extension RANDR &
sleep 1
gosu browser openbox-session &
gosu browser chromium \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --remote-allow-origins='*' \
  --user-data-dir=/browser-profile \
  --window-size=1440,960 \
  about:blank &
chrome_pid=$!
gosu browser x11vnc -display :99 -forever -shared -nopw -rfbport 5900 &
websockify --web=/usr/share/novnc 6080 127.0.0.1:5900 &

wait "$chrome_pid"
