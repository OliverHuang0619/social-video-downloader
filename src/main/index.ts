import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { electronApp, is } from '@electron-toolkit/utils'
import { ConfigStore } from './config'
import { ToolManager } from './tools'
import { MediaService } from './media'
import { DownloadQueue } from './queue'
import type { AnalyzeRequest, ScanRequest, StartRequest } from '../shared/types'

let mainWindow: BrowserWindow | null = null
const config = new ConfigStore(); const tools = new ToolManager(); const media = new MediaService(tools); const queue = new DownloadQueue(tools)

// Electron/V8 can SIGTRAP on macOS 26 arm64 while a network worker is compiling JIT code.
// This app is UI-light, so interpreter mode is an acceptable stability trade-off there.
if (process.platform === 'darwin' && Number(os.release().split('.')[0]) >= 25) app.commandLine.appendSwitch('js-flags', '--jitless')

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240, height: 820, minWidth: 900, minHeight: 640, show: false, backgroundColor: '#090d16',
    webPreferences: { preload: path.join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (is.dev && process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function registerIpc() {
  ipcMain.handle('tools:get-status', () => tools.status())
  ipcMain.handle('tools:update', (event) => tools.update(progress => {
    if (!event.sender.isDestroyed()) event.sender.send('tools:update-progress', progress)
  }))
  ipcMain.handle('thumbnail:load', (_event, url: string) => media.loadThumbnail(url))
  ipcMain.handle('source:analyze', (_e, request: AnalyzeRequest) => media.analyze(request))
  ipcMain.handle('creator:scan', (e, request: ScanRequest) => media.scan(request, e.sender))
  ipcMain.handle('creator:stop-scan', () => media.stop())
  ipcMain.handle('destination:current', () => config.get().outputRoot)
  ipcMain.handle('destination:pick', async () => { const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] }); if (result.canceled) return null; await config.patch({ outputRoot: result.filePaths[0] }); return result.filePaths[0] })
  ipcMain.handle('destination:open', async (_e, value: string) => !await shell.openPath(path.resolve(value)))
  ipcMain.handle('downloads:start', async (e, request: StartRequest) => { await config.patch({ outputRoot: request.options.outputRoot, cookieSource: request.options.cookieSource, options: { mode: request.options.mode, quality: request.options.quality, container: request.options.container, audioFormat: request.options.audioFormat, audioBitrate: request.options.audioBitrate } }); return queue.start(request, e.sender) })
  ipcMain.handle('downloads:cancel', (_e, id?: string) => queue.cancel(id))
  ipcMain.handle('downloads:retry', (_e, id: string) => queue.retry(id))
  ipcMain.handle('app:platform', () => process.platform)
}

app.whenReady().then(async () => { electronApp.setAppUserModelId('com.local.socialvideodownloader'); await config.load(); registerIpc(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() }) })
app.on('before-quit', () => { media.stop(); queue.shutdown() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
