import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = process.argv[2] || path.join(root, 'cloudflare/wrangler.jsonc')
const cli = path.join(root, 'node_modules/wrangler/wrangler-dist/cli.js')
const result = spawnSync(process.execPath, [cli, 'whoami', '--json', '--config', config], {
  cwd: root, encoding: 'utf8', timeout: 10_000,
})
const output = `${result.stdout || ''}\n${result.stderr || ''}`
const json = output.match(/\{[\s\S]*\}/)
let loggedIn = false
try { loggedIn = Boolean(json && JSON.parse(json[0]).loggedIn) } catch { /* Report a stable setup hint below. */ }
if (!loggedIn) {
  console.error('Cloudflare 未登录或 Wrangler 无法验证登录状态。请先运行 npx wrangler login。')
  if (result.error && result.error.code !== 'ETIMEDOUT') console.error(result.error.message)
  process.exit(1)
}
