#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Social Video 工作台部署脚本

用法：
  ./deploy.sh deploy     正常构建并启动服务
  ./deploy.sh redeploy   无缓存重建并强制重新创建容器
  ./deploy.sh deploy-local    使用本地 Chrome 构建并启动
  ./deploy.sh redeploy-local  使用本地 Chrome 无缓存重新部署
  ./deploy.sh status     查看服务状态
  ./deploy.sh logs       持续查看服务日志

可选环境变量：
  BIND_ADDRESS           监听地址，默认 127.0.0.1
  PORT                   监听端口，默认 3000
  SVD_SECURE_COOKIE      HTTPS 反向代理后设为 true
  SVD_ADMIN_PASSWORD     首次部署时使用的管理员密码；未设置则交互输入
  SVD_CODEX_MODEL        视频分析模型，默认 gpt-5.6-sol
  SVD_CODEX_REASONING_EFFORT 视频分析推理强度，默认 medium
  DEPLOY_HEALTH_TIMEOUT  健康检查等待秒数，默认 240
  LOCAL_BROWSER_BIN      本地 Chrome/Chromium 可执行文件路径
  LOCAL_BROWSER_CDP_PORT 本地 Chrome 调试端口，默认 9222
  LOCAL_BROWSER_PROXY_PORT 容器连接助手端口，默认 9223
  LOCAL_FILE_ACTIONS_PORT 本地文件助手端口，默认 9333
EOF
}

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m错误：%s\033[0m\n' "$*" >&2; exit 1; }
compose() { docker compose -f "$ROOT_DIR/compose.yaml" "$@"; }

require_tools() {
  command -v docker >/dev/null 2>&1 || fail '未找到 Docker，请先安装 Docker。'
  docker compose version >/dev/null 2>&1 || fail '需要 Docker Compose v2（docker compose）。'
  docker info >/dev/null 2>&1 || fail 'Docker 服务未运行，或当前用户无权访问 Docker。'
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

read_admin_password() {
  local first second
  if [[ -n "${SVD_ADMIN_PASSWORD:-}" ]]; then
    first="$SVD_ADMIN_PASSWORD"
  elif [[ -t 0 ]]; then
    read -r -s -p '首次部署，请设置管理员密码：' first
    printf '\n' >&2
    read -r -s -p '请再次输入管理员密码：' second
    printf '\n' >&2
    [[ "$first" == "$second" ]] || fail '两次输入的密码不一致。'
  else
    fail '缺少 config/admin_password。请设置 SVD_ADMIN_PASSWORD 后重试。'
  fi
  [[ ${#first} -ge 10 ]] || fail '管理员密码至少需要 10 个字符。'
  printf '%s' "$first"
}

prepare_storage() {
  log '检查持久目录和密钥'
  mkdir -p downloads imports config config/douyin-profile
  chmod 700 config
  if [[ ! -s config/admin_password ]]; then
    umask 077
    read_admin_password > config/admin_password
    printf '\n已创建 config/admin_password\n'
  fi
  if [[ ! -s config/session_secret ]]; then
    umask 077
    random_secret > config/session_secret
    printf '已创建 config/session_secret\n'
  fi
  chmod 600 config/admin_password config/session_secret
}

service_state() {
  local service="$1" container
  container="$(compose ps --all -q "$service")"
  [[ -n "$container" ]] || { printf 'missing'; return; }
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || printf 'missing'
}

wait_for_services() {
  local timeout="${DEPLOY_HEALTH_TIMEOUT:-240}" deadline state service
  [[ "$timeout" =~ ^[0-9]+$ ]] || fail 'DEPLOY_HEALTH_TIMEOUT 必须是整数秒数。'
  log "等待服务健康检查（最多 ${timeout} 秒）"
  for service in "$@"; do
    deadline=$((SECONDS + timeout))
    while (( SECONDS < deadline )); do
      state="$(service_state "$service")"
      case "$state" in
        healthy|running) printf '%s: %s\n' "$service" "$state"; break ;;
        unhealthy|exited|dead)
          compose logs --tail=120 "$service" >&2 || true
          fail "$service 状态异常：$state"
          ;;
        *) sleep 3 ;;
      esac
    done
    state="$(service_state "$service")"
    if [[ "$state" != healthy && "$state" != running ]]; then
      compose logs --tail=120 "$service" >&2 || true
      fail "$service 未在规定时间内就绪，当前状态：$state"
    fi
  done
}

show_result() {
  local address="${BIND_ADDRESS:-127.0.0.1}" port="${PORT:-3000}"
  compose ps
  if [[ "$address" == '0.0.0.0' ]]; then address='<服务器IP>'; fi
  printf '\n部署完成：%s\n' "http://${address}:${port}"
}

deploy() {
  require_tools
  prepare_storage
  refresh_local_files
  log '构建并启动服务'
  compose up -d --build --remove-orphans app browser
  wait_for_services browser app
  show_result
}

redeploy() {
  require_tools
  prepare_storage
  refresh_local_files
  log '拉取基础镜像并无缓存重建'
  compose build --pull --no-cache app browser
  log '强制重新创建容器'
  compose up -d --force-recreate --remove-orphans app browser
  wait_for_services browser app
  show_result
}

refresh_local_files() {
  if [[ "$(uname -s)" != "Darwin" && -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    return
  fi
  log '启动本地文件助手'
  "$ROOT_DIR/local-files.sh" restart || printf '媒体库将不提供打开目录或 AirDrop。\n' >&2
}

configure_local_browser() {
  "$ROOT_DIR/local-browser.sh" start
  export SVD_BROWSER_MODE=host
  export SVD_BROWSER_CDP="http://host.docker.internal:${LOCAL_BROWSER_PROXY_PORT:-9223}"
  compose stop browser >/dev/null 2>&1 || true
}

deploy_local() {
  require_tools
  prepare_storage
  refresh_local_files
  configure_local_browser
  log '使用本地浏览器构建并启动 App'
  compose up -d --build --no-deps --remove-orphans app
  wait_for_services app
  show_result
}

redeploy_local() {
  require_tools
  prepare_storage
  refresh_local_files
  configure_local_browser
  log '使用本地浏览器无缓存重建 App'
  compose build --pull --no-cache app
  compose up -d --force-recreate --no-deps --remove-orphans app
  wait_for_services app
  show_result
}

case "${1:-}" in
  deploy) deploy ;;
  redeploy) redeploy ;;
  deploy-local) deploy_local ;;
  redeploy-local) redeploy_local ;;
  status) require_tools; compose ps; "$ROOT_DIR/local-browser.sh" status || true; "$ROOT_DIR/local-files.sh" status || true ;;
  logs) require_tools; compose logs -f --tail=200 ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
