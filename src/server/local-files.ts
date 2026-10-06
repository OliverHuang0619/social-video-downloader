import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LocalFileActionsStatus } from '../shared/types'

const MAX_FILES = 40
export type HostFileRoot = 'downloads' | 'imports'
export type HostFileRef = { root: HostFileRoot; relative: string }
export type LocalFileRoots = Record<HostFileRoot, string>

export function airdropSourcePath() {
  return fileURLToPath(new URL('../../scripts/airdrop-share.swift', import.meta.url))
}
export function airdropBinaryPath() {
  return fileURLToPath(new URL('../../config/airdrop-share', import.meta.url))
}
let airdropBuild: Promise<string> | undefined
export function ensureAirdropBinary() {
  if (!airdropBuild) {
    airdropBuild = buildAirdropBinary().catch(error => { airdropBuild = undefined; throw error })
  }
  return airdropBuild
}
async function buildAirdropBinary() {
  const source = airdropSourcePath()
  const binary = airdropBinaryPath()
  const [sourceInfo, binaryInfo] = await Promise.all([stat(source), stat(binary).catch(() => undefined)])
  if (binaryInfo && binaryInfo.mtimeMs >= sourceInfo.mtimeMs) return binary
  await mkdir(path.dirname(binary), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    execFile('swiftc', ['-O', '-o', binary, source], { timeout: 120_000 }, (error, _stdout, stderr) => {
      if (error) reject(Object.assign(new Error(String(stderr || error.message).trim() || '无法编译 AirDrop 助手。请安装 Xcode 命令行工具。'), { statusCode: 500 }))
      else resolve()
    })
  })
  return binary
}

export async function hostFileRef(file: string, roots: LocalFileRoots): Promise<HostFileRef> {
  const resolved = await realpath(file)
  const bases = await Promise.all((['downloads', 'imports'] as const).map(async root => {
    const base = await realpath(roots[root]).catch(() => path.resolve(roots[root]))
    return { root, base }
  }))
  bases.sort((left, right) => right.base.length - left.base.length)
  for (const candidate of bases) {
    const relative = path.relative(candidate.base, resolved)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return { root: candidate.root, relative }
  }
  throw Object.assign(new Error('文件不在本机可打开的目录中'), { statusCode: 403 })
}

export interface LocalFileRunner {
  reveal(files: string[]): Promise<void>
  airdrop(files: string[]): Promise<void>
}

export function createNativeRunner(platform: NodeJS.Platform, launch: (command: string, args: string[], detach: boolean) => Promise<void> = launchCommand, resolveAirdrop: () => Promise<string> = ensureAirdropBinary): LocalFileRunner {
  return {
    async reveal(files) {
      if (platform === 'darwin') return launch('open', ['-R', ...files], false)
      if (platform === 'win32') {
        for (const file of files) await launch('explorer', [`/select,${file}`], false)
        return
      }
      for (const directory of new Set(files.map(file => path.dirname(file)))) await launch('xdg-open', [directory], false)
    },
    async airdrop(files) {
      if (platform !== 'darwin') throw Object.assign(new Error('AirDrop 仅在 Mac 上可用'), { statusCode: 409 })
      await launch(await resolveAirdrop(), files, true)
    },
  }
}

function launchCommand(command: string, args: string[], detach: boolean) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: detach, stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''
    let settled = false
    const finish = (failure?: Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (failure) reject(failure)
      else resolve()
    }
    const timer = detach ? setTimeout(() => { child.unref(); finish() }, 1200) : undefined
    child.stderr?.on('data', chunk => { if (error.length < 2_000) error += String(chunk) })
    child.once('error', failure => finish(failure))
    child.once('exit', code => finish(code && code !== 0 ? new Error(error.trim() || `${command} 退出码 ${code}`) : undefined))
  })
}

type HostClient = { endpoint: string; token: string; fetch: typeof fetch }

export class LocalFileActions {
  private cached?: { at: number; value: LocalFileActionsStatus }
  constructor(private options: { mode: 'native' | 'host'; platform: NodeJS.Platform; roots: LocalFileRoots; runner?: LocalFileRunner; host?: HostClient }) {}

  async capabilities(): Promise<LocalFileActionsStatus> {
    if (this.cached && Date.now() - this.cached.at < 3_000) return this.cached.value
    const value = this.options.mode === 'native' ? nativeCapabilities(this.options.platform) : await hostCapabilities(this.options.host)
    this.cached = { at: Date.now(), value }
    return value
  }

  async reveal(files: string[]) {
    const status = await this.capabilities()
    if (!status.reveal) throw Object.assign(new Error('当前部署不能打开文件所在目录'), { statusCode: 409 })
    const refs = await this.refs(files)
    if (this.options.mode === 'native') await this.runnerOrThrow().reveal(files)
    else await postAction(this.options.host, 'reveal', refs)
  }

  async airdrop(files: string[]) {
    const status = await this.capabilities()
    if (!status.airdrop) throw Object.assign(new Error('当前电脑不能使用 AirDrop'), { statusCode: 409 })
    const refs = await this.refs(files)
    if (this.options.mode === 'native') await this.runnerOrThrow().airdrop(files)
    else await postAction(this.options.host, 'airdrop', refs)
  }

  private runnerOrThrow() {
    if (!this.options.runner) throw Object.assign(new Error('本地文件操作不可用'), { statusCode: 409 })
    return this.options.runner
  }

  private async refs(files: string[]) {
    const unique = [...new Set(files.map(String))].filter(Boolean)
    if (!unique.length) throw Object.assign(new Error('请选择视频'), { statusCode: 400 })
    if (unique.length > MAX_FILES) throw Object.assign(new Error(`一次最多操作 ${MAX_FILES} 个视频`), { statusCode: 400 })
    return Promise.all(unique.map(file => hostFileRef(file, this.options.roots)))
  }
}

function nativeCapabilities(platform: NodeJS.Platform): LocalFileActionsStatus {
  return { reveal: platform === 'darwin' || platform === 'linux' || platform === 'win32', airdrop: platform === 'darwin' }
}

async function hostCapabilities(host: HostClient | undefined): Promise<LocalFileActionsStatus> {
  if (!host) return { reveal: false, airdrop: false }
  try {
    const response = await host.fetch(new URL('/capabilities', host.endpoint), { headers: { authorization: `Bearer ${host.token}` }, signal: AbortSignal.timeout(1500) })
    if (!response.ok) return { reveal: false, airdrop: false }
    const value = await response.json() as Partial<LocalFileActionsStatus>
    return { reveal: Boolean(value.reveal), airdrop: Boolean(value.airdrop) }
  } catch {
    return { reveal: false, airdrop: false }
  }
}

async function postAction(host: HostClient | undefined, action: 'reveal' | 'airdrop', files: HostFileRef[]) {
  if (!host) throw Object.assign(new Error('本地文件助手未就绪'), { statusCode: 409 })
  const response = await host.fetch(new URL('/actions', host.endpoint), {
    method: 'POST',
    headers: { authorization: `Bearer ${host.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, files }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    const value = await response.json().catch(() => ({})) as { error?: string }
    throw Object.assign(new Error(value.error || '本机文件操作失败'), { statusCode: response.status })
  }
}

export function createLocalFileActions() {
  const roots = { downloads: process.env.SVD_OUTPUT_DIR || '/downloads', imports: process.env.SVD_IMPORT_DIR || '/imports' }
  const docker = existsSync('/.dockerenv') || process.env.SVD_RUNTIME === 'docker'
  if (docker) {
    const endpoint = process.env.SVD_HOST_FILE_ACTIONS || ''
    const tokenFile = process.env.SVD_HOST_FILE_ACTIONS_TOKEN_FILE || ''
    let token = ''
    try { token = tokenFile ? readFileSync(tokenFile, 'utf8').trim() : '' } catch { token = '' }
    return new LocalFileActions({ mode: 'host', platform: 'linux', roots, host: endpoint && token ? { endpoint, token, fetch } : undefined })
  }
  const platform = process.platform
  return new LocalFileActions({ mode: 'native', platform, roots, runner: createNativeRunner(platform) })
}
