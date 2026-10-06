#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${LOCAL_FILE_ACTIONS_PORT:-9333}"
PID_FILE="$ROOT_DIR/config/local-file-actions.pid"
TOKEN_FILE="$ROOT_DIR/config/local-file-actions.token"
LOG_FILE="$ROOT_DIR/config/local-file-actions.log"
LAUNCHD_LABEL="com.social-video-workbench.local-file-actions"

random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

helper_ready() {
  [[ -s "$TOKEN_FILE" ]] && curl -fsS --max-time 2 -H "Authorization: Bearer $(<"$TOKEN_FILE")" "http://127.0.0.1:${PORT}/capabilities" >/dev/null 2>&1
}

start_helper() {
  mkdir -p "$ROOT_DIR/config" "$ROOT_DIR/downloads" "$ROOT_DIR/imports"
  command -v node >/dev/null 2>&1 || { printf '未找到本机 Node.js，无法打开目录或使用 AirDrop。\n' >&2; exit 1; }
  if [[ ! -s "$TOKEN_FILE" ]]; then
    umask 077
    random_secret > "$TOKEN_FILE"
  fi
  chmod 600 "$TOKEN_FILE"
  if helper_ready; then
    printf '本地文件助手已就绪。\n'
    return
  fi
  local node_bin
  node_bin="$(command -v node)"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    launchctl remove "$LAUNCHD_LABEL" >/dev/null 2>&1 || true
    launchctl submit -l "$LAUNCHD_LABEL" -o "$LOG_FILE" -e "$LOG_FILE" -- \
      /usr/bin/env LOCAL_FILE_ACTIONS_PORT="$PORT" LOCAL_FILE_ACTIONS_TOKEN_FILE="$TOKEN_FILE" \
      LOCAL_FILE_ACTIONS_DOWNLOADS="$ROOT_DIR/downloads" LOCAL_FILE_ACTIONS_IMPORTS="$ROOT_DIR/imports" \
      "$node_bin" "$ROOT_DIR/scripts/local-file-actions.mjs"
  else
    nohup env LOCAL_FILE_ACTIONS_PORT="$PORT" LOCAL_FILE_ACTIONS_TOKEN_FILE="$TOKEN_FILE" \
      LOCAL_FILE_ACTIONS_DOWNLOADS="$ROOT_DIR/downloads" LOCAL_FILE_ACTIONS_IMPORTS="$ROOT_DIR/imports" \
      node "$ROOT_DIR/scripts/local-file-actions.mjs" </dev/null >>"$LOG_FILE" 2>&1 &
    printf '%s' "$!" > "$PID_FILE"
  fi
  local _attempt
  for _attempt in $(seq 1 10); do helper_ready && break; sleep 0.3; done
  helper_ready || { printf '本地文件助手启动失败，请查看 %s\n' "$LOG_FILE" >&2; exit 1; }
  printf '本地文件助手已就绪。\n'
}

stop_helper() {
  if [[ "$(uname -s)" == "Darwin" ]]; then launchctl remove "$LAUNCHD_LABEL" >/dev/null 2>&1 || true; fi
  if [[ -s "$PID_FILE" ]]; then
    local pid
    pid="$(<"$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" || true; fi
    rm -f "$PID_FILE"
  fi
  if command -v lsof >/dev/null 2>&1; then
    local pid
    pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN | head -n 1 || true)"
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  fi
  printf '本地文件助手已停止。\n'
}

case "${1:-start}" in
  start) start_helper ;;
  stop) stop_helper ;;
  restart) stop_helper; start_helper ;;
  status) if helper_ready; then printf '本地文件助手：ready\n'; else printf '本地文件助手：stopped\n'; exit 1; fi ;;
  *) printf '用法：./local-files.sh {start|stop|restart|status}\n' >&2; exit 2 ;;
esac
