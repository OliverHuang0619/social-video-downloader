export type Platform = 'youtube' | 'instagram' | 'other'
export type MediaKind = 'video' | 'audio'
export type JobStatus = 'queued' | 'downloading' | 'completed' | 'skipped' | 'failed' | 'cancelled'
export type CookieSource = 'none' | 'chrome' | 'edge' | 'brave' | 'firefox' | 'safari'

export interface MediaItem {
  id: string
  sourceUrl: string
  platform: Platform
  title: string
  uploader: string
  duration: number
  thumbnail: string
  publishedAt: string
  selected: boolean
  kind: 'video'
  collection?: string
}

export interface DownloadOptions {
  mode: MediaKind
  quality: 'best' | '2160' | '1440' | '1080' | '720' | '480'
  container: 'mp4' | 'mkv'
  audioFormat: 'mp3' | 'm4a'
  audioBitrate: '128' | '192' | '320'
  outputRoot: string
  cookieSource: CookieSource
}

export interface DownloadJob {
  id: string
  item: MediaItem
  options: DownloadOptions
  status: JobStatus
  progress: number
  speed?: string
  eta?: string
  detail?: string
  error?: string
  outputPath?: string
  attempts: number
}

export interface ToolInfo { name: 'yt-dlp' | 'gallery-dl' | 'ffmpeg'; available: boolean; path?: string; version?: string; managed: boolean; error?: string }
export interface ToolStatus { ready: boolean; tools: ToolInfo[] }
export type ToolName = ToolInfo['name']
export type ToolUpdatePhase = 'checking' | 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
export interface ToolUpdateEvent {
  tool: ToolName
  phase: ToolUpdatePhase
  progress: number | null
  message: string
  detail?: string
  receivedBytes?: number
  totalBytes?: number
  speedBytesPerSecond?: number
  etaSeconds?: number
}
export interface AnalyzeRequest { urls: string[]; cookieSource: CookieSource }
export interface ScanRequest { url: string; cookieSource: CookieSource }
export interface StartRequest { items: MediaItem[]; options: DownloadOptions }

export interface DownloaderApi {
  tools: { status(): Promise<ToolStatus>; update(): Promise<ToolStatus>; onProgress(cb: (event: ToolUpdateEvent) => void): () => void }
  thumbnails: { load(url: string): Promise<string | undefined> }
  source: { analyze(request: AnalyzeRequest): Promise<MediaItem[]> }
  creator: { scan(request: ScanRequest): Promise<{ scanId: string }>; stop(): Promise<void>; onProgress(cb: (event: ScanEvent) => void): () => void }
  destination: { pick(): Promise<string | null>; open(path: string): Promise<boolean>; current(): Promise<string> }
  downloads: { start(request: StartRequest): Promise<DownloadJob[]>; cancel(id?: string): Promise<void>; retry(id: string): Promise<void>; onProgress(cb: (jobs: DownloadJob[]) => void): () => void }
  app: { platform(): Promise<NodeJS.Platform> }
}

export type ScanEvent =
  | { type: 'item'; scanId: string; item: MediaItem }
  | { type: 'status'; scanId: string; message: string }
  | { type: 'done'; scanId: string; count: number }
  | { type: 'error'; scanId: string; message: string }
