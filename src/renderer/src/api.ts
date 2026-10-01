import type { DownloaderApi, DownloadJob, ScanEvent, ToolUpdateEvent } from '../../shared/types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `请求失败 (${response.status})`)
  return value as T
}
const post = <T>(url: string, value: unknown = {}) => request<T>(url, { method: 'POST', body: JSON.stringify(value) })

const toolListeners = new Set<(event: ToolUpdateEvent) => void>()
const scanListeners = new Set<(event: ScanEvent) => void>()
const downloadListeners = new Set<(jobs: DownloadJob[]) => void>()
const events = new EventSource('/api/events')
events.onmessage = message => {
  const value = JSON.parse(message.data)
  if (value.type === 'tools') toolListeners.forEach(listener => listener(value.event))
  if (value.type === 'creator') scanListeners.forEach(listener => listener(value.event))
  if (value.type === 'downloads') downloadListeners.forEach(listener => listener(value.jobs))
}
const subscribe = <T>(listeners: Set<(value: T) => void>, callback: (value: T) => void) => { listeners.add(callback); return () => listeners.delete(callback) }

export const downloader: DownloaderApi = {
  tools: { status: () => request('/api/tools'), update: () => post('/api/tools/update'), onProgress: callback => subscribe(toolListeners, callback) },
  source: { analyze: value => post('/api/source/analyze', value) },
  creator: { scan: value => post('/api/creator/scan', value), stop: () => post('/api/creator/stop'), onProgress: callback => subscribe(scanListeners, callback) },
  destination: { current: () => request('/api/destination') },
  downloads: {
    start: value => post('/api/downloads/start', value), cancel: id => post('/api/downloads/cancel', { id }), retry: id => post('/api/downloads/retry', { id }), fileUrl: id => `/api/downloads/${encodeURIComponent(id)}/file`,
    onProgress: callback => subscribe(downloadListeners, callback)
  }
}
