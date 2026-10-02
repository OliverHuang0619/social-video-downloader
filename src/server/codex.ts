import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CodexStatus } from '../shared/types'

function run(command: string, args: string[], environment: NodeJS.ProcessEnv, timeout = 15_000) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(command, args, { env: environment, windowsHide: true }); let output = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout)
    child.stdout.on('data', value => output = `${output}${value}`.slice(-20_000)); child.stderr.on('data', value => output = `${output}${value}`.slice(-20_000))
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, output: error.message }) })
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }) })
  })
}

export class CodexService {
  readonly command = process.env.SVD_CODEX_BIN || 'codex'
  readonly home = path.join(process.env.SVD_CONFIG_DIR || '/config', 'codex-home')
  private loginProcess?: ChildProcessWithoutNullStreams
  private loginOutput = ''
  constructor(private changed: () => void) {}
  environment() { return { ...process.env, HOME: this.home, CODEX_HOME: path.join(this.home, '.codex') } }
  async initialize() {
    await mkdir(path.join(this.home, '.codex'), { recursive: true })
    const config = path.join(this.home, '.codex', 'config.toml')
    const current = await readFile(config, 'utf8').catch(() => '')
    if (!current.includes('cli_auth_credentials_store')) await writeFile(config, `${current}${current && !current.endsWith('\n') ? '\n' : ''}cli_auth_credentials_store = "file"\n`)
  }
  async status(): Promise<CodexStatus> {
    const version = await run(this.command, ['--version'], this.environment())
    if (version.code !== 0) return { available: false, authenticated: false, busy: Boolean(this.loginProcess), message: '未找到可用的 Codex CLI' }
    const login = await run(this.command, ['login', 'status'], this.environment())
    return { available: true, authenticated: login.code === 0, busy: Boolean(this.loginProcess), message: login.code === 0 ? login.output.trim() || 'Codex 已登录' : 'Codex 尚未登录', loginOutput: this.loginOutput || undefined }
  }
  login() {
    if (this.loginProcess) return
    this.loginOutput = '正在启动设备代码登录…'
    const child = spawn(this.command, ['login', '--device-auth'], { env: this.environment(), windowsHide: true })
    this.loginProcess = child
    const append = (value: Buffer) => { this.loginOutput = `${this.loginOutput}\n${value.toString()}`.slice(-20_000); this.changed() }
    child.stdout.on('data', append); child.stderr.on('data', append)
    child.on('error', error => { this.loginOutput = error.message; this.loginProcess = undefined; this.changed() })
    child.on('close', code => { this.loginOutput = code === 0 ? `${this.loginOutput}\n登录完成` : `${this.loginOutput}\n登录失败 (${code})`; this.loginProcess = undefined; this.changed() })
    this.changed()
  }
  cancelLogin() { this.loginProcess?.kill('SIGTERM'); this.loginProcess = undefined; this.changed() }
  async logout() { this.cancelLogin(); await run(this.command, ['logout'], this.environment()); this.loginOutput = ''; this.changed() }
}
