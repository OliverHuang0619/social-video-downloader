import type { AnalysisJob, AuthStatus, BrowserStatus, CodexStatus, CookieFileView, CookieManagerStatus, CookiePlatform, DownloadJob, MediaAsset, PublishBatch, ScanEvent, ToolStatus, ToolUpdateEvent } from '../../shared/types'

let csrfToken = ''
let events: EventSource | undefined
const listeners = new Set<(event: { type: string; [key: string]: unknown }) => void>()

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const mutating = init?.method && !['GET', 'HEAD'].includes(init.method)
  const response = await fetch(url, { ...init, headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(mutating && csrfToken ? { 'x-csrf-token': csrfToken } : {}), ...init?.headers } })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(value.error || `请求失败 (${response.status})`)
  return value as T
}
const post = <T>(url: string, value: unknown = {}) => request<T>(url, { method: 'POST', body: JSON.stringify(value) })

function connectEvents() {
  events?.close(); events = new EventSource('/api/events')
  events.onmessage = message => { const value = JSON.parse(message.data); listeners.forEach(listener => listener(value)) }
}
export function onEvent(listener: (event: { type: string; [key: string]: unknown }) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }

export const api = {
  auth: {
    async session() { const value = await request<AuthStatus>('/api/auth/session'); csrfToken = value.csrfToken || ''; if (value.authenticated) connectEvents(); return value },
    async login(password: string) { const value = await post<AuthStatus>('/api/auth/login', { password }); csrfToken = value.csrfToken || ''; connectEvents(); return value },
    async logout() { const value = await post<AuthStatus>('/api/auth/logout'); csrfToken = ''; events?.close(); return value },
  },
  tools: { status: () => request<ToolStatus>('/api/tools'), update: () => post<ToolStatus>('/api/tools/update') },
  cookies: {
    status: () => request<CookieManagerStatus>('/api/cookies/status'),
    update: (platform: CookiePlatform) => post<CookieManagerStatus>('/api/cookies/update', { platform }),
    manual: (platform: CookiePlatform, contents: string) => post<CookieManagerStatus>('/api/cookies/manual', { platform, contents }),
    view: (reveal = false) => request<CookieFileView>(`/api/cookies/view${reveal ? '?reveal=true' : ''}`),
  },
  source: { analyze: (urls: string[], cookieSource: 'none' | 'file') => post<import('../../shared/types').MediaItem[]>('/api/source/analyze', { urls, cookieSource }) },
  creator: { scan: (url: string, cookieSource: 'none' | 'file') => post<{ scanId: string }>('/api/creator/scan', { url, cookieSource }), stop: () => post<void>('/api/creator/stop') },
  destination: { current: () => request<string>('/api/destination') },
  downloads: {
    list: () => request<DownloadJob[]>('/api/downloads/jobs'), start: (value: import('../../shared/types').StartRequest) => post<DownloadJob[]>('/api/downloads/start', value), cancel: (id?: string) => post<void>('/api/downloads/cancel', { id }), retry: (id: string) => post<void>('/api/downloads/retry', { id }), fileUrl: (id: string) => `/api/downloads/${encodeURIComponent(id)}/file`,
  },
  library: {
    list: () => request<MediaAsset[]>('/api/library'), import: (directory: string) => post<{ count: number }>('/api/library/import', { directory }), state: (id: string, state: MediaAsset['processingState']) => post<MediaAsset>(`/api/library/${encodeURIComponent(id)}/state`, { state }), thumbnailUrl: (id: string) => `/api/library/${encodeURIComponent(id)}/thumbnail`, mediaUrl: (id: string) => `/api/library/${encodeURIComponent(id)}/media`, fileUrl: (id: string) => `/api/library/${encodeURIComponent(id)}/file`,
  },
  analysis: { list: () => request<AnalysisJob[]>('/api/analysis/jobs'), start: (assetIds: string[], force = false) => post<AnalysisJob>('/api/analysis/jobs', { assetIds, force }), cancel: (id: string) => post<void>(`/api/analysis/jobs/${id}/cancel`), retry: (id: string) => post<AnalysisJob>(`/api/analysis/jobs/${id}/retry`), delete: (id: string) => request<void>(`/api/analysis/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }), clearHistory: () => request<{ count: number }>('/api/analysis/jobs', { method: 'DELETE' }) },
  codex: { status: () => request<CodexStatus>('/api/codex/status'), login: () => post<CodexStatus>('/api/codex/login'), cancel: () => post<CodexStatus>('/api/codex/login/cancel'), logout: () => post<CodexStatus>('/api/codex/logout') },
  publisher: { status: () => request<BrowserStatus>('/api/publisher/status'), login: () => post<BrowserStatus>('/api/publisher/login'), jobs: () => request<PublishBatch[]>('/api/publisher/jobs'), publish: (value: unknown) => post<PublishBatch>('/api/publisher/publish', value), retry: (id: string) => post<void>(`/api/publisher/jobs/${id}/retry`), deleteBatch: (id: string) => request<void>(`/api/publisher/batches/${id}`, { method: 'DELETE' }) },
}

export type WorkbenchEvent = { type: 'downloads'; jobs: DownloadJob[] } | { type: 'creator'; event: ScanEvent } | { type: 'tools'; event: ToolUpdateEvent } | { type: 'library' | 'analysis' | 'publisher' | 'codex'; at: string }
