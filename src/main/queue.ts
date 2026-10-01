import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { buildFormatArgs, sanitizeFilename } from '../shared/core'
import type { DownloadJob, StartRequest } from '../shared/types'
import type { ToolManager } from './tools'

export interface ParsedDownloadOutput {
  progress?: number
  speed?: string
  eta?: string
  detail?: string
}

export function parseDownloadOutput(line: string): ParsedDownloadOutput | undefined {
  const progress = line.match(/^svd:\s*([\d.]+)%\|([^|]*)\|([^|]*)/)
  if (progress) return { progress: Number(progress[1]), speed: progress[2].trim(), eta: progress[3].trim(), detail: '正在下载媒体文件…' }
  if (/Extracting cookies from|Loading cookies/i.test(line)) return { detail: '正在读取服务器 Cookie 文件…' }
  if (/Extracted \d+ cookies/i.test(line)) return { detail: 'Cookie 读取完成，正在获取视频信息…' }
  if (/Downloading video info|Extracting URL/i.test(line)) return { detail: '正在获取 Instagram 视频信息…' }
  if (/\[download\] Destination:/i.test(line)) return { detail: '正在下载媒体文件…' }
  if (/\[(?:Merger|VideoRemuxer|ExtractAudio|FFmpeg)\]/i.test(line)) return { detail: '正在合并并处理媒体文件…' }
  return undefined
}

export function buildOutputTemplate(folder: string, item: StartRequest['items'][number]) {
  const rawDate = item.publishedAt.match(/^\d{4}-?\d{2}-?\d{2}/)?.[0] || 'unknown'
  const date = rawDate === 'unknown' ? rawDate : rawDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  const title = sanitizeFilename(item.title, 40).replace(/%/g, '%%')
  const id = sanitizeFilename(item.id, 40).replace(/%/g, '%%')
  return path.join(folder, `${date}_${title}_[${id}].%(ext)s`)
}

export class DownloadQueue {
  private jobs = new Map<string, DownloadJob>(); private active = new Map<string, ChildProcessWithoutNullStreams>(); private report: (jobs: DownloadJob[]) => void = () => undefined
  constructor(private tools: ToolManager) {}
  snapshot() { return [...this.jobs.values()] }
  get(id: string) { return this.jobs.get(id) }
  async start(request: StartRequest, report?: (jobs: DownloadJob[]) => void) {
    if (report) this.report = report
    for (const item of request.items) { const id = randomUUID(); this.jobs.set(id, { id, item, options: request.options, status: 'queued', progress: 0, attempts: 0 }) }
    this.emit(); this.pump(); return this.snapshot()
  }
  cancel(id?: string) {
    if (id) this.cancelOne(id); else for (const jobId of this.jobs.keys()) this.cancelOne(jobId)
    this.emit()
  }
  retry(id: string) { const job = this.jobs.get(id); if (!job || !['failed', 'cancelled'].includes(job.status)) return; job.status = 'queued'; job.error = undefined; job.progress = 0; job.attempts = 0; this.emit(); this.pump() }
  shutdown() { for (const child of this.active.values()) child.kill('SIGTERM') }
  private cancelOne(id: string) { const job = this.jobs.get(id); if (!job || ['completed', 'skipped'].includes(job.status)) return; job.status = 'cancelled'; this.active.get(id)?.kill('SIGTERM'); this.active.delete(id) }
  private pump() {
    while (this.snapshot().filter(job => job.status === 'downloading').length < 3) {
      const job = this.snapshot().find(candidate => candidate.status === 'queued')
      if (!job) break
      // Reserve the slot before run() reaches its first await. Without this,
      // the loop repeatedly selects the same queued job and exhausts V8.
      job.status = 'downloading'
      job.attempts++
      job.detail = job.options.cookieSource === 'none' ? '正在连接视频平台…' : '正在准备服务器 Cookie…'
      void this.run(job)
    }
    this.emit()
  }
  private async run(job: DownloadJob) {
    const ytdlp = await this.tools.resolve('yt-dlp'); const ffmpeg = await this.tools.resolve('ffmpeg')
    if (job.status === 'cancelled') { this.pump(); return }
    if (!ytdlp) { job.status = 'failed'; job.error = '未找到 yt-dlp'; this.emit(); this.pump(); return }
    const folder = job.item.collection ? path.join(job.options.outputRoot, sanitizeFilename(job.item.collection)) : job.options.outputRoot
    const template = buildOutputTemplate(folder, job.item)
    // `download:` selects yt-dlp's progress-template type and is not printed.
    // Keep a second, literal prefix so the stream remains machine-readable.
    const args = ['--newline', '--no-overwrites', '--continue', '--retries', '3', '--fragment-retries', '3', '-o', template, '--progress-template', 'download:svd:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s', '--print', 'after_move:svd-file:%(filepath)s', ...buildFormatArgs(job.options, job.item)]
    if (ffmpeg) args.push('--ffmpeg-location', ffmpeg)
    if (job.options.cookieSource !== 'none') args.push('--cookies', process.env.SVD_COOKIES_FILE || '/config/cookies.txt')
    if (job.item.platform === 'instagram') args.push('--referer', 'https://www.instagram.com/')
    args.push(job.item.sourceUrl)
    const child = spawn(ytdlp, args, { windowsHide: true }); this.active.set(job.id, child); this.emit()
    let error = '', stdoutBuffer = '', stderrBuffer = '', downloadedPath = '', alreadyDownloaded = false
    const handleLine = (line: string) => {
      if (!line) return
      if (/already been downloaded|has already been downloaded/i.test(line)) alreadyDownloaded = true
      if (line.startsWith('svd-file:')) { downloadedPath = line.slice('svd-file:'.length).trim(); return }
      const update = parseDownloadOutput(line)
      if (!update) return
      if (update.progress !== undefined) job.progress = update.progress
      if (update.speed !== undefined) job.speed = update.speed
      if (update.eta !== undefined) job.eta = update.eta
      if (update.detail !== undefined) job.detail = update.detail
      this.emit()
    }
    const consume = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const combined = (stream === 'stdout' ? stdoutBuffer : stderrBuffer) + chunk.toString()
      const lines = combined.split(/\r?\n/)
      if (stream === 'stdout') stdoutBuffer = lines.pop() || ''
      else stderrBuffer = lines.pop() || ''
      for (const line of lines) handleLine(line)
    }
    child.stdout.on('data', chunk => consume(chunk, 'stdout'))
    child.stderr.on('data', chunk => { error = `${error}${chunk.toString()}`.slice(-1024 * 1024); consume(chunk, 'stderr') })
    child.on('close', code => { void (async () => {
      this.active.delete(job.id)
      if (job.status === 'cancelled') { this.emit(); this.pump(); return }
      handleLine(stdoutBuffer); handleLine(stderrBuffer)
      if (code === 0) {
        try {
          const selected = job.item.formats?.find(format => format.id === job.item.selectedFormatId)
          const needsConversion = job.options.quickTimeCompatible && selected?.kind !== 'audio-only' && !selected?.quickTimeCompatible
          if (needsConversion && downloadedPath) {
            if (!ffmpeg) throw new Error('QuickTime 转换需要 FFmpeg')
            downloadedPath = await this.transcodeQuickTime(job, ffmpeg, downloadedPath)
          }
          job.status = alreadyDownloaded ? 'skipped' : 'completed'; job.progress = 100
          job.detail = job.status === 'skipped' ? '文件已存在，未重复下载' : '下载完成'
          job.outputPath = downloadedPath || undefined
        } catch (conversionError) {
          if (String(job.status) !== 'cancelled') { job.status = 'failed'; job.detail = undefined; job.error = conversionError instanceof Error ? conversionError.message : String(conversionError) }
        }
      }
      else if (job.attempts < 3) { job.status = 'queued'; job.detail = `第 ${job.attempts} 次尝试失败，正在重试…`; job.error = undefined }
      else { job.status = 'failed'; job.detail = undefined; job.error = error.trim().split(/\r?\n/).slice(-3).join('\n') || '下载失败' }
      this.emit(); this.pump()
    })() })
    child.on('error', err => { this.active.delete(job.id); job.status = 'failed'; job.error = err.message; this.emit(); this.pump() })
  }
  private transcodeQuickTime(job: DownloadJob, ffmpeg: string, input: string) {
    const parsed = path.parse(input)
    const output = path.join(parsed.dir, `${parsed.name}.quicktime.mp4`)
    job.detail = '正在转换为 QuickTime 兼容格式…'; job.progress = 99; this.emit()
    return new Promise<string>((resolve, reject) => {
      const child = spawn(ffmpeg, ['-y', '-i', input, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output], { windowsHide: true })
      this.active.set(job.id, child)
      let stderr = ''
      child.stderr.on('data', data => { stderr = `${stderr}${data.toString()}`.slice(-1024 * 1024) })
      child.on('error', reject)
      child.on('close', code => {
        this.active.delete(job.id)
        if (job.status === 'cancelled') { reject(new Error('转换已取消')); return }
        if (code !== 0) { reject(new Error(stderr.trim().split(/\r?\n/).slice(-3).join('\n') || 'QuickTime 转换失败')); return }
        void rm(input, { force: true }).then(() => resolve(output), reject)
      })
    })
  }
  private emit() { this.report(this.snapshot()) }
}
