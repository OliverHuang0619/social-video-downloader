import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import type { WebContents } from 'electron'
import { detectPlatform, mediaFromYtDlp, normalizeUrls } from '../shared/core'
import type { AnalyzeRequest, CookieSource, MediaItem, ScanEvent, ScanRequest } from '../shared/types'
import type { ToolManager } from './tools'

function cookieArgs(source: CookieSource) { return source === 'none' ? [] : ['--cookies-from-browser', source] }
function collect(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true }); let out = '', error = '', settled = false
    const finish = (callback: () => void) => { if (settled) return; settled = true; clearTimeout(timer); callback() }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(() => reject(new Error('解析超过 60 秒仍未完成，已停止。请检查网络、切换 Cookie 来源后重试。')))
    }, 60_000)
    child.stdout.on('data', d => {
      out += d
      if (out.length > 25 * 1024 * 1024) { child.kill('SIGTERM'); finish(() => reject(new Error('解析结果过大，请使用“博主主页”模式扫描频道或合集。'))) }
    })
    child.stderr.on('data', d => { if (error.length < 1024 * 1024) error += d })
    child.on('close', code => finish(() => code === 0 ? resolve(out) : reject(new Error(classifyError(error)))))
    child.on('error', value => finish(() => reject(value)))
  })
}
function classifyError(error: string) {
  const value = error.trim()
  if (/cookies|login|sign in|authentication/i.test(value)) return '需要有效的浏览器登录 Cookie，请在设置中选择已登录该平台的浏览器。'
  if (/429|rate.?limit|too many/i.test(value)) return '平台请求过于频繁，请稍后重试或选择浏览器 Cookie。'
  if (/private|not available|unavailable/i.test(value)) return '该内容不可用、为私密内容或受到地区限制。'
  return value.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') || '解析失败'
}

export class MediaService {
  private scanProcess?: ChildProcessWithoutNullStreams
  private thumbnailCache = new Map<string, Promise<string | undefined>>()
  constructor(private tools: ToolManager) {}
  async loadThumbnail(value: string): Promise<string | undefined> {
    let url: URL
    try { url = new URL(value) } catch { return undefined }
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    const cached = this.thumbnailCache.get(url.toString())
    if (cached) return cached
    const pending = this.fetchThumbnail(url, 0).catch(() => undefined)
    this.thumbnailCache.set(url.toString(), pending)
    if (this.thumbnailCache.size > 100) this.thumbnailCache.delete(this.thumbnailCache.keys().next().value!)
    return pending
  }
  private fetchThumbnail(url: URL, redirects: number): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      if (redirects > 5) { reject(new Error('缩略图重定向次数过多')); return }
      const transport = url.protocol === 'https:' ? https : http
      const request = transport.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 SocialVideoDownloader/0.1' } }, response => {
        if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume(); this.fetchThumbnail(new URL(response.headers.location, url), redirects + 1).then(resolve, reject); return
        }
        const contentType = String(response.headers['content-type'] || '').split(';')[0]
        const declaredSize = Number(response.headers['content-length']) || 0
        if (response.statusCode !== 200 || !contentType.startsWith('image/') || declaredSize > 3 * 1024 * 1024) { response.resume(); resolve(undefined); return }
        const chunks: Buffer[] = []; let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 3 * 1024 * 1024) { response.destroy(new Error('缩略图过大')); return }
          chunks.push(chunk)
        })
        response.on('end', () => resolve(`data:${contentType};base64,${Buffer.concat(chunks).toString('base64')}`))
        response.on('error', reject)
      })
      request.setTimeout(10_000, () => request.destroy(new Error('缩略图加载超时')))
      request.on('error', reject)
    })
  }
  async analyze(request: AnalyzeRequest): Promise<MediaItem[]> {
    const ytdlp = await this.tools.resolve('yt-dlp'); if (!ytdlp) throw new Error('未找到 yt-dlp，请先安装运行工具。')
    const urls = normalizeUrls(request.urls)
    const results = new Array<MediaItem>(urls.length)
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, async () => {
      while (cursor < urls.length) {
        const index = cursor++; const url = urls[index]
        const output = await collect(ytdlp, ['--dump-single-json', '--no-warnings', '--no-playlist', ...cookieArgs(request.cookieSource), url])
        results[index] = mediaFromYtDlp(JSON.parse(output), url)
      }
    }))
    return results
  }
  async scan(request: ScanRequest, sender: WebContents) {
    const [url] = normalizeUrls(request.url); const scanId = randomUUID(); const seen = new Set<string>(); let count = 0
    const emit = (event: ScanEvent) => { if (!sender.isDestroyed()) sender.send('creator:scan-progress', event) }
    const onItem = (item: MediaItem) => { const key = `${item.platform}:${item.id}`; if (seen.has(key)) return; seen.add(key); count++; emit({ type: 'item', scanId, item }) }
    void (async () => {
      try {
        if (detectPlatform(url) === 'instagram') await this.scanInstagram(url, request.cookieSource, scanId, emit, onItem)
        else await this.scanYtDlp(url, request.cookieSource, scanId, emit, onItem)
        emit({ type: 'done', scanId, count })
      } catch (error) { emit({ type: 'error', scanId, message: error instanceof Error ? error.message : String(error) }) }
      finally { this.scanProcess = undefined }
    })()
    return { scanId }
  }
  stop() { this.scanProcess?.kill('SIGTERM'); this.scanProcess = undefined }
  private async scanYtDlp(url: string, source: CookieSource, scanId: string, emit: (e: ScanEvent) => void, onItem: (i: MediaItem) => void) {
    const tool = await this.tools.resolve('yt-dlp'); if (!tool) throw new Error('未找到 yt-dlp，请先安装运行工具。')
    emit({ type: 'status', scanId, message: '正在读取频道或播放列表…' })
    await this.stream(tool, ['--flat-playlist', '--dump-json', '--yes-playlist', '--no-warnings', ...cookieArgs(source), url], line => {
      const raw = JSON.parse(line); onItem(mediaFromYtDlp(raw, raw.url || url, String(raw.playlist_title || raw.channel || '合集')))
    })
  }
  private async scanInstagram(url: string, source: CookieSource, scanId: string, emit: (e: ScanEvent) => void, onItem: (i: MediaItem) => void) {
    const tool = await this.tools.resolve('gallery-dl'); if (!tool) throw new Error('Instagram 主页扫描需要 gallery-dl，请先点击“安装/更新工具”。')
    const base = url.replace(/\/$/, ''); const username = new URL(base).pathname.split('/').filter(Boolean)[0] || 'Instagram'
    for (const section of ['posts', 'reels']) {
      emit({ type: 'status', scanId, message: `正在扫描 ${section === 'posts' ? '帖子' : 'Reels'}…` })
      const args = ['-j', ...(source === 'none' ? [] : ['--cookies-from-browser', source]), `${base}/${section}/`]
      await this.stream(tool, args, line => {
        const parsed = JSON.parse(line) as unknown
        const tuple = Array.isArray(parsed) ? parsed : []
        const data = (tuple[2] && typeof tuple[2] === 'object' ? tuple[2] : {}) as Record<string, unknown>
        const directUrl = String(data.video_url || tuple[1] || '')
        if (!directUrl || (!data.video_url && !/\.mp4(?:\?|$)/i.test(directUrl))) return
        const shortcode = String(data.shortcode || data.post_shortcode || data.media_id || randomUUID())
        onItem({ id: shortcode, sourceUrl: directUrl, platform: 'instagram', title: String(data.description || `Instagram 视频 ${shortcode}`).slice(0, 160), uploader: String(data.username || username), duration: Number(data.duration || 0), thumbnail: String(data.display_url || ''), publishedAt: String(data.date || data.post_date || ''), selected: true, kind: 'video', collection: username })
      })
    }
  }
  private stream(command: string, args: string[], onLine: (line: string) => void) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true }); this.scanProcess = child; let buffer = '', error = ''
      child.stdout.on('data', chunk => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; for (const line of lines) if (line.trim()) { try { onLine(line) } catch { /* ignore non-json chatter */ } } })
      child.stderr.on('data', d => error += d)
      child.on('close', code => { if (buffer.trim()) { try { onLine(buffer) } catch {} } code === 0 || code === null ? resolve() : reject(new Error(classifyError(error))) })
      child.on('error', reject)
    })
  }
}
