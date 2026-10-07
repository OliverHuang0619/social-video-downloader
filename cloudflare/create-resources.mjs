import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(root, 'cloudflare/wrangler.jsonc')
const cli = path.join(root, 'node_modules/wrangler/wrangler-dist/cli.js')

const auth = spawnSync(process.execPath, [path.join(root, 'cloudflare/auth-check.mjs'), configPath], { cwd: root, encoding: 'utf8', timeout: 15_000 })
if (auth.status !== 0) {
  if (auth.stdout) process.stdout.write(auth.stdout)
  if (auth.stderr) process.stderr.write(auth.stderr)
  process.exit(auth.status || 1)
}

function run(args, { timeout = 45_000, acceptOutputOnTimeout = false } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args, '--config', configPath], {
    cwd: root, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.error?.code === 'ETIMEDOUT' && !acceptOutputOnTimeout) throw new Error(`Wrangler 命令超时：${args.join(' ')}`)
  if (result.status !== 0 && !(acceptOutputOnTimeout && result.error?.code === 'ETIMEDOUT')) {
    throw new Error(output.trim() || `Wrangler 命令失败：${args.join(' ')}`)
  }
  return output
}

function jsonFrom(output) {
  const start = output.indexOf('[')
  const end = output.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('Wrangler 没有返回有效的资源 JSON。')
  return JSON.parse(output.slice(start, end + 1))
}

function readConfig() { return JSON.parse(fs.readFileSync(configPath, 'utf8')) }

function patchDatabaseId(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || /^0+$/.test(id.replaceAll('-', ''))) throw new Error(`D1 返回了无效 database_id：${id}`)
  const source = fs.readFileSync(configPath, 'utf8')
  const bindingPattern = /("binding"\s*:\s*"DB"[\s\S]*?"database_id"\s*:\s*")[^"]*(")/
  if (!bindingPattern.test(source)) throw new Error('无法在 Wrangler 配置中定位 DB.database_id。')
  fs.writeFileSync(configPath, source.replace(bindingPattern, `$1${id}$2`))
}

function d1Databases() {
  return jsonFrom(run(['d1', 'list', '--json'], { acceptOutputOnTimeout: true }))
}

function r2Buckets() {
  const output = run(['r2', 'bucket', 'list']).replace(/\u001b\[[0-9;]*m/g, '')
  return [...output.matchAll(/(?:^|\n)\s*name:\s*([^\s]+)/g)].map(match => match[1])
}

function queueNames() {
  const output = run(['queues', 'list']).replace(/\u001b\[[0-9;]*m/g, '')
  const names = []
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('|')) continue
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    if (cells.length < 2 || cells[0] === 'id' || cells[0].startsWith('─')) continue
    names.push(cells[1])
  }
  return names
}

function createIfMissing(name, list, createArgs, label) {
  if (list().includes(name)) {
    console.log(`${label} ${name} 已存在，复用。`)
    return
  }
  try {
    run(createArgs)
    console.log(`${label} ${name} 已创建。`)
  } catch (error) {
    // A concurrent setup may have created it after the list call.
    if (!list().includes(name)) throw error
    console.log(`${label} ${name} 已由另一部署创建，复用。`)
  }
}

let config = readConfig()
const databaseBinding = config.d1_databases?.find(binding => binding.binding === 'DB')
if (!databaseBinding) throw new Error('Wrangler 配置缺少 DB D1 binding。')
let database = d1Databases().find(item => item.name === databaseBinding.database_name)
if (!database) {
  console.log(`创建 D1 ${databaseBinding.database_name}...`)
  run(['d1', 'create', databaseBinding.database_name, '--binding', 'DB', '--update-config'])
  config = readConfig()
  database = d1Databases().find(item => item.name === databaseBinding.database_name)
}
if (!database?.uuid) throw new Error(`D1 数据库 ${databaseBinding.database_name} 已创建，但 Wrangler 没有返回它的 UUID。`)
patchDatabaseId(database.uuid)
console.log(`D1 ${databaseBinding.database_name} 已就绪，database_id 已写回 Wrangler 配置。`)

config = readConfig()
const mediaBinding = config.r2_buckets?.find(binding => binding.binding === 'MEDIA')
if (!mediaBinding) throw new Error('Wrangler 配置缺少 MEDIA R2 binding。')
createIfMissing(mediaBinding.bucket_name, r2Buckets, ['r2', 'bucket', 'create', mediaBinding.bucket_name, '--binding', 'MEDIA', '--update-config'], 'R2 bucket')

const queueBinding = config.queues?.producers?.find(binding => binding.binding === 'JOBS')
if (!queueBinding) throw new Error('Wrangler 配置缺少 JOBS Queue producer。')
createIfMissing(queueBinding.queue, queueNames, ['queues', 'create', queueBinding.queue], 'Queue')

console.log('D1、R2 和 Queue 资源已就绪。下一步运行 ./cloudflare/set-secrets.sh，再运行 npm run cloudflare:deploy。')
