import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CodexStatus, CodexUsageStatus, CodexUsageWindow } from '../shared/types'

export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol'
export const DEFAULT_CODEX_REASONING_EFFORT = 'medium'

export function resolveCodexAnalysisConfig(environment: NodeJS.ProcessEnv = process.env) {
  return {
    model: environment.SVD_CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL,
    reasoningEffort: environment.SVD_CODEX_REASONING_EFFORT?.trim().toLowerCase() || DEFAULT_CODEX_REASONING_EFFORT,
  }
}

const ANSI_OSC = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g
const ANSI_CSI = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export function cleanCodexOutput(value: string) {
  return value.replace(ANSI_OSC, '').replace(ANSI_CSI, '').replace(/\r/g, '').replace(CONTROL_CHARACTERS, '').trim()
}

export function parseCodexLoginOutput(value: string) {
  const output = cleanCodexOutput(value)
  const loginUrl = output.match(/https:\/\/auth\.openai\.com\/codex\/device(?:\?[^\s]*)?/i)?.[0]
  const loginCode = output.match(/(?:one-time|device) code[^\n]*\n\s*([A-Z0-9]{4,8}-[A-Z0-9]{4,8})/i)?.[1]
    || output.match(/\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/)?.[1]
  return { output, loginUrl, loginCode }
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv, timeout = 15_000) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(command, args, { env: environment, windowsHide: true }); let output = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout)
    child.stdout.on('data', value => output = `${output}${value}`.slice(-20_000)); child.stderr.on('data', value => output = `${output}${value}`.slice(-20_000))
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, output: error.message }) })
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }) })
  })
}

type RateLimitWindow = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown }
type RateLimitSnapshot = { limitId?: unknown; limitName?: unknown; planType?: unknown; primary?: RateLimitWindow | null; secondary?: RateLimitWindow | null }

function usageWindow(value?: RateLimitWindow | null): CodexUsageWindow | undefined {
  if (!value || !Number.isFinite(Number(value.usedPercent))) return undefined
  const usedPercent = Math.min(100, Math.max(0, Math.round(Number(value.usedPercent))))
  return { usedPercent, remainingPercent: 100 - usedPercent, windowDurationMins: Number.isFinite(Number(value.windowDurationMins)) ? Number(value.windowDurationMins) : undefined, resetsAt: Number.isFinite(Number(value.resetsAt)) ? Number(value.resetsAt) : undefined }
}

export function parseCodexRateLimits(value: unknown): CodexUsageStatus | undefined {
  if (!value || typeof value !== 'object') return undefined
  const response = value as { ordinaryUsageAllowed?: unknown; rateLimits?: RateLimitSnapshot; rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null }
  const entries = response.rateLimitsByLimitId && Object.keys(response.rateLimitsByLimitId).length ? Object.entries(response.rateLimitsByLimitId) : response.rateLimits ? [[String(response.rateLimits.limitId || 'codex'), response.rateLimits] as const] : []
  const limits = entries.map(([key, limit]) => ({ id: String(limit.limitId || key), name: limit.limitName ? String(limit.limitName) : undefined, primary: usageWindow(limit.primary), secondary: usageWindow(limit.secondary) }))
  if (!limits.length) return undefined
  const planType = (entries[0]?.[1] as RateLimitSnapshot | undefined)?.planType
  return { planType: planType ? String(planType) : undefined, ordinaryUsageAllowed: typeof response.ordinaryUsageAllowed === 'boolean' ? response.ordinaryUsageAllowed : undefined, limits }
}

function readCodexRateLimits(command: string, environment: NodeJS.ProcessEnv, timeout = 15_000) {
  return new Promise<CodexUsageStatus | undefined>((resolve) => {
    const child = spawn(command, ['app-server', '--listen', 'stdio://'], { env: environment, windowsHide: true })
    let buffer = '', settled = false
    const finish = (value?: CodexUsageStatus) => { if (settled) return; settled = true; clearTimeout(timer); child.stdin.end(); child.kill('SIGTERM'); resolve(value) }
    const timer = setTimeout(() => finish(), timeout)
    child.on('error', () => finish()); child.on('close', () => finish())
    child.stderr.on('data', () => undefined)
    child.stdout.on('data', chunk => {
      buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''
      for (const line of lines) {
        let message: { id?: number; result?: unknown; error?: unknown }
        try { message = JSON.parse(line) as typeof message } catch { continue }
        if (message.id === 1 && message.result) {
          child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
          child.stdin.write(`${JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } })}\n`)
        }
        if (message.id === 2) finish(message.error ? undefined : parseCodexRateLimits(message.result))
      }
    })
    child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'social-video-workbench', title: 'Social Video Workbench', version: '1.1.0' }, capabilities: { experimentalApi: true } } })}\n`)
  })
}

export class CodexService {
  readonly command = process.env.SVD_CODEX_BIN || 'codex'
  readonly home = path.join(process.env.SVD_CONFIG_DIR || '/config', 'codex-home')
  readonly analysisConfig = resolveCodexAnalysisConfig()
  private loginProcess?: ChildProcessWithoutNullStreams
  private loginOutput = ''
  private usageCache?: { expiresAt: number; value?: CodexUsageStatus }
  constructor(private changed: () => void) {}
  environment() { return { ...process.env, HOME: this.home, CODEX_HOME: path.join(this.home, '.codex') } }
  analysisArguments(outputDirectory: string, prompt: string) {
    return ['--model', this.analysisConfig.model, '--config', `model_reasoning_effort=${JSON.stringify(this.analysisConfig.reasoningEffort)}`, '--ask-for-approval', 'never', '--sandbox', 'danger-full-access', '--cd', outputDirectory, 'exec', '--json', '--ephemeral', '--skip-git-repo-check', prompt]
  }
  async initialize() {
    await mkdir(path.join(this.home, '.codex'), { recursive: true })
    const config = path.join(this.home, '.codex', 'config.toml')
    const current = await readFile(config, 'utf8').catch(() => '')
    if (!current.includes('cli_auth_credentials_store')) await writeFile(config, `${current}${current && !current.endsWith('\n') ? '\n' : ''}cli_auth_credentials_store = "file"\n`)
  }
  async status(): Promise<CodexStatus> {
    const environment = this.environment()
    const [version, login] = await Promise.all([run(this.command, ['--version'], environment), run(this.command, ['login', 'status'], environment)])
    const base = { model: this.analysisConfig.model, reasoningEffort: this.analysisConfig.reasoningEffort }
    if (version.code !== 0) return { ...base, available: false, authenticated: false, busy: Boolean(this.loginProcess), message: '未找到可用的 Codex CLI' }
    const loginDetails = parseCodexLoginOutput(this.loginOutput)
    let usage: CodexUsageStatus | undefined
    if (login.code === 0) {
      if (!this.usageCache || this.usageCache.expiresAt <= Date.now()) this.usageCache = { value: await readCodexRateLimits(this.command, environment), expiresAt: Date.now() + 60_000 }
      usage = this.usageCache.value
    }
    return { ...base, available: true, authenticated: login.code === 0, busy: Boolean(this.loginProcess), message: login.code === 0 ? cleanCodexOutput(login.output) || 'Codex 已登录' : 'Codex 尚未登录', usage, usageUnavailable: login.code === 0 && !usage, loginOutput: loginDetails.output || undefined, loginUrl: loginDetails.loginUrl, loginCode: loginDetails.loginCode }
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
  async logout() { this.cancelLogin(); await run(this.command, ['logout'], this.environment()); this.loginOutput = ''; this.usageCache = undefined; this.changed() }
}
