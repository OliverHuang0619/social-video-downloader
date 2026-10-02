export type Platform = 'youtube' | 'instagram' | 'other'
export type MediaKind = 'video' | 'audio'
export type JobStatus = 'queued' | 'downloading' | 'completed' | 'skipped' | 'failed' | 'cancelled'
export type CookieSource = 'none' | 'file'
export type MediaFormatKind = 'video-audio' | 'video-only' | 'audio-only'
export type ProcessingState = 'unprocessed' | 'processed'
export type AnalysisJobStatus = 'queued' | 'preparing' | 'analyzing' | 'completed' | 'failed' | 'cancelled'
export type PublishJobStatus = 'queued' | 'waiting_local' | 'launching' | 'uploading' | 'scheduling' | 'submitting' | 'published' | 'scheduled' | 'failed' | 'needs_login' | 'needs_attention' | 'interrupted'

export interface MediaFormat {
  id: string
  selector: string
  kind: MediaFormatKind
  ext: string
  width?: number
  height?: number
  fps?: number
  bitrate?: number
  videoCodec?: string
  audioCodec?: string
  filesize?: number
  quickTimeCompatible: boolean
}

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
  formats?: MediaFormat[]
  selectedFormatId?: string
}

export interface DownloadOptions {
  mode: MediaKind
  quality: 'best' | '2160' | '1440' | '1080' | '720' | '480'
  container: 'mp4' | 'mkv'
  audioFormat: 'mp3' | 'm4a'
  audioBitrate: '128' | '192' | '320'
  outputRoot: string
  cookieSource: CookieSource
  quickTimeCompatible: boolean
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
  assetId?: string
}

export interface AnalysisResult {
  title: string
  englishTitle: string
  category: string
  keyTopics: string[]
  summary: string
  confidence: 'high' | 'medium' | 'low'
  evidenceNote: string
}

export interface AnalysisLogEntry {
  at: string
  stage: 'queue' | 'prepare' | 'codex' | 'validate' | 'complete'
  level: 'info' | 'command' | 'result' | 'error'
  message: string
}

export interface MediaAsset {
  id: string
  file: string
  filename: string
  sourceUrl?: string
  platform?: Platform
  uploader?: string
  duration?: number
  thumbnail?: string
  publishedAt?: string
  processingState: ProcessingState
  analysis?: AnalysisResult
  createdAt: string
  updatedAt: string
}

export interface AnalysisJob {
  id: string
  status: AnalysisJobStatus
  assetIds: string[]
  progress: number
  message: string
  currentItem?: string
  processedItems: number
  totalItems: number
  logs: AnalysisLogEntry[]
  error?: string
  createdAt: string
  updatedAt: string
}

export interface PublishJob {
  id: string
  batchId: string
  assetId: string
  title: string
  topics: string[]
  publishAt?: string
  executeAt?: string
  aigc: boolean
  status: PublishJobStatus
  error?: string
  screenshot?: string
}

export interface PublishBatch {
  id: string
  dispatchMode: 'platform' | 'local'
  status: 'queued' | 'waiting_local' | 'running' | 'completed' | 'partial' | 'failed' | 'needs_attention' | 'interrupted'
  createdAt: string
  updatedAt: string
  jobs: PublishJob[]
}

export interface AuthStatus { authenticated: boolean; csrfToken?: string }
export interface CodexUsageWindow { usedPercent: number; remainingPercent: number; windowDurationMins?: number; resetsAt?: number }
export interface CodexUsageStatus { planType?: string; ordinaryUsageAllowed?: boolean; limits: Array<{ id: string; name?: string; primary?: CodexUsageWindow; secondary?: CodexUsageWindow }> }
export interface CodexStatus { available: boolean; authenticated: boolean; busy: boolean; message: string; model: string; reasoningEffort: string; usage?: CodexUsageStatus; usageUnavailable?: boolean; loginOutput?: string; loginUrl?: string; loginCode?: string }
export interface BrowserStatus { ready: boolean; mode: 'container' | 'host'; loginStatus: 'unknown' | 'ready' | 'needs_login' | 'needs_attention'; message: string; remoteUrl: string; manageUrl: string }

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
  source: { analyze(request: AnalyzeRequest): Promise<MediaItem[]> }
  creator: { scan(request: ScanRequest): Promise<{ scanId: string }>; stop(): Promise<void>; onProgress(cb: (event: ScanEvent) => void): () => void }
  destination: { current(): Promise<string> }
  downloads: { start(request: StartRequest): Promise<DownloadJob[]>; cancel(id?: string): Promise<void>; retry(id: string): Promise<void>; fileUrl(id: string): string; onProgress(cb: (jobs: DownloadJob[]) => void): () => void }
}

export type ScanEvent =
  | { type: 'item'; scanId: string; item: MediaItem }
  | { type: 'status'; scanId: string; message: string }
  | { type: 'done'; scanId: string; count: number }
  | { type: 'error'; scanId: string; message: string }
