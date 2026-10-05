import { access, constants } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type { HypitStatus } from '../shared/types'
import { HypitConfigStore } from './hypit-config'

/** Keep in sync with Dockerfile `@hypit/hypit@…` pin. */
export const HYPIT_PACKAGE_SPEC = process.env.SVD_HYPIT_PACKAGE || '@hypit/hypit@0.2.16'
export const HYPIT_BIN = process.env.SVD_HYPIT_BIN || 'hypit'

export function defaultHypitSkillFile() {
  return process.env.SVD_HYPIT_SKILL_FILE
    || '/usr/local/lib/node_modules/@hypit/hypit/skills/hypit/SKILL.md'
}

async function executable(candidate: string) {
  try { await access(candidate, constants.X_OK); return true } catch { return false }
}

async function fileExists(candidate: string) {
  try { await access(candidate, constants.F_OK); return true } catch { return false }
}

export async function whichCommand(name: string): Promise<string | undefined> {
  const command = process.platform === 'win32' ? 'where' : 'which'
  return await new Promise(resolve => {
    const child = spawn(command, [name], { windowsHide: true })
    let out = ''
    child.stdout.on('data', value => { out += value })
    child.on('close', code => resolve(code === 0 ? out.trim().split(/\r?\n/)[0] : undefined))
    child.on('error', () => resolve(undefined))
  })
}

export async function commandVersion(command: string, args = ['--version'], timeout = 10_000) {
  return await new Promise<string | undefined>(resolve => {
    const child = spawn(command, args, { windowsHide: true })
    let out = ''
    child.stdout.on('data', value => { out += value })
    child.stderr.on('data', value => { out += value })
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(undefined) }, timeout)
    child.on('close', () => { clearTimeout(timer); resolve(out.trim().split(/\r?\n/)[0] || undefined) })
    child.on('error', () => { clearTimeout(timer); resolve(undefined) })
  })
}

export async function resolveHypitBinary(bin = HYPIT_BIN) {
  if (path.isAbsolute(bin) || bin.includes('/') || bin.includes('\\')) {
    return await executable(bin) ? bin : undefined
  }
  return whichCommand(bin)
}

function run(command: string, args: string[], timeout: number) {
  return new Promise<{ code: number | null; output: string }>(resolve => {
    const child = spawn(command, args, { windowsHide: true, env: process.env })
    let output = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout)
    child.stdout.on('data', value => { output = `${output}${value}`.slice(-40_000) })
    child.stderr.on('data', value => { output = `${output}${value}`.slice(-40_000) })
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, output: error.message }) })
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }) })
  })
}

export function npmInstallArgs(packageSpec = HYPIT_PACKAGE_SPEC) {
  return ['install', '-g', packageSpec, '--no-fund', '--no-audit']
}

export class HypitCliService {
  private busy = false
  private lastError = ''

  constructor(private config: HypitConfigStore) {}

  async status(): Promise<HypitStatus> {
    const config = this.config.publicView()
    const command = await resolveHypitBinary()
    const version = command ? await commandVersion(command) : undefined
    const skillFile = defaultHypitSkillFile()
    const skillAvailable = await fileExists(skillFile)
    const available = Boolean(command)
    let message: string
    if (this.busy) message = '正在安装 Hypit…'
    else if (this.lastError) message = this.lastError
    else if (available) message = version ? `Hypit 已安装（${version}）` : 'Hypit 已安装'
    else message = '未检测到 Hypit CLI，可点击下方按钮安装'
    return {
      ...config,
      available,
      version,
      path: command,
      packageName: HYPIT_PACKAGE_SPEC,
      busy: this.busy,
      message,
      skillFile,
      skillAvailable,
    }
  }

  /** Check first; install only when missing. */
  async ensureInstalled() {
    const current = await this.status()
    if (current.available) {
      this.lastError = ''
      return { ...current, message: current.version ? `Hypit 已就绪（${current.version}）` : 'Hypit 已就绪' }
    }
    return this.install()
  }

  async install() {
    if (this.busy) throw Object.assign(new Error('Hypit 正在安装中'), { statusCode: 409 })
    this.busy = true
    this.lastError = ''
    try {
      const npm = await whichCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm')
      if (!npm) throw new Error('未找到 npm，无法安装 Hypit')
      const result = await run(npm, npmInstallArgs(), 10 * 60_000)
      if (result.code !== 0) {
        const detail = result.output.trim().slice(-1500) || `退出码 ${result.code}`
        throw new Error(`Hypit 安装失败：${detail}`)
      }
      const after = await this.status()
      if (!after.available) throw new Error('npm 安装完成，但仍未找到 hypit 命令，请检查 PATH')
      this.lastError = ''
      return { ...after, message: after.version ? `Hypit 安装成功（${after.version}）` : 'Hypit 安装成功' }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw Object.assign(new Error(this.lastError), { statusCode: 500 })
    } finally {
      this.busy = false
    }
  }
}
