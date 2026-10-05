import type { AnalysisJob, AuthStatus, BrowserStatus, CodexConnectionPublic, CodexConnectionTestResult, CodexProviderPublic, CodexStatus, CookieFileView, CookieManagerStatus, CookiePlatform, DownloadJob, HypitStatus, MediaAsset, MediaFileHash, MediaFileMetadata, PublishBatch, RemakeJob, ScanEvent, ToolStatus, ToolUpdateEvent } from '../../shared/types'

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
    list: () => request<DownloadJob[]>('/api/downloads/jobs'), start: (value: import('../../shared/types').StartRequest) => post<DownloadJob[]>('/api/downloads/start', value), cancel: (id?: string) => post<void>('/api/downloads/cancel', { id }), retry: (id?: string) => post<{ count: number }>('/api/downloads/retry', id ? { id } : {}), fileUrl: (id: string) => `/api/downloads/${encodeURIComponent(id)}/file`,
  },
  library: {
    list: () => request<MediaAsset[]>('/api/library'), import: (directory: string) => post<{ count: number }>('/api/library/import', { directory }), remove: (ids: string[], deleteFiles: boolean) => post<{ count: number; deletedFiles: number; failed: string[] }>('/api/library/delete', { ids, deleteFiles }), state: (id: string, state: MediaAsset['processingState']) => post<MediaAsset>(`/api/library/${encodeURIComponent(id)}/state`, { state }), hash: (id: string) => request<MediaFileHash>(`/api/library/${encodeURIComponent(id)}/hash`), metadata: (id: string) => request<MediaFileMetadata>(`/api/library/${encodeURIComponent(id)}/metadata`), thumbnailUrl: (id: string) => `/api/library/${encodeURIComponent(id)}/thumbnail`, mediaUrl: (id: string) => `/api/library/${encodeURIComponent(id)}/media`, fileUrl: (id: string) => `/api/library/${encodeURIComponent(id)}/file`,
  },
  analysis: { list: () => request<AnalysisJob[]>('/api/analysis/jobs'), start: (assetIds: string[], force = false) => post<AnalysisJob>('/api/analysis/jobs', { assetIds, force }), cancel: (id: string) => post<void>(`/api/analysis/jobs/${id}/cancel`), retry: (id: string) => post<AnalysisJob>(`/api/analysis/jobs/${id}/retry`), delete: (id: string) => request<void>(`/api/analysis/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }), clearHistory: () => request<{ count: number }>('/api/analysis/jobs', { method: 'DELETE' }) },
  remakes: { list: () => request<RemakeJob[]>('/api/remakes'), start: (assetIds: string[], direction: string, mode: RemakeJob['mode'], budget?: string) => post<RemakeJob>('/api/remakes', { assetIds, direction, mode, budget }), cancel: (id: string) => post<void>(`/api/remakes/${encodeURIComponent(id)}/cancel`), retry: (id: string) => post<RemakeJob>(`/api/remakes/${encodeURIComponent(id)}/retry`), delete: (id: string) => request<void>(`/api/remakes/${encodeURIComponent(id)}`, { method: 'DELETE' }), clearHistory: () => request<{ count: number }>('/api/remakes', { method: 'DELETE' }) },
  hypit: {
    config: () => request<HypitStatus>('/api/hypit/config'),
    updateConfig: (value: { baseUrl?: string; apiKey?: string }) => request<HypitStatus>('/api/hypit/config', { method: 'PUT', body: JSON.stringify(value) }),
    install: () => post<HypitStatus>('/api/hypit/install'),
  },
  codex: {
    status: () => request<CodexStatus>('/api/codex/status'),
    login: () => post<CodexStatus>('/api/codex/login'),
    cancel: () => post<CodexStatus>('/api/codex/login/cancel'),
    logout: () => post<CodexStatus>('/api/codex/logout'),
    connection: () => request<CodexConnectionPublic>('/api/codex/connection'),
    updateConnection: (value: Partial<CodexConnectionPublic>) => request<CodexConnectionPublic>('/api/codex/connection', { method: 'PUT', body: JSON.stringify(value) }),
    createProvider: (value: Record<string, unknown>) => post<CodexProviderPublic>('/api/codex/providers', value),
    updateProvider: (id: string, value: Record<string, unknown>) => request<CodexProviderPublic>(`/api/codex/providers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(value) }),
    deleteProvider: (id: string) => request<CodexConnectionPublic>(`/api/codex/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    testConnection: (value: { mode?: CodexConnectionPublic['mode']; providerId?: string; ccSwitchBaseUrl?: string; ccSwitchModel?: string; baseUrl?: string; apiKey?: string } = {}) => post<CodexConnectionTestResult>('/api/codex/connection/test', value),
  },
  publisher: { status: () => request<BrowserStatus>('/api/publisher/status'), login: () => post<BrowserStatus>('/api/publisher/login'), jobs: () => request<PublishBatch[]>('/api/publisher/jobs'), publish: (value: unknown) => post<PublishBatch>('/api/publisher/publish', value), retry: (id: string) => post<void>(`/api/publisher/jobs/${id}/retry`), cancelBatch: (id: string) => post<void>(`/api/publisher/batches/${id}/cancel`), deleteBatch: (id: string) => request<void>(`/api/publisher/batches/${id}`, { method: 'DELETE' }) },
}

export type WorkbenchEvent = { type: 'downloads'; jobs: DownloadJob[] } | { type: 'creator'; event: ScanEvent } | { type: 'tools'; event: ToolUpdateEvent } | { type: 'library' | 'analysis' | 'remake' | 'publisher' | 'codex'; at: string }
