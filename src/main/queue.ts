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
  if (/Resuming download at byte|Resuming download at fragment/i.test(line)) return { detail: '发现本地缓存，从断点继续下载…' }
  if (/already been downloaded/i.test(line)) return { detail: '文件已存在，复用本地文件…' }
  if (/Extracting cookies from|Loading cookies/i.test(line)) return { detail: '正在读取服务器 Cookie 文件…' }
  if (/Extracted \d+ cookies/i.test(line)) return { detail: 'Cookie 读取完成，正在获取视频信息…' }
  if (/Downloading video info|Extracting URL/i.test(line)) return { detail: '正在获取 Instagram 视频信息…' }
  if (/\[download\] Destination:/i.test(line)) return { detail: '正在下载媒体文件…' }
  if (/\[(?:Merger|VideoRemuxer|ExtractAudio|FFmpeg)\]/i.test(line)) return { detail: '正在合并并处理媒体文件…' }
  return undefined
}

/** Picks the lines of yt-dlp/ffmpeg stderr that explain a failure, skipping progress and metadata noise. */
export function summarizeProcessError(stderr: string, fallback: string) {
  const lines = stderr.split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean)
  const noise = /^(frame=|size=|video:|ffmpeg version|built with|configuration:|lib(?:av|sw|post)\w*\s|\[?(?:vendor_id|encoder|handler_name|major_brand|minor_version|compatible_brands|creation_time|Stream|Metadata|Duration|Input|Output|Press|Side data|Guessed Channel))/i
  const meaningful = lines.filter(line => !noise.test(line))
  const errors = meaningful.filter(line => /error|invalid|fail|cannot|could not|unable|not found|no such|denied|unsupported|unavailable|forbidden|timed? ?out|does not contain/i.test(line))
  return (errors.length ? errors : meaningful).slice(-3).join('\n') || fallback
}

export function buildOutputTemplate(folder: string, item: StartRequest['items'][number]) {
  const rawDate = item.publishedAt.match(/^\d{4}-?\d{2}-?\d{2}/)?.[0] || 'unknown'
  const date = rawDate === 'unknown' ? rawDate : rawDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  const title = sanitizeFilename(item.title, 40).replace(/%/g, '%%')
  const id = sanitizeFilename(item.id, 40).replace(/%/g, '%%')
  return path.join(folder, `${date}_${title}_[${id}].%(ext)s`)
}

/** Longest side of the QuickTime-compatible output; 4K sources are downscaled so one encode stays well under 1 GB. */
export const QUICKTIME_MAX_EDGE = 1920

/**
 * ffmpeg arguments for the QuickTime-compatible re-encode. Scales the longer
 * edge down to QUICKTIME_MAX_EDGE (never upscales, keeps portrait videos
 * portrait) and uses a fast x264 preset so memory and time stay bounded.
 */
export function quickTimeArgs(input: string, output: string) {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-stats', '-i', input, '-map', '0:v:0?', '-map', '0:a:0?',
    '-vf', `scale=w='min(iw,${QUICKTIME_MAX_EDGE})':h='min(ih,${QUICKTIME_MAX_EDGE})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output]
}

export class DownloadQueue {
  private jobs = new Map<string, DownloadJob>(); private active = new Map<string, ChildProcessWithoutNullStreams>(); private report: (jobs: DownloadJob[]) => void = () => undefined
  /** Jobs that finished downloading and are waiting for / running the single transcode lane. */
  private transcoding = new Set<string>(); private transcodeBusy = false; private transcodeWaiters: Array<() => void> = []
  constructor(private tools: ToolManager) {}
  /** Downloads currently using one of the three network slots (transcoding jobs no longer occupy one). */
  private downloadingCount() { return this.snapshot().filter(job => job.status === 'downloading' && !this.transcoding.has(job.id)).length }
  private async acquireTranscodeLane() {
    if (!this.transcodeBusy) { this.transcodeBusy = true; return }
    // The lane is handed over directly to the next waiter, so it stays busy.
    await new Promise<void>(resolve => this.transcodeWaiters.push(resolve))
  }
  private releaseTranscodeLane() { const next = this.transcodeWaiters.shift(); if (next) next(); else this.transcodeBusy = false }
  snapshot() { return [...this.jobs.values()] }
  get(id: string) { return this.jobs.get(id) }
  setReporter(report: (jobs: DownloadJob[]) => void) { this.report = report }
  /** Loads persisted jobs (e.g. after a restart) so history stays visible and failed jobs remain retryable. */
  hydrate(jobs: DownloadJob[]) {
    for (const job of [...jobs].reverse()) if (!this.jobs.has(job.id)) this.jobs.set(job.id, { ...job, status: ['queued', 'downloading'].includes(job.status) ? 'failed' : job.status, speed: undefined, eta: undefined })
  }
  async start(request: StartRequest, report?: (jobs: DownloadJob[]) => void) {
    if (report) this.report = report
    for (const item of request.items) { const id = randomUUID(); this.jobs.set(id, { id, item, options: request.options, status: 'queued', progress: 0, attempts: 0 }) }
    this.emit(); this.pump(); return this.snapshot()
  }
  cancel(id?: string) {
    if (id) this.cancelOne(id); else for (const jobId of this.jobs.keys()) this.cancelOne(jobId)
    this.emit()
  }
  /**
   * Re-queues a failed or cancelled job. yt-dlp runs with --continue and
   * --no-overwrites, so partially downloaded .part files and already finished
   * files on disk are reused instead of downloading from scratch.
   */
  retry(id: string) { if (this.requeue(id)) { this.emit(); this.pump() } }
  retryFailed() { let count = 0; for (const job of this.jobs.values()) if (job.status === 'failed' && this.requeue(job.id)) count++; if (count) { this.emit(); this.pump() } return count }
  private requeue(id: string) {
    const job = this.jobs.get(id); if (!job || !['failed', 'cancelled'].includes(job.status)) return false
    job.status = 'queued'; job.error = undefined; job.progress = 0; job.attempts = 0; job.speed = undefined; job.eta = undefined; job.detail = '等待重试，将复用本地已下载的部分'
    return true
  }
  shutdown() { for (const child of this.active.values()) child.kill('SIGTERM') }
  private cancelOne(id: string) { const job = this.jobs.get(id); if (!job || ['completed', 'skipped'].includes(job.status)) return; job.status = 'cancelled'; this.active.get(id)?.kill('SIGTERM'); this.active.delete(id) }
  private pump() {
    while (this.downloadingCount() < 3) {
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
    if (job.options.cookieSource !== 'none') {
      args.push('--cookies', process.env.SVD_COOKIES_FILE || '/config/cookies.txt')
      if (job.item.platform === 'youtube') args.push('--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=default,web_embedded')
    }
    else if (job.item.platform === 'youtube') args.push('--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=default,web_embedded')
    if (job.item.platform === 'instagram') args.push('--referer', 'https://www.instagram.com/')
    args.push(job.item.sourceUrl)
    const child = spawn(ytdlp, args, { windowsHide: true }); this.active.set(job.id, child); this.emit()
    let error = '', stdoutBuffer = '', stderrBuffer = '', downloadedPath = '', alreadyDownloaded = false
    const handleLine = (line: string) => {
      if (!line) return
      const existing = line.match(/\[download\]\s+(.+?) has already been downloaded/i)
      if (existing) { alreadyDownloaded = true; if (!downloadedPath) downloadedPath = existing[1].trim() }
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
            // Free the network slot while this job waits for the single transcode lane.
            this.transcoding.add(job.id); job.progress = 99; job.detail = alreadyDownloaded ? '已复用本地文件，等待转码…' : '下载完成，等待转码…'; this.emit(); this.pump()
            await this.acquireTranscodeLane()
            try { if (String(job.status) === 'cancelled') throw new Error('转换已取消'); downloadedPath = await this.transcodeQuickTime(job, ffmpeg, downloadedPath) }
            finally { this.releaseTranscodeLane(); this.transcoding.delete(job.id) }
          }
          job.status = alreadyDownloaded ? 'skipped' : 'completed'; job.progress = 100
          job.detail = alreadyDownloaded ? (needsConversion ? '已复用本地文件并完成转码' : '文件已存在，未重复下载') : '下载完成'
          job.outputPath = downloadedPath || undefined
        } catch (conversionError) {
          this.transcoding.delete(job.id)
          if (String(job.status) !== 'cancelled') { job.status = 'failed'; job.detail = undefined; job.error = conversionError instanceof Error ? conversionError.message : String(conversionError) }
        }
      }
      else if (job.attempts < 3) { job.status = 'queued'; job.detail = `第 ${job.attempts} 次尝试失败，正在重试…`; job.error = undefined }
      else { job.status = 'failed'; job.detail = undefined; job.error = summarizeProcessError(error, '下载失败') }
      this.emit(); this.pump()
    })() })
    child.on('error', err => { this.active.delete(job.id); job.status = 'failed'; job.error = err.message; this.emit(); this.pump() })
  }
  private transcodeQuickTime(job: DownloadJob, ffmpeg: string, input: string) {
    const parsed = path.parse(input)
    const output = path.join(parsed.dir, `${parsed.name}.quicktime.mp4`)
    job.detail = '正在转换为 QuickTime 兼容格式（最高 1080p）…'; job.progress = 99; this.emit()
    return new Promise<string>((resolve, reject) => {
      const child = spawn(ffmpeg, quickTimeArgs(input, output), { windowsHide: true })
      this.active.set(job.id, child)
      let stderr = ''
      child.stderr.on('data', data => { stderr = `${stderr}${data.toString()}`.slice(-1024 * 1024) })
      child.on('error', reject)
      child.on('close', (code, signal) => {
        this.active.delete(job.id)
        if (job.status === 'cancelled') { reject(new Error('转换已取消')); return }
        if (signal) { reject(new Error(`QuickTime 转换被系统终止（${signal}），通常是内存不足；重试会复用已下载的文件`)); return }
        if (code !== 0) { reject(new Error(`QuickTime 转换失败：${summarizeProcessError(stderr, '未知错误')}`)); return }
        void rm(input, { force: true }).then(() => resolve(output), reject)
      })
    })
  }
  private emit() { this.report(this.snapshot()) }
}
