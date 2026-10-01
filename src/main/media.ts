import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { detectPlatform, mediaFromYtDlp, normalizeUrls } from '../shared/core'
import type { AnalyzeRequest, CookieSource, MediaItem, ScanEvent, ScanRequest } from '../shared/types'
import type { ToolManager } from './tools'

function cookieArgs(source: CookieSource) {
  if (source === 'none') return []
  return ['--cookies', process.env.SVD_COOKIES_FILE || '/config/cookies.txt']
}
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
  if (/cookies|login|sign in|authentication/i.test(value)) return '需要有效的登录 Cookie，请挂载 cookies.txt 并在设置中启用。'
  if (/429|rate.?limit|too many/i.test(value)) return '平台请求过于频繁，请稍后重试或启用服务器 Cookie。'
  if (/private|not available|unavailable/i.test(value)) return '该内容不可用、为私密内容或受到地区限制。'
  return value.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') || '解析失败'
}

export class MediaService {
  private scanProcess?: ChildProcessWithoutNullStreams
  constructor(private tools: ToolManager) {}
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
  async scan(request: ScanRequest, report: (event: ScanEvent) => void) {
    const [url] = normalizeUrls(request.url); const scanId = randomUUID(); const seen = new Set<string>(); let count = 0
    const emit = report
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
      const args = ['-j', ...cookieArgs(source), `${base}/${section}/`]
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
