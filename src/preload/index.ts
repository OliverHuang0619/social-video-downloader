import { contextBridge, ipcRenderer } from 'electron'
import type { AnalyzeRequest, DownloadJob, DownloaderApi, ScanEvent, ScanRequest, StartRequest, ToolUpdateEvent } from '../shared/types'

const api: DownloaderApi = {
  tools: {
    status: () => ipcRenderer.invoke('tools:get-status'),
    update: () => ipcRenderer.invoke('tools:update'),
    onProgress: cb => { const listener = (_: Electron.IpcRendererEvent, event: ToolUpdateEvent) => cb(event); ipcRenderer.on('tools:update-progress', listener); return () => ipcRenderer.removeListener('tools:update-progress', listener) }
  },
  thumbnails: { load: (url: string) => ipcRenderer.invoke('thumbnail:load', url) },
  source: { analyze: (request: AnalyzeRequest) => ipcRenderer.invoke('source:analyze', request) },
  creator: {
    scan: (request: ScanRequest) => ipcRenderer.invoke('creator:scan', request), stop: () => ipcRenderer.invoke('creator:stop-scan'),
    onProgress: cb => { const listener = (_: Electron.IpcRendererEvent, event: ScanEvent) => cb(event); ipcRenderer.on('creator:scan-progress', listener); return () => ipcRenderer.removeListener('creator:scan-progress', listener) }
  },
  destination: { pick: () => ipcRenderer.invoke('destination:pick'), open: (value: string) => ipcRenderer.invoke('destination:open', value), current: () => ipcRenderer.invoke('destination:current') },
  downloads: {
    start: (request: StartRequest) => ipcRenderer.invoke('downloads:start', request), cancel: (id?: string) => ipcRenderer.invoke('downloads:cancel', id), retry: (id: string) => ipcRenderer.invoke('downloads:retry', id),
    onProgress: cb => { const listener = (_: Electron.IpcRendererEvent, jobs: DownloadJob[]) => cb(jobs); ipcRenderer.on('downloads:progress', listener); return () => ipcRenderer.removeListener('downloads:progress', listener) }
  },
  app: { platform: () => ipcRenderer.invoke('app:platform') }
}
contextBridge.exposeInMainWorld('downloader', api)
