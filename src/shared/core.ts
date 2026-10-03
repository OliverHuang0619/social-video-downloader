import type { DownloadOptions, MediaAsset, MediaFormat, MediaItem, Platform, ProcessingState } from './types'

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

export type LibraryStateFilter = ProcessingState | 'awaiting-analysis' | 'all'

export function mediaAssetDirectory(file: string): string {
  const normalized = file.replace(/\\/g, '/').replace(/\/+$/, '')
  const separator = normalized.lastIndexOf('/')
  return separator > 0 ? normalized.slice(0, separator) : '.'
}

export function filterMediaAssets(assets: MediaAsset[], state: LibraryStateFilter, category: string, query: string, directory = 'all'): MediaAsset[] {
  const needle = query.toLocaleLowerCase()
  return assets.filter(asset =>
    (state === 'all' || (state === 'awaiting-analysis' ? !asset.analysis : asset.processingState === state && (state !== 'unprocessed' || Boolean(asset.analysis)))) &&
    (category === 'all' || asset.analysis?.category === category) &&
    (directory === 'all' || mediaAssetDirectory(asset.file) === directory) &&
    (!needle || [asset.filename, asset.analysis?.title, asset.analysis?.englishTitle, asset.analysis?.summary, ...(asset.analysis?.keyTopics || [])].some(value => value?.toLocaleLowerCase().includes(needle)))
  )
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

export function buildFormatArgs(options: DownloadOptions, item?: MediaItem): string[] {
  const selected = item?.formats?.find(format => format.id === item.selectedFormatId)
  // A scanned Instagram item is already a direct MP4 URL with one available stream.
  if (item?.platform === 'instagram' && selected?.id === 'best') return []
  if (selected && /^[\w.-]+(?:\+[\w.-]+)?$/.test(selected.selector)) {
    const container = selected.ext === 'webm' ? 'webm' : 'mp4'
    return ['-f', selected.selector, '--merge-output-format', container]
  }
  if (options.mode === 'audio') {
    return ['-x', '--audio-format', options.audioFormat, '--audio-quality', `${options.audioBitrate}K`]
  }
  const height = options.quality === 'best' ? '' : `[height<=${options.quality}]`
  const format = `bestvideo${height}+bestaudio/best${height}`
  return ['-f', format, '--merge-output-format', options.container]
}

const isNone = (value: unknown) => !value || value === 'none'
const number = (value: unknown) => Number(value) || undefined
const quickTimeVideo = (codec?: string) => Boolean(codec && /^(?:avc1|h264)/i.test(codec))
const quickTimeAudio = (codec?: string) => Boolean(codec && /^(?:mp4a|aac)/i.test(codec))

export function formatsFromYtDlp(raw: Record<string, unknown>): MediaFormat[] {
  const source = Array.isArray(raw.formats) ? raw.formats.filter(value => value && typeof value === 'object') as Record<string, unknown>[] : []
  const direct = source.flatMap<MediaFormat>(format => {
    const hasVideo = !isNone(format.vcodec)
    const hasAudio = !isNone(format.acodec)
    if (!hasVideo && !hasAudio) return []
    const kind = hasVideo && hasAudio ? 'video-audio' : hasVideo ? 'video-only' : 'audio-only'
    const ext = String(format.ext || (hasVideo ? 'mp4' : 'm4a')).toLowerCase()
    const videoCodec = hasVideo ? String(format.vcodec) : undefined
    const audioCodec = hasAudio ? String(format.acodec) : undefined
    return [{
      id: String(format.format_id), selector: String(format.format_id), kind, ext,
      width: number(format.width), height: number(format.height), fps: number(format.fps), bitrate: number(format.abr || format.tbr), videoCodec, audioCodec,
      filesize: number(format.filesize || format.filesize_approx),
      quickTimeCompatible: (!hasVideo || quickTimeVideo(videoCodec)) && (!hasAudio || quickTimeAudio(audioCodec)) && ['mp4', 'm4a'].includes(ext)
    }]
  })
  const audio = direct.filter(format => format.kind === 'audio-only').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0) || (b.filesize || 0) - (a.filesize || 0))
  const merged = direct.filter(format => format.kind === 'video-only').flatMap<MediaFormat>(video => {
    const preferred = audio.find(item => video.ext === 'webm' ? item.ext === 'webm' : ['m4a', 'mp4'].includes(item.ext)) || audio[0]
    if (!preferred) return []
    const ext = video.ext === 'webm' ? 'webm' : 'mp4'
    return [{ ...video, id: `${video.id}+${preferred.id}`, selector: `${video.selector}+${preferred.selector}`, kind: 'video-audio', ext, audioCodec: preferred.audioCodec, filesize: (video.filesize || 0) + (preferred.filesize || 0) || undefined, quickTimeCompatible: quickTimeVideo(video.videoCodec) && quickTimeAudio(preferred.audioCodec) && ext === 'mp4' }]
  })
  const rank = { 'video-audio': 0, 'video-only': 1, 'audio-only': 2 }
  return [...direct, ...merged].sort((a, b) => rank[a.kind] - rank[b.kind] || (b.height || 0) - (a.height || 0) || (b.filesize || 0) - (a.filesize || 0))
}

export function mediaFromYtDlp(raw: Record<string, unknown>, fallbackUrl: string, collection?: string): MediaItem {
  const url = String(raw.webpage_url || raw.url || fallbackUrl)
  const formats = formatsFromYtDlp(raw)
  const selectedFormatId = formats.find(format => format.kind === 'video-audio' && format.quickTimeCompatible)?.id || formats.find(format => format.kind === 'video-audio')?.id || formats[0]?.id
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
    collection,
    formats,
    selectedFormatId
  }
}
