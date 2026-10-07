#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONFIG="$ROOT/cloudflare/wrangler.jsonc"
WORKER_URL=${SVD_CLOUDFLARE_APP_URL:-https://social-video-workbench.socialvideo.workers.dev}
KEY_FILE=${SVD_CF_SSH_KEY:-${HOME:?HOME is not set}/.ssh/social-video-workbench-cloudflare}
CONTAINER_NAME=social-video-workbench-workbenchcontainer

cd "$ROOT"

if ! command -v npx >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "需要先安装 Node.js/npm 和 curl。" >&2
  exit 1
fi

if [ ! -r "$KEY_FILE" ]; then
  echo "找不到 SSH 私钥：$KEY_FILE" >&2
  echo "设置 SVD_CF_SSH_KEY 后重试，或先生成与 Wrangler 配置中公钥匹配的 ed25519 密钥。" >&2
  exit 1
fi

if [ ! -r "$KEY_FILE.pub" ]; then
  echo "找不到公钥文件：$KEY_FILE.pub" >&2
  exit 1
fi

PUBLIC_KEY=$(awk '{ print $1 " " $2 }' "$KEY_FILE.pub")
if ! grep -Fq "$PUBLIC_KEY" "$CONFIG"; then
  echo "本机公钥与 cloudflare/wrangler.jsonc 中的 authorized_keys 不匹配。" >&2
  echo "请将 $KEY_FILE.pub 对应的公钥加入该容器配置，并先部署配置。" >&2
  exit 1
fi

echo "查找 Cloudflare 容器……"
if ! CONTAINERS_JSON=$(npx wrangler containers list --json --config "$CONFIG"); then
  echo "读取容器列表失败。请检查 Wrangler 登录状态和 Cloudflare API 权限。" >&2
  exit 1
fi

CONTAINER_ID=$(printf '%s' "$CONTAINERS_JSON" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const containers = JSON.parse(input);
  const found = containers.find(item => item.name === "social-video-workbench-workbenchcontainer");
  if (!found) process.exit(1);
  process.stdout.write(found.id);
});
') || {
  echo "没有找到容器 $CONTAINER_NAME。请先成功部署 Cloudflare 配置。" >&2
  exit 1
}

get_running_instance() {
  INSTANCES_JSON=$(npx wrangler containers instances "$CONTAINER_ID" --json --config "$CONFIG") || return 1
  printf '%s' "$INSTANCES_JSON" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const instances = JSON.parse(input);
  const found = instances.find(item => item.name === "primary" && item.state === "running")
    || instances.find(item => item.state === "running");
  if (!found) process.exit(1);
  process.stdout.write(found.id);
});
'
}

if ! INSTANCE_ID=$(get_running_instance); then
  echo "容器当前未运行，尝试通过健康检查唤醒……"
  if ! curl --silent --show-error --fail --max-time 180 "$WORKER_URL/api/health" >/dev/null; then
    echo "唤醒请求失败。请确认应用地址可访问，且 SSH 配置已成功部署。" >&2
    exit 1
  fi

  attempt=0
  while [ "$attempt" -lt 24 ]; do
    if INSTANCE_ID=$(get_running_instance); then
      break
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
fi

if [ -z "${INSTANCE_ID:-}" ]; then
  echo "容器未在 2 分钟内进入运行状态。" >&2
  exit 1
fi

echo "连接实例 $INSTANCE_ID……"
exec npx wrangler containers ssh "$INSTANCE_ID" --identity-file "$KEY_FILE" --config "$CONFIG" -t
