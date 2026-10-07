#!/bin/sh
set -eu
set +x
umask 077

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SECRETS_FILE="$ROOT/cloudflare/.secrets.json"
cd "$ROOT"

if [ -e "$SECRETS_FILE" ]; then
  echo "已有待部署 Secrets 文件：${SECRETS_FILE}；请先部署或安全删除后再生成。" >&2
  exit 1
fi

if [ -n "${SVD_CF_ADMIN_PASSWORD:-}" ]; then
  ADMIN_PASSWORD=$SVD_CF_ADMIN_PASSWORD
else
  printf '设置工作台管理员密码: ' >&2
  stty -echo
  IFS= read -r ADMIN_PASSWORD
  stty echo
  printf '\n' >&2
fi
if [ "${#ADMIN_PASSWORD}" -lt 12 ]; then
  echo "管理员密码至少需要 12 个字符。" >&2
  exit 1
fi

SESSION_SECRET=$(openssl rand -hex 32)
BRIDGE_TOKEN=$(openssl rand -hex 32)
SCHEDULER_TOKEN=$(openssl rand -hex 32)
DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)
printf 'Cloudflare Account ID: ' >&2
IFS= read -r R2_ACCOUNT_ID
printf 'R2 API Access Key ID: ' >&2
stty -echo
IFS= read -r R2_ACCESS_KEY_ID
stty echo
printf '\nR2 API Secret Access Key: ' >&2
stty -echo
IFS= read -r R2_SECRET_ACCESS_KEY
stty echo
printf '\n' >&2
case "$R2_ACCOUNT_ID" in
  *[!a-fA-F0-9]*|'') echo "Account ID 必须是 32 位十六进制字符串。" >&2; exit 1 ;;
esac
if [ "${#R2_ACCOUNT_ID}" -ne 32 ] || [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then
  echo "R2 API 凭据不完整或 Account ID 长度无效。" >&2
  exit 1
fi

export SVD_CF_BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PASSWORD"
export SVD_CF_BOOTSTRAP_SESSION_SECRET="$SESSION_SECRET"
export SVD_CF_BOOTSTRAP_BRIDGE_TOKEN="$BRIDGE_TOKEN"
export SVD_CF_BOOTSTRAP_SCHEDULER_TOKEN="$SCHEDULER_TOKEN"
export SVD_CF_BOOTSTRAP_DATA_ENCRYPTION_KEY="$DATA_ENCRYPTION_KEY"
export SVD_CF_BOOTSTRAP_R2_ACCOUNT_ID="$R2_ACCOUNT_ID"
export SVD_CF_BOOTSTRAP_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export SVD_CF_BOOTSTRAP_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs'
import webpush from 'web-push'

const vapid = webpush.generateVAPIDKeys()
const values = {
  ADMIN_PASSWORD: process.env.SVD_CF_BOOTSTRAP_ADMIN_PASSWORD,
  SESSION_SECRET: process.env.SVD_CF_BOOTSTRAP_SESSION_SECRET,
  SVD_CF_BRIDGE_TOKEN: process.env.SVD_CF_BOOTSTRAP_BRIDGE_TOKEN,
  SVD_INTERNAL_SCHEDULER_TOKEN: process.env.SVD_CF_BOOTSTRAP_SCHEDULER_TOKEN,
  SVD_VAPID_PUBLIC_KEY: vapid.publicKey,
  SVD_VAPID_PRIVATE_KEY: vapid.privateKey,
  SVD_DATA_ENCRYPTION_KEY: process.env.SVD_CF_BOOTSTRAP_DATA_ENCRYPTION_KEY,
  R2_ACCOUNT_ID: process.env.SVD_CF_BOOTSTRAP_R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.SVD_CF_BOOTSTRAP_R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.SVD_CF_BOOTSTRAP_R2_SECRET_ACCESS_KEY,
}
if (Object.values(values).some(value => typeof value !== 'string' || !value)) throw new Error('Secrets 参数缺失')
writeFileSync('cloudflare/.secrets.json', JSON.stringify(values), { mode: 0o600, flag: 'wx' })
NODE

unset ADMIN_PASSWORD SESSION_SECRET BRIDGE_TOKEN SCHEDULER_TOKEN DATA_ENCRYPTION_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
unset SVD_CF_BOOTSTRAP_ADMIN_PASSWORD SVD_CF_BOOTSTRAP_SESSION_SECRET SVD_CF_BOOTSTRAP_BRIDGE_TOKEN
unset SVD_CF_BOOTSTRAP_SCHEDULER_TOKEN SVD_CF_BOOTSTRAP_DATA_ENCRYPTION_KEY SVD_CF_BOOTSTRAP_R2_ACCOUNT_ID
unset SVD_CF_BOOTSTRAP_R2_ACCESS_KEY_ID SVD_CF_BOOTSTRAP_R2_SECRET_ACCESS_KEY
echo "已在 cloudflare/.secrets.json 生成权限为 0600 的一次性部署密钥。运行 npm run cloudflare:deploy 上传；成功后部署脚本会删除此文件。"
