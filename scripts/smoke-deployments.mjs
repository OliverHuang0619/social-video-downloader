import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverEntry = path.join(projectRoot, 'dist/server/index.js')
const smokeRoot = await mkdtemp(path.join(os.tmpdir(), 'svw-deployment-smoke-'))
const password = 'Smoke-test-password-2026'

async function freePort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve))
  const address = listener.address()
  assert(address && typeof address !== 'string')
  await new Promise(resolve => listener.close(resolve))
  return address.port
}

async function waitForServer(child, baseUrl, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`服务在启动时退出：${logs.join('').slice(-4000)}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch { /* The listener is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`等待服务启动超时：${logs.join('').slice(-4000)}`)
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  let timeout
  try {
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('服务未能正常停止')), 5000) }),
    ])
  } finally { clearTimeout(timeout) }
}

async function smoke(runtime) {
  const directory = path.join(smokeRoot, runtime)
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const logs = []
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SVD_RUNTIME: runtime,
    SVD_CONFIG_DIR: path.join(directory, 'config'),
    SVD_OUTPUT_DIR: path.join(directory, 'downloads'),
    SVD_IMPORT_DIR: path.join(directory, 'imports'),
    PORT: String(port),
    HOST: '127.0.0.1',
    ADMIN_PASSWORD: password,
    SESSION_SECRET: `smoke-${runtime}-session-secret-32chars`,
    SVD_SECURE_COOKIE: '',
  }
  delete env.SVD_CLOUDFLARE_RUNTIME
  const start = () => {
    const serverProcess = spawn(process.execPath, [serverEntry], { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    serverProcess.stdout.on('data', chunk => logs.push(String(chunk)))
    serverProcess.stderr.on('data', chunk => logs.push(String(chunk)))
    return serverProcess
  }
  let child = start()
  try {
    await waitForServer(child, baseUrl, logs)
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
    })
    assert.equal(login.status, 200)
    const auth = await login.json()
    const cookie = login.headers.getSetCookie()[0].split(';')[0]
    const headers = { cookie, 'x-csrf-token': auth.csrfToken, 'content-type': 'application/json' }

    const schedule = await fetch(`${baseUrl}/api/subscriptions/schedule`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ enabled: false, hour: 8, minute: 45, timeZone: 'America/Los_Angeles' }),
    })
    assert.equal(schedule.status, 200)
    assert.equal((await schedule.json()).timeZone, 'America/Los_Angeles')
    assert.equal((await (await fetch(`${baseUrl}/api/subscriptions/schedule`, { headers: { cookie } })).json()).timeZone, 'America/Los_Angeles')

    const publicKey = await fetch(`${baseUrl}/api/push/public-key`, { headers: { cookie } })
    assert.equal(publicKey.status, 200)
    assert.ok((await publicKey.json()).publicKey.length > 30)
    const registered = await fetch(`${baseUrl}/api/push/devices`, {
      method: 'POST', headers,
      body: JSON.stringify({ endpoint: `https://push.example.test/${runtime}`, keys: { p256dh: 'smoke-p256dh', auth: 'smoke-auth' }, label: 'Smoke browser' }),
    })
    assert.equal(registered.status, 201)
    const { id } = await registered.json()
    const listed = await fetch(`${baseUrl}/api/push/devices`, { headers: { cookie } })
    assert.ok((await listed.json()).some(device => device.id === id))

    await stop(child)
    child = start()
    await waitForServer(child, baseUrl, logs)
    const restoredSchedule = await fetch(`${baseUrl}/api/subscriptions/schedule`, { headers: { cookie } })
    assert.equal((await restoredSchedule.json()).timeZone, 'America/Los_Angeles')
    const restoredDevices = await fetch(`${baseUrl}/api/push/devices`, { headers: { cookie } })
    assert.ok((await restoredDevices.json()).some(device => device.id === id))

    const revoked = await fetch(`${baseUrl}/api/push/devices/${id}`, { method: 'DELETE', headers })
    assert.equal((await revoked.json()).removed, true)
    assert.equal((await (await fetch(`${baseUrl}/api/push/devices`, { headers: { cookie } })).json()).length, 0)
    const capabilities = await fetch(`${baseUrl}/api/library/local-actions`, { headers: { cookie } })
    assert.equal((await capabilities.json()).upload, false)
    console.log(`${runtime}: health, login, IANA timezone persistence, Push register/list/revoke passed`)
  } finally {
    await stop(child)
  }
}

try {
  await smoke('local')
  await smoke('docker')
} finally {
  await rm(smokeRoot, { recursive: true, force: true })
}
