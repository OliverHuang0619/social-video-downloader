import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { detectPlatform, mediaFromYtDlp, normalizeUrls } from '../shared/core'
import type { AnalyzeRequest, CookieSource, MediaItem, ScanEvent, ScanRequest } from '../shared/types'
import type { ToolManager } from './tools'

function cookieArgs(source: CookieSource) {
  if (source === 'none') return []
  return ['--cookies', process.env.SVD_COOKIES_FILE || '/config/cookies.txt']
}
export function youtubeCookieArgs(source: CookieSource) {
  const runtimeArgs = ['--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=default,web_embedded']
  return source === 'none' ? runtimeArgs : [...cookieArgs(source), ...runtimeArgs]
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
export function classifyError(error: string) {
  const value = error.trim()
  if (/page needs to be reloaded|reload (?:the )?page|try again later|temporary error/i.test(value)) return 'YouTube 页面暂时异常，自动重试后仍无法解析。请稍后重试，或更新服务器 Cookie。'
  if (/cookies|login|sign in|authentication/i.test(value)) return '需要有效的登录 Cookie，请挂载 cookies.txt 并在设置中启用。'
  if (/429|rate.?limit|too many/i.test(value)) return '平台请求过于频繁，请稍后重试或启用服务器 Cookie。'
  if (/private|not available|unavailable/i.test(value)) return '该内容不可用、为私密内容或受到地区限制。'
  return value.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') || '解析失败'
}

export function youtubeAttemptSources(source: CookieSource): CookieSource[] {
  return source === 'file' ? ['file', 'none'] : ['none', 'none']
}

async function collectYoutubeMetadata(command: string, url: string, source: CookieSource) {
  const attempts = youtubeAttemptSources(source)
  let lastError: Error | undefined
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      return await collect(command, ['--dump-single-json', '--no-warnings', '--no-playlist', ...youtubeCookieArgs(attempts[index]), url])
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const transient = /页面暂时异常|page needs to be reloaded|reload (?:the )?page|try again later|temporary error/i.test(lastError.message)
      // With a cookie file, retry public extraction without it because stale or
      // region-bound YouTube cookies can make an otherwise public video fail.
      if (index + 1 >= attempts.length || (source === 'none' && !transient)) throw lastError
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw lastError || new Error('解析失败')
}

export function mediaFromGalleryDlLine(line: string, username: string): MediaItem | undefined {
  const parsed = JSON.parse(line) as unknown
  const tuple = Array.isArray(parsed) ? parsed : []
  if (tuple[0] === -1) {
    const failure = tuple[1] && typeof tuple[1] === 'object' ? tuple[1] as Record<string, unknown> : {}
    throw new Error(String(failure.message || failure.error || 'Instagram 扫描失败'))
  }
  const data = (tuple[2] && typeof tuple[2] === 'object' ? tuple[2] : {}) as Record<string, unknown>
  const directUrl = String(data.video_url || tuple[1] || '')
  const extension = String(data.extension || '').toLowerCase()
  if (!directUrl || (!data.video_url && extension !== 'mp4' && !/\.mp4(?:\?|$)/i.test(directUrl))) return undefined
  const shortcode = String(data.shortcode || data.post_shortcode || data.media_id || randomUUID())
  return { id: shortcode, sourceUrl: directUrl, platform: 'instagram', title: String(data.description || `Instagram 视频 ${shortcode}`).slice(0, 160), uploader: String(data.username || username), duration: Number(data.duration || 0), thumbnail: String(data.display_url || data.thumbnail_url || ''), publishedAt: String(data.date || data.post_date || ''), selected: true, kind: 'video', collection: username, formats: [{ id: 'best', selector: 'best', kind: 'video-audio', ext: 'mp4', quickTimeCompatible: false }], selectedFormatId: 'best' }
}

class LimitReachedError extends Error {
  constructor() { super('limit') }
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
        const output = detectPlatform(url) === 'youtube'
          ? await collectYoutubeMetadata(ytdlp, url, request.cookieSource)
          : await collect(ytdlp, ['--dump-single-json', '--no-warnings', '--no-playlist', ...cookieArgs(request.cookieSource), url])
        results[index] = mediaFromYtDlp(JSON.parse(output), url)
      }
    }))
    return results
  }
  async scan(request: ScanRequest, report: (event: ScanEvent) => void) {
    const [url] = normalizeUrls(request.url); const scanId = randomUUID(); const seen = new Set<string>(); let count = 0
    const emit = report
    const onItem = (item: MediaItem) => {
      const key = `${item.platform}:${item.id}`
      if (seen.has(key)) return
      seen.add(key)
      count++
      emit({ type: 'item', scanId, item })
      if (request.limit && count >= request.limit) throw new LimitReachedError()
    }
    void (async () => {
      try {
        if (detectPlatform(url) === 'instagram') await this.scanInstagram(url, request.cookieSource, scanId, emit, onItem, true)
        else await this.scanYtDlp(url, request.cookieSource, scanId, emit, onItem, request.limit, true)
        emit({ type: 'done', scanId, count })
      } catch (error) {
        if (error instanceof LimitReachedError) emit({ type: 'done', scanId, count })
        else emit({ type: 'error', scanId, message: error instanceof Error ? error.message : String(error) })
      }
      finally { this.scanProcess = undefined }
    })()
    return { scanId }
  }
  /** Blocking shallow/full scan for subscription baseline and polls (does not steal the UI scanProcess). */
  async collectScan(request: ScanRequest): Promise<MediaItem[]> {
    const [url] = normalizeUrls(request.url)
    const items: MediaItem[] = []
    const seen = new Set<string>()
    const onItem = (item: MediaItem) => {
      const key = `${item.platform}:${item.id}`
      if (seen.has(key)) return
      seen.add(key)
      items.push(item)
      if (request.limit && items.length >= request.limit) throw new LimitReachedError()
    }
    try {
      if (detectPlatform(url) === 'instagram') await this.scanInstagram(url, request.cookieSource, 'collect', () => undefined, onItem, false)
      else await this.scanYtDlp(url, request.cookieSource, 'collect', () => undefined, onItem, request.limit, false)
    } catch (error) {
      if (!(error instanceof LimitReachedError)) throw error
    }
    return items
  }
  stop() { this.scanProcess?.kill('SIGTERM'); this.scanProcess = undefined }
  private async scanYtDlp(url: string, source: CookieSource, scanId: string, emit: (e: ScanEvent) => void, onItem: (i: MediaItem) => void, limit?: number, track = true) {
    const tool = await this.tools.resolve('yt-dlp'); if (!tool) throw new Error('未找到 yt-dlp，请先安装运行工具。')
    emit({ type: 'status', scanId, message: '正在读取频道或播放列表…' })
    const args = ['--flat-playlist', '--dump-json', '--yes-playlist', '--no-warnings', ...youtubeCookieArgs(source)]
    if (limit && limit > 0) args.push('--playlist-end', String(limit))
    args.push(url)
    await this.stream(tool, args, line => {
      const raw = JSON.parse(line); onItem(mediaFromYtDlp(raw, raw.url || url, String(raw.playlist_title || raw.channel || '合集')))
    }, track)
  }
  private async scanInstagram(url: string, source: CookieSource, scanId: string, emit: (e: ScanEvent) => void, onItem: (i: MediaItem) => void, track = true) {
    const tool = await this.tools.resolve('gallery-dl'); if (!tool) throw new Error('Instagram 主页扫描需要 gallery-dl，请先点击“安装/更新工具”。')
    const base = url.replace(/\/$/, ''); const username = new URL(base).pathname.split('/').filter(Boolean)[0] || 'Instagram'
    // Instagram's posts feed already contains regular video posts and Reels.
    // Scanning /reels/ again only repeats pagination and makes completion appear stuck.
    emit({ type: 'status', scanId, message: '正在扫描帖子和 Reels…' })
    const args = ['-j', '-o', 'output.jsonl=true', ...cookieArgs(source), `${base}/posts/`]
    await this.stream(tool, args, line => {
      const item = mediaFromGalleryDlLine(line, username)
      if (item) onItem(item)
    }, track)
  }
  private stream(command: string, args: string[], onLine: (line: string) => void, track = true) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true }); if (track) this.scanProcess = child; let buffer = '', error = '', callbackError: Error | undefined
      const processLine = (line: string) => {
        if (!line.trim() || callbackError) return
        try { onLine(line) } catch (value) {
          callbackError = value instanceof Error ? value : new Error(String(value))
          child.kill('SIGTERM')
        }
      }
      child.stdout.on('data', chunk => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; for (const line of lines) processLine(line) })
      child.stderr.on('data', d => error += d)
      child.on('close', code => {
        if (buffer.trim()) processLine(buffer)
        if (callbackError instanceof LimitReachedError) resolve()
        else if (callbackError) reject(callbackError)
        else if (code === 0 || code === null) resolve()
        else reject(new Error(classifyError(error)))
      })
      child.on('error', reject)
    })
  }
}
