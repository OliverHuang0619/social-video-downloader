import type { DownloadOptions, MediaItem, Platform } from './types'

const invalidFilename = /[<>:"/\\|?*\u0000-\u001F]/g

export function normalizeUrls(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(/[\n,]/)
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    const text = value.trim()
    if (!text) continue
    let parsed: URL
    try { parsed = new URL(text) } catch { throw new Error(`无效链接：${text}`) }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`不支持的链接协议：${parsed.protocol}`)
    parsed.hash = ''
    const url = parsed.toString()
    if (!seen.has(url)) { seen.add(url); result.push(url) }
  }
  return result
}

export function detectPlatform(url: string): Platform {
  const host = new URL(url).hostname.replace(/^www\./, '')
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube'
  if (host.endsWith('instagram.com')) return 'instagram'
  return 'other'
}

export function sanitizeFilename(name: string, max = 120): string {
  const cleaned = name.replace(invalidFilename, '_').replace(/[. ]+$/g, '').replace(/\s+/g, ' ').trim()
  return (cleaned || '未命名').slice(0, max)
}

export function buildFormatArgs(options: DownloadOptions): string[] {
  if (options.mode === 'audio') {
    return ['-x', '--audio-format', options.audioFormat, '--audio-quality', `${options.audioBitrate}K`]
  }
  const height = options.quality === 'best' ? '' : `[height<=${options.quality}]`
  const format = `bestvideo${height}+bestaudio/best${height}`
  return ['-f', format, '--merge-output-format', options.container]
}

export function mediaFromYtDlp(raw: Record<string, unknown>, fallbackUrl: string, collection?: string): MediaItem {
  const url = String(raw.webpage_url || raw.url || fallbackUrl)
  return {
    id: String(raw.id || `${detectPlatform(url)}-${Math.random().toString(36).slice(2)}`),
    sourceUrl: url,
    platform: detectPlatform(url),
    title: String(raw.title || '未命名视频'),
    uploader: String(raw.uploader || raw.channel || ''),
    duration: Number(raw.duration || 0),
    thumbnail: String(raw.thumbnail || ''),
    publishedAt: String(raw.upload_date || ''),
    selected: true,
    kind: 'video',
    collection
  }
}
