import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { constants, createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import https from 'node:https'
import type { ToolInfo, ToolName, ToolStatus, ToolUpdateEvent } from '../shared/types'

type ProgressReporter = (event: ToolUpdateEvent) => void

async function executable(candidate: string) { try { await access(candidate, constants.X_OK); return true } catch { return false } }
async function which(name: string): Promise<string | undefined> {
  const command = process.platform === 'win32' ? 'where' : 'which'
  return await new Promise(resolve => {
    const child = spawn(command, [name], { windowsHide: true })
    let out = ''; child.stdout.on('data', d => out += d)
    child.on('close', code => resolve(code === 0 ? out.trim().split(/\r?\n/)[0] : undefined))
    child.on('error', () => resolve(undefined))
  })
}
async function version(command: string, args = ['--version']) {
  return await new Promise<string | undefined>(resolve => {
    const child = spawn(command, args, { windowsHide: true }); let out = ''
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d)
    const timer = setTimeout(() => { child.kill(); resolve(undefined) }, 10_000)
    child.on('close', () => { clearTimeout(timer); resolve(out.trim().split(/\r?\n/)[0]) }); child.on('error', () => { clearTimeout(timer); resolve(undefined) })
  })
}

export class ToolManager {
  readonly dir = path.join(process.env.SVD_CONFIG_DIR || path.join(os.homedir(), '.config', 'social-video-downloader'), 'tools')
  private managed(name: 'yt-dlp' | 'gallery-dl' | 'ffmpeg') {
    return path.join(this.dir, process.platform === 'win32' ? `${name}.exe` : name)
  }
  async resolve(name: 'yt-dlp' | 'gallery-dl' | 'ffmpeg'): Promise<string | undefined> {
    const local = this.managed(name)
    if (await executable(local)) return local
    return which(name)
  }
  async status(): Promise<ToolStatus> {
    const names = ['yt-dlp', 'gallery-dl', 'ffmpeg'] as const
    const tools: ToolInfo[] = await Promise.all(names.map(async name => {
      const command = await this.resolve(name)
      return { name, available: Boolean(command), path: command, version: command ? await version(command) : undefined, managed: command === this.managed(name) }
    }))
    return { ready: tools.every(t => t.available), tools }
  }
  private download(url: string, target: string, tool: ToolName, report: ProgressReporter, redirects = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (redirects > 8) { reject(new Error('下载重定向次数过多')); return }
      const request = https.get(url, { headers: { 'User-Agent': 'social-video-downloader' } }, response => {
        if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume(); this.download(new URL(response.headers.location, url).toString(), target, tool, report, redirects + 1).then(resolve, reject); return
        }
        if (response.statusCode !== 200) { reject(new Error(`下载失败 HTTP ${response.statusCode}`)); return }
        const temporary = `${target}.download`
        const total = Number(response.headers['content-length']) || undefined
        let received = 0
        let lastReported = 0
        const startedAt = Date.now()
        let inactivityTimer: NodeJS.Timeout
        const resetTimeout = () => {
          clearTimeout(inactivityTimer)
          inactivityTimer = setTimeout(() => response.destroy(new Error('下载长时间无响应，请检查网络后重试')), 45_000)
        }
        const file = createWriteStream(temporary)
        resetTimeout()
        response.on('data', chunk => {
          received += chunk.length
          resetTimeout()
          const now = Date.now()
          if (now - lastReported >= 150 || (total && received >= total)) {
            lastReported = now
            const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.1)
            const speedBytesPerSecond = received / elapsedSeconds
            report({ tool, phase: 'downloading', progress: total ? Math.min(100, Math.round(received / total * 100)) : null, message: '正在下载', receivedBytes: received, totalBytes: total, speedBytesPerSecond, etaSeconds: total ? Math.max(0, (total - received) / speedBytesPerSecond) : undefined })
          }
        })
        const fail = (error: Error) => { clearTimeout(inactivityTimer); void rm(temporary, { force: true }); reject(error) }
        response.on('error', fail)
        file.on('error', fail)
        response.pipe(file)
        file.on('finish', () => file.close(async error => {
          clearTimeout(inactivityTimer)
          if (error) { fail(error); return }
          try {
            await rm(target, { force: true })
            await rename(temporary, target)
            resolve()
          } catch (moveError) { fail(moveError as Error) }
        }))
      })
      request.setTimeout(45_000, () => request.destroy(new Error('连接下载服务器超时，请检查网络后重试')))
      request.on('error', reject)
    })
  }
  async update(report: ProgressReporter = () => undefined): Promise<ToolStatus> {
    await mkdir(this.dir, { recursive: true })
    let activeTool: ToolName = 'yt-dlp'
    try {
      report({ tool: 'yt-dlp', phase: 'checking', progress: 0, message: '正在连接更新服务器' })
      const ytName = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'
      const ytTarget = this.managed('yt-dlp')
      await this.download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytName}`, ytTarget, 'yt-dlp', report)
      if (process.platform !== 'win32') await chmod(ytTarget, 0o755)
      report({ tool: 'yt-dlp', phase: 'done', progress: 100, message: '安装完成' })

      activeTool = 'gallery-dl'
      await this.installGalleryDl(report)

      activeTool = 'ffmpeg'
      report({ tool: 'ffmpeg', phase: 'checking', progress: 0, message: '正在检查' })
      const ffmpeg = await this.resolve('ffmpeg')
      if (!ffmpeg) throw new Error('未找到 FFmpeg，请重新安装应用或在系统中安装 FFmpeg。')
      report({ tool: 'ffmpeg', phase: 'done', progress: 100, message: '应用已内置' })

      const result = await this.status()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report({ tool: activeTool, phase: 'error', progress: null, message: '安装失败', detail: message })
      throw error
    }
  }
  private async installGalleryDl(report: ProgressReporter) {
    if (process.platform === 'win32') {
      report({ tool: 'gallery-dl', phase: 'checking', progress: 0, message: '正在连接更新服务器' })
      await this.download('https://github.com/gdl-org/builds/releases/latest/download/gallery-dl.exe', this.managed('gallery-dl'), 'gallery-dl', report)
      report({ tool: 'gallery-dl', phase: 'done', progress: 100, message: '安装完成' })
      return
    }
    report({ tool: 'gallery-dl', phase: 'checking', progress: 0, message: '正在检查 Python 环境' })
    const python = await which('python3')
    if (!python) throw new Error('安装 gallery-dl 需要 Python 3；请先安装 Python，或手动安装 gallery-dl。')
    const targetDir = path.join(this.dir, 'gallery-python')
    await mkdir(targetDir, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--progress-bar', 'off', '--upgrade', '--target', targetDir, 'gallery-dl'], { windowsHide: true })
      let output = ''
      let inactivityTimer: NodeJS.Timeout
      const hardTimer = setTimeout(() => { child.kill(); reject(new Error('gallery-dl 安装超过 3 分钟，已停止。请检查网络后重试。')) }, 180_000)
      const resetTimeout = () => {
        clearTimeout(inactivityTimer)
        inactivityTimer = setTimeout(() => { child.kill(); reject(new Error('gallery-dl 安装长时间没有进展，已停止。请检查网络或 Python 配置。')) }, 45_000)
      }
      const handleOutput = (data: Buffer) => {
        output = `${output}${data.toString()}`.slice(-100_000)
        const detail = output.trim().split(/\r?\n/).filter(Boolean).at(-1)
        report({ tool: 'gallery-dl', phase: 'installing', progress: null, message: '正在通过 Python 安装', detail })
        resetTimeout()
      }
      resetTimeout()
      child.stdout.on('data', handleOutput); child.stderr.on('data', handleOutput)
      child.on('close', code => {
        clearTimeout(inactivityTimer); clearTimeout(hardTimer)
        code === 0 ? resolve() : reject(new Error(output.trim() || 'gallery-dl 安装失败'))
      })
      child.on('error', error => { clearTimeout(inactivityTimer); clearTimeout(hardTimer); reject(error) })
    })
    const wrapper = this.managed('gallery-dl')
    const script = `#!/bin/sh\nPYTHONPATH="${targetDir}" exec "${python}" -m gallery_dl "$@"\n`
    await writeFile(wrapper, script); await chmod(wrapper, 0o755)
    report({ tool: 'gallery-dl', phase: 'done', progress: 100, message: '安装完成' })
  }
}
