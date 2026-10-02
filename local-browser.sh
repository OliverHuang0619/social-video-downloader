#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="${LOCAL_BROWSER_PROFILE_DIR:-$ROOT_DIR/config/local-browser-profile}"
PORT="${LOCAL_BROWSER_CDP_PORT:-9222}"
PROXY_PORT="${LOCAL_BROWSER_PROXY_PORT:-9223}"
PID_FILE="$ROOT_DIR/config/local-browser.pid"
PROXY_PID_FILE="$ROOT_DIR/config/local-browser-proxy.pid"
TOKEN_FILE="$ROOT_DIR/config/local-browser.token"
LOG_FILE="$ROOT_DIR/config/local-browser.log"
PROXY_LOG_FILE="$ROOT_DIR/config/local-browser-proxy.log"
PROXY_LAUNCHD_LABEL="com.social-video-workbench.local-browser-proxy"

chrome_ready() { curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; }
proxy_ready() { [[ -s "$TOKEN_FILE" ]] && curl -fsS --max-time 2 -H "Authorization: Bearer $(<"$TOKEN_FILE")" "http://127.0.0.1:${PROXY_PORT}/json/version" >/dev/null 2>&1; }

random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

find_browser() {
  local candidate
  for candidate in \
    "${LOCAL_BROWSER_BIN:-}" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "$(command -v google-chrome-stable 2>/dev/null || true)" \
    "$(command -v google-chrome 2>/dev/null || true)" \
    "$(command -v chromium 2>/dev/null || true)" \
    "$(command -v chromium-browser 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then printf '%s' "$candidate"; return; fi
  done
  return 1
}

start_browser() {
  mkdir -p "$PROFILE_DIR" "$ROOT_DIR/config"
  chmod 700 "$PROFILE_DIR"
  if [[ ! -s "$TOKEN_FILE" ]]; then
    umask 077
    random_secret > "$TOKEN_FILE"
  fi
  chmod 600 "$TOKEN_FILE"
  if ! chrome_ready; then
    local browser
    browser="$(find_browser)" || { printf '未找到 Chrome/Chromium；可通过 LOCAL_BROWSER_BIN 指定路径。\n' >&2; exit 1; }
    if [[ "$(uname -s)" == "Darwin" ]]; then
      open -na "$(dirname "$(dirname "$(dirname "$browser")")")" --args \
        --remote-debugging-address=127.0.0.1 \
        --remote-debugging-port="$PORT" \
        --user-data-dir="$PROFILE_DIR" \
        --no-first-run \
        --no-default-browser-check \
        about:blank
    else
      nohup "$browser" \
        --remote-debugging-address=127.0.0.1 \
        --remote-debugging-port="$PORT" \
        --user-data-dir="$PROFILE_DIR" \
        --no-first-run \
        --no-default-browser-check \
        about:blank </dev/null >>"$LOG_FILE" 2>&1 &
      printf '%s' "$!" > "$PID_FILE"
    fi
    for _ in $(seq 1 20); do chrome_ready && break; sleep 1; done
    chrome_ready || { printf '本地浏览器启动失败，请查看 %s\n' "$LOG_FILE" >&2; exit 1; }
  fi
  if ! proxy_ready; then
    command -v node >/dev/null 2>&1 || { printf '本地浏览器模式需要 Node.js。\n' >&2; exit 1; }
    if [[ "$(uname -s)" == "Darwin" ]]; then
      launchctl remove "$PROXY_LAUNCHD_LABEL" >/dev/null 2>&1 || true
      launchctl submit -l "$PROXY_LAUNCHD_LABEL" -o "$PROXY_LOG_FILE" -e "$PROXY_LOG_FILE" -- \
        /usr/bin/env LOCAL_BROWSER_CDP_PORT="$PORT" LOCAL_BROWSER_PROXY_PORT="$PROXY_PORT" LOCAL_BROWSER_TOKEN_FILE="$TOKEN_FILE" \
        "$(command -v node)" "$ROOT_DIR/scripts/local-browser-proxy.mjs"
    else
      nohup env LOCAL_BROWSER_CDP_PORT="$PORT" LOCAL_BROWSER_PROXY_PORT="$PROXY_PORT" LOCAL_BROWSER_TOKEN_FILE="$TOKEN_FILE" \
        node "$ROOT_DIR/scripts/local-browser-proxy.mjs" </dev/null >>"$PROXY_LOG_FILE" 2>&1 &
      printf '%s' "$!" > "$PROXY_PID_FILE"
    fi
    for _ in $(seq 1 10); do proxy_ready && break; sleep 1; done
    proxy_ready || { printf '浏览器连接助手启动失败，请查看 %s\n' "$PROXY_LOG_FILE" >&2; exit 1; }
  fi
  printf '本地浏览器已就绪（专用资料目录：%s）\n' "$PROFILE_DIR"
}

stop_browser() {
  local file pid
  if [[ "$(uname -s)" == "Darwin" ]]; then launchctl remove "$PROXY_LAUNCHD_LABEL" >/dev/null 2>&1 || true; fi
  for file in "$PROXY_PID_FILE" "$PID_FILE"; do
    if [[ -s "$file" ]]; then
      pid="$(<"$file")"
      if kill -0 "$pid" 2>/dev/null; then kill "$pid"; fi
      rm -f "$file"
    fi
  done
  if chrome_ready && command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN | head -n 1 || true)"
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  fi
  printf '本地浏览器已停止。\n'
}

case "${1:-start}" in
  start) start_browser ;;
  stop) stop_browser ;;
  status) if proxy_ready; then printf '本地浏览器：ready\n'; else printf '本地浏览器：stopped\n'; exit 1; fi ;;
  *) printf '用法：./local-browser.sh {start|stop|status}\n' >&2; exit 2 ;;
esac
