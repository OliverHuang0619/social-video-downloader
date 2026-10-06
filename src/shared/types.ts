export type Platform = 'youtube' | 'instagram' | 'other'
export type MediaKind = 'video' | 'audio'
export type JobStatus = 'queued' | 'downloading' | 'completed' | 'skipped' | 'failed' | 'cancelled'
export type CookieSource = 'none' | 'file'
export type MediaFormatKind = 'video-audio' | 'video-only' | 'audio-only'
export type ProcessingState = 'unprocessed' | 'processed'
export type AnalysisJobStatus = 'queued' | 'preparing' | 'analyzing' | 'completed' | 'failed' | 'cancelled'
export type PublishJobStatus = 'queued' | 'waiting_local' | 'launching' | 'waiting_login' | 'uploading' | 'scheduling' | 'waiting_covers' | 'submitting' | 'published' | 'scheduled' | 'failed' | 'needs_login' | 'needs_attention' | 'interrupted' | 'cancelled'
export type RemakeJobStatus = 'queued' | 'preparing' | 'directing' | 'building' | 'completed' | 'failed' | 'cancelled'

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
  /** Output size of the QuickTime re-encode: keep the source resolution, or cap the longer edge at 1080p / 720p. */
  quickTimeQuality?: QuickTimeQuality
}

export type QuickTimeQuality = 'original' | '1080' | '720'

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

export interface MediaFileHash { algorithm: 'sha256'; hash: string; size: number; modifiedAt: string }
export interface MediaFileMetadata { size: number; duration?: number; modifiedAt: string }
export interface LocalFileActionsStatus { reveal: boolean; airdrop: boolean }

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

export interface RemakeJob {
  id: string
  status: RemakeJobStatus
  assetIds: string[]
  mode: 'editable' | 'render'
  direction: string
  budget?: string
  progress: number
  message: string
  projectDir: string
  outputs: string[]
  logs: AnalysisLogEntry[]
  error?: string
  createdAt: string
  updatedAt: string
}

export interface PublishJob {
  id: string
  batchId: string
  assetId: string
  /** `douyin` uses the built-in publisher. Other ids come from the MultiPost video catalog. */
  platform: string
  title: string
  topics: string[]
  publishAt?: string
  executeAt?: string
  submitAt?: string
  aigc: boolean
  waitForCovers: boolean
  status: PublishJobStatus
  error?: string
  screenshot?: string
}

export interface PublishBatch {
  id: string
  dispatchMode: 'platform' | 'local'
  status: 'queued' | 'waiting_local' | 'running' | 'completed' | 'partial' | 'failed' | 'needs_attention' | 'interrupted' | 'cancelled'
  createdAt: string
  updatedAt: string
  jobs: PublishJob[]
}

export interface AuthStatus { authenticated: boolean; csrfToken?: string }
export interface CodexUsageWindow { usedPercent: number; remainingPercent: number; windowDurationMins?: number; resetsAt?: number }
export interface CodexUsageStatus { planType?: string; ordinaryUsageAllowed?: boolean; limits: Array<{ id: string; name?: string; primary?: CodexUsageWindow; secondary?: CodexUsageWindow }> }
export type CodexConnectionMode = 'official' | 'provider' | 'cc_switch'
export type CodexProviderTemplate = 'tencent_token_plan' | 'custom'
export interface CodexProvider {
  id: string
  name: string
  template?: CodexProviderTemplate
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort?: string
  wireApi: 'responses'
  requiresOpenaiAuth: boolean
}
export interface CodexConnectionConfig {
  mode: CodexConnectionMode
  activeProviderId?: string
  ccSwitchBaseUrl: string
  ccSwitchModel?: string
  ccSwitchReasoningEffort?: string
  providers: CodexProvider[]
}
export interface CodexProviderPublic extends Omit<CodexProvider, 'apiKey'> {
  apiKeyMasked: string
  apiKeyConfigured: boolean
}
export interface CodexConnectionPublic {
  mode: CodexConnectionMode
  activeProviderId?: string
  ccSwitchBaseUrl: string
  ccSwitchModel?: string
  ccSwitchReasoningEffort?: string
  providers: CodexProviderPublic[]
}
export interface CodexConnectionTestResult { ok: boolean; message: string }
export interface HypitConfig {
  baseUrl: string
  apiKey: string
}
export interface HypitConfigPublic {
  baseUrl: string
  apiKeyMasked: string
  apiKeyConfigured: boolean
}
export interface HypitStatus extends HypitConfigPublic {
  available: boolean
  version?: string
  path?: string
  packageName: string
  busy: boolean
  message: string
  skillFile?: string
  skillAvailable: boolean
}
export interface CodexStatus {
  available: boolean
  authenticated: boolean
  busy: boolean
  message: string
  model: string
  reasoningEffort: string
  mode: CodexConnectionMode
  connection?: CodexConnectionPublic
  usage?: CodexUsageStatus
  usageUnavailable?: boolean
  loginOutput?: string
  loginUrl?: string
  loginCode?: string
}
export interface BrowserStatus { ready: boolean; mode: 'container' | 'host'; loginStatus: 'unknown' | 'ready' | 'needs_login' | 'needs_attention'; message: string; remoteUrl: string; manageUrl: string }
export type CookiePlatform = 'youtube' | 'instagram'
export interface PlatformCookieStatus { status: 'idle' | 'opening' | 'waiting_login' | 'saving' | 'ready' | 'error'; running: boolean; message: string; cookieCount?: number; updatedAt?: string }
export interface CookieManagerStatus { platforms: Record<CookiePlatform, PlatformCookieStatus>; runningPlatform?: CookiePlatform }
export interface CookieEntrySummary { platform: CookiePlatform | 'other'; domain: string; path: string; name: string; expires?: number; secure: boolean; httpOnly: boolean }
export interface CookieFileView { entries: CookieEntrySummary[]; updatedAt?: string; raw?: string }

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
export interface ScanRequest { url: string; cookieSource: CookieSource; limit?: number }
export interface StartRequest { items: MediaItem[]; options: DownloadOptions }

export interface CreatorSubscription {
  id: string
  platform: Platform
  sourceUrl: string
  displayName: string
  autoDownload: boolean
  enabled: boolean
  lastPolledAt?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface SubscriptionNotification {
  id: string
  subscriptionId: string
  mediaKey: string
  title: string
  sourceUrl: string
  thumbnail?: string
  downloadJobId?: string
  readAt?: string
  createdAt: string
  /** Joined for UI convenience */
  displayName?: string
  platform?: Platform
}

export interface SubscriptionSchedule {
  enabled: boolean
  hour: number
  minute: number
  lastPollAt?: string
  nextPollAt?: string
  polling: boolean
}

export interface SubscriptionStatus {
  schedule: SubscriptionSchedule
  unreadCount: number
}

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
