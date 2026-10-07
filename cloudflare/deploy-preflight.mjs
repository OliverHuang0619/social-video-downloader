import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = process.argv[2] || path.join(root, 'cloudflare/wrangler.jsonc')
const secretsPath = path.join(root, 'cloudflare/.secrets.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const database = config.d1_databases?.find(binding => binding.binding === 'DB')
if (!database?.database_id || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(database.database_id) || /^0+$/.test(database.database_id.replaceAll('-', ''))) {
  console.error('请先将 cloudflare/wrangler.jsonc 中 DB 的 database_id 替换为已创建的 D1 数据库 ID。')
  process.exit(1)
}

const cli = path.join(root, 'node_modules/wrangler/wrangler-dist/cli.js')
const auth = spawnSync(process.execPath, [cli, 'whoami', '--json', '--config', configPath], { cwd: root, encoding: 'utf8', timeout: 10_000 })
const authOutput = `${auth.stdout || ''}\n${auth.stderr || ''}`
let loggedIn = false
try { loggedIn = Boolean(JSON.parse(authOutput.match(/\{[\s\S]*\}/)?.[0] || '{}').loggedIn) } catch { /* Report a stable setup hint below. */ }
if (!loggedIn) {
  console.error('Cloudflare 未登录或 Wrangler 无法验证登录状态。请先运行 npx wrangler login。')
  process.exit(1)
}

const docker = spawnSync('docker', ['info'], { cwd: root, stdio: 'ignore', timeout: 20_000 })
if (docker.status !== 0) {
  console.error('Cloudflare Containers 构建需要已启动的 Docker。')
  process.exit(1)
}

const required = ['ADMIN_PASSWORD', 'SESSION_SECRET', 'SVD_CF_BRIDGE_TOKEN', 'SVD_INTERNAL_SCHEDULER_TOKEN', 'SVD_VAPID_PUBLIC_KEY', 'SVD_VAPID_PRIVATE_KEY', 'SVD_DATA_ENCRYPTION_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
const hasBootstrapSecrets = fs.existsSync(secretsPath)
let bootstrapValues
if (hasBootstrapSecrets) {
  const stat = fs.statSync(secretsPath)
  if ((stat.mode & 0o077) !== 0) {
    console.error('cloudflare/.secrets.json 权限过宽；请运行 chmod 600 cloudflare/.secrets.json。')
    process.exit(1)
  }
  try { bootstrapValues = JSON.parse(fs.readFileSync(secretsPath, 'utf8')) } catch { /* Report an incomplete bootstrap file below. */ }
  const missing = required.filter(name => typeof bootstrapValues?.[name] !== 'string' || !bootstrapValues[name])
  if (missing.length) {
    console.error(`cloudflare/.secrets.json 缺少密钥：${missing.join(', ')}。请重新运行 ./cloudflare/set-secrets.sh。`)
    process.exit(1)
  }
}

const secrets = spawnSync(process.execPath, [cli, 'secret', 'list', '--format', 'json', '--config', configPath], { cwd: root, encoding: 'utf8', timeout: 30_000 })
let entries
try { entries = JSON.parse(secrets.stdout || '') } catch { /* A new Worker has no secrets list yet. */ }
const secretListOutput = `${secrets.stdout || ''}\n${secrets.stderr || ''}`
const firstDeployment = !Array.isArray(entries) && /Worker .+ not found/i.test(secretListOutput)
if (!Array.isArray(entries) && !(hasBootstrapSecrets && firstDeployment)) {
  console.error('无法读取 Cloudflare Worker Secrets。请检查 Worker 是否已部署、账号权限和网络连接。')
  process.exit(1)
}

const present = new Set((entries || []).map(entry => entry.name))
if (hasBootstrapSecrets && !firstDeployment) {
  // Preserve existing encryption, session, and VAPID keys if setup is rerun.
  const missingValues = Object.fromEntries(required.filter(name => !present.has(name)).map(name => [name, bootstrapValues[name]]))
  if (Object.keys(missingValues).length) fs.writeFileSync(secretsPath, JSON.stringify(missingValues), { mode: 0o600 })
  else fs.unlinkSync(secretsPath)
}
if (!hasBootstrapSecrets) {
  const missing = required.filter(name => !present.has(name))
  if (missing.length) {
    console.error(`Cloudflare Worker 缺少 Secrets：${missing.join(', ')}。请在 Dashboard 或使用 wrangler secret put 单独补齐后再部署。`)
    process.exit(1)
  }
}
