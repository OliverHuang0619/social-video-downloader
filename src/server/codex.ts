import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  CodexConnectionConfig,
  CodexConnectionPublic,
  CodexConnectionTestResult,
  CodexProvider,
  CodexStatus,
  CodexUsageStatus,
  CodexUsageWindow,
} from '../shared/types'
import {
  CodexConnectionStore,
  mergeProviderUpdate,
  modelsProbeUrl,
  removeLiveAuth,
  renderCodexToml,
  resolveActiveModel,
  restoreOfficialAuth,
  stashOfficialAuth,
  tencentTokenPlanTemplate,
  toPublicConnection,
} from './codex-connection'

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

async function probeModels(url: string, apiKey?: string): Promise<CodexConnectionTestResult> {
  if (!url) return { ok: false, message: '未配置探测地址' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey?.trim()) headers.authorization = `Bearer ${apiKey.trim()}`
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    if (response.ok) return { ok: true, message: `连通正常（HTTP ${response.status}）` }
    const body = await response.text().catch(() => '')
    const detail = body.trim().slice(0, 200)
    return { ok: false, message: `探测失败 HTTP ${response.status}${detail ? `：${detail}` : ''}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: message.includes('abort') ? '探测超时' : `探测失败：${message}` }
  } finally {
    clearTimeout(timer)
  }
}

export class CodexService {
  readonly command = process.env.SVD_CODEX_BIN || 'codex'
  readonly home = path.join(process.env.SVD_CONFIG_DIR || '/config', 'codex-home')
  readonly connection = new CodexConnectionStore(process.env.SVD_CONFIG_DIR || '/config')
  private loginProcess?: ChildProcessWithoutNullStreams
  private loginOutput = ''
  private usageCache?: { expiresAt: number; value?: CodexUsageStatus }
  private appliedMode = 'official' as CodexConnectionConfig['mode']
  constructor(private changed: () => void) {}

  get codexDir() { return path.join(this.home, '.codex') }
  get analysisConfig() { return resolveActiveModel(this.connection.get(), resolveCodexAnalysisConfig()) }
  environment() { return { ...process.env, HOME: this.home, CODEX_HOME: this.codexDir } }

  analysisArguments(outputDirectory: string, prompt: string) {
    const { model, reasoningEffort } = this.analysisConfig
    return ['--model', model, '--config', `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`, '--ask-for-approval', 'never', '--sandbox', 'danger-full-access', '--cd', outputDirectory, 'exec', '--json', '--ephemeral', '--skip-git-repo-check', prompt]
  }

  connectionPublic(): CodexConnectionPublic {
    return toPublicConnection(this.connection.get())
  }

  async initialize() {
    await mkdir(this.codexDir, { recursive: true })
    await this.connection.load()
    await this.applyConnection()
  }

  async applyConnection() {
    await mkdir(this.codexDir, { recursive: true })
    const config = this.connection.get()
    const runtime = resolveActiveModel(config, resolveCodexAnalysisConfig())
    const tomlPath = path.join(this.codexDir, 'config.toml')
    const previousToml = await readFile(tomlPath, 'utf8').catch(() => '')

    if (this.appliedMode === 'official' && config.mode !== 'official') {
      await stashOfficialAuth(this.codexDir)
      await removeLiveAuth(this.codexDir)
    }

    if (config.mode === 'provider') {
      const provider = config.providers.find(item => item.id === config.activeProviderId)
      if (!provider) throw Object.assign(new Error('请先选择可用的供应商'), { statusCode: 400 })
      if (!provider.apiKey.trim()) throw Object.assign(new Error('当前供应商尚未配置 API Key'), { statusCode: 400 })
      await writeFile(tomlPath, renderCodexToml({
        mode: 'provider',
        provider,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        previousToml,
      }))
    } else if (config.mode === 'cc_switch') {
      if (!config.ccSwitchBaseUrl.trim()) throw Object.assign(new Error('请填写 CC Switch 代理地址'), { statusCode: 400 })
      await writeFile(tomlPath, renderCodexToml({
        mode: 'cc_switch',
        ccSwitchBaseUrl: config.ccSwitchBaseUrl.trim(),
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        previousToml,
      }))
    } else {
      await writeFile(tomlPath, renderCodexToml({
        mode: 'official',
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        previousToml,
      }))
      await restoreOfficialAuth(this.codexDir)
    }

    this.appliedMode = config.mode
    this.usageCache = undefined
    this.changed()
  }

  async updateConnection(patch: Partial<CodexConnectionConfig>) {
    const current = this.connection.get()
    const next: CodexConnectionConfig = {
      ...current,
      ...patch,
      providers: current.providers,
      ccSwitchBaseUrl: patch.ccSwitchBaseUrl?.trim() || current.ccSwitchBaseUrl,
    }
    if (patch.mode === 'provider') {
      const activeId = patch.activeProviderId ?? current.activeProviderId
      const provider = current.providers.find(item => item.id === activeId)
      if (!provider) throw Object.assign(new Error('直连模式需要先选择供应商'), { statusCode: 400 })
      if (!provider.apiKey.trim()) throw Object.assign(new Error('当前供应商尚未配置 API Key'), { statusCode: 400 })
      next.activeProviderId = provider.id
    }
    if (patch.activeProviderId !== undefined) next.activeProviderId = patch.activeProviderId || undefined
    if (patch.ccSwitchModel !== undefined) next.ccSwitchModel = patch.ccSwitchModel?.trim() || undefined
    if (patch.ccSwitchReasoningEffort !== undefined) next.ccSwitchReasoningEffort = patch.ccSwitchReasoningEffort?.trim() || undefined
    await this.connection.save(next)
    await this.applyConnection()
    return this.connectionPublic()
  }

  async createProvider(input: Partial<CodexProvider> & { template?: string }) {
    const provider = input.template === 'tencent_token_plan'
      ? tencentTokenPlanTemplate(input)
      : {
          id: randomUUID(),
          name: String(input.name || '自定义供应商'),
          template: 'custom' as const,
          baseUrl: String(input.baseUrl || ''),
          apiKey: String(input.apiKey || ''),
          model: String(input.model || resolveCodexAnalysisConfig().model),
          reasoningEffort: input.reasoningEffort ? String(input.reasoningEffort) : 'medium',
          wireApi: 'responses' as const,
          requiresOpenaiAuth: input.requiresOpenaiAuth !== false,
        }
    if (input.template !== 'tencent_token_plan') {
      if (input.name) provider.name = String(input.name)
      if (input.baseUrl) provider.baseUrl = String(input.baseUrl)
      if (input.apiKey) provider.apiKey = String(input.apiKey)
      if (input.model) provider.model = String(input.model)
      if (input.reasoningEffort) provider.reasoningEffort = String(input.reasoningEffort)
    } else if (input.apiKey) {
      provider.apiKey = String(input.apiKey)
    }
    const current = this.connection.get()
    await this.connection.save({ ...current, providers: [...current.providers, provider] })
    this.changed()
    return toPublicConnection(this.connection.get()).providers.find(item => item.id === provider.id)!
  }

  async updateProvider(id: string, patch: Partial<CodexProvider>) {
    const current = this.connection.get()
    const index = current.providers.findIndex(item => item.id === id)
    if (index < 0) throw Object.assign(new Error('供应商不存在'), { statusCode: 404 })
    const providers = current.providers.slice()
    providers[index] = mergeProviderUpdate(providers[index], patch)
    await this.connection.save({ ...current, providers })
    if (current.mode === 'provider' && current.activeProviderId === id) await this.applyConnection()
    else this.changed()
    return toPublicConnection(this.connection.get()).providers[index]
  }

  async deleteProvider(id: string) {
    const current = this.connection.get()
    if (!current.providers.some(item => item.id === id)) throw Object.assign(new Error('供应商不存在'), { statusCode: 404 })
    const providers = current.providers.filter(item => item.id !== id)
    const next: CodexConnectionConfig = {
      ...current,
      providers,
      activeProviderId: current.activeProviderId === id ? undefined : current.activeProviderId,
      mode: current.mode === 'provider' && current.activeProviderId === id ? 'official' : current.mode,
    }
    await this.connection.save(next)
    await this.applyConnection()
    return this.connectionPublic()
  }

  async testConnection(input: { mode?: CodexConnectionConfig['mode']; providerId?: string } = {}): Promise<CodexConnectionTestResult> {
    const config = this.connection.get()
    const mode = input.mode || config.mode
    if (mode === 'official') {
      const login = await run(this.command, ['login', 'status'], this.environment())
      if (login.code === 0) return { ok: true, message: cleanCodexOutput(login.output) || '官方 Codex 已登录' }
      return { ok: false, message: cleanCodexOutput(login.output) || '官方 Codex 尚未登录' }
    }
    if (mode === 'cc_switch') {
      return probeModels(modelsProbeUrl(config.ccSwitchBaseUrl))
    }
    const provider = config.providers.find(item => item.id === (input.providerId || config.activeProviderId))
    if (!provider) return { ok: false, message: '未找到要测试的供应商' }
    if (!provider.apiKey.trim()) return { ok: false, message: '供应商尚未配置 API Key' }
    return probeModels(modelsProbeUrl(provider.baseUrl), provider.apiKey)
  }

  async status(): Promise<CodexStatus> {
    const environment = this.environment()
    const config = this.connection.get()
    const runtime = this.analysisConfig
    const connection = this.connectionPublic()
    const version = await run(this.command, ['--version'], environment)
    const base = {
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      mode: config.mode,
      connection,
      busy: Boolean(this.loginProcess),
    }
    if (version.code !== 0) {
      return { ...base, available: false, authenticated: false, message: '未找到可用的 Codex CLI' }
    }

    if (config.mode === 'provider') {
      const provider = config.providers.find(item => item.id === config.activeProviderId)
      const ready = Boolean(provider?.apiKey.trim())
      return {
        ...base,
        available: true,
        authenticated: ready,
        message: ready ? `直连供应商：${provider!.name}` : '直连模式未就绪：请选择已配置 Key 的供应商',
      }
    }

    if (config.mode === 'cc_switch') {
      const ready = Boolean(config.ccSwitchBaseUrl.trim())
      return {
        ...base,
        available: true,
        authenticated: ready,
        message: ready ? `CC Switch 代理：${config.ccSwitchBaseUrl}` : '请填写 CC Switch 代理地址',
      }
    }

    const login = await run(this.command, ['login', 'status'], environment)
    const loginDetails = parseCodexLoginOutput(this.loginOutput)
    let usage: CodexUsageStatus | undefined
    if (login.code === 0) {
      if (!this.usageCache || this.usageCache.expiresAt <= Date.now()) this.usageCache = { value: await readCodexRateLimits(this.command, environment), expiresAt: Date.now() + 60_000 }
      usage = this.usageCache.value
    }
    return {
      ...base,
      available: true,
      authenticated: login.code === 0,
      message: login.code === 0 ? cleanCodexOutput(login.output) || 'Codex 已登录（官方）' : 'Codex 尚未登录（官方）',
      usage,
      usageUnavailable: login.code === 0 && !usage,
      loginOutput: loginDetails.output || undefined,
      loginUrl: loginDetails.loginUrl,
      loginCode: loginDetails.loginCode,
    }
  }

  login() {
    if (this.connection.get().mode !== 'official') {
      this.loginOutput = '仅官方模式支持设备码登录'
      this.changed()
      return
    }
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

  async logout() {
    if (this.connection.get().mode !== 'official') throw Object.assign(new Error('仅官方模式支持退出登录'), { statusCode: 400 })
    this.cancelLogin()
    await run(this.command, ['logout'], this.environment())
    this.loginOutput = ''
    this.usageCache = undefined
    this.changed()
  }
}
