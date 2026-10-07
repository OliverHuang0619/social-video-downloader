import { createReadStream } from 'node:fs'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import httpProxy from 'http-proxy'
import { ConfigStore } from '../main/config'
import { ToolManager } from '../main/tools'
import { MediaService } from '../main/media'
import { DownloadQueue } from '../main/queue'
import type { AnalyzeRequest, CookiePlatform, ScanEvent, ScanRequest, StartRequest, ToolUpdateEvent } from '../shared/types'
import { AppDatabase } from './db'
import { AuthService } from './auth'
import { LibraryService } from './library'
import { CodexService } from './codex'
import { AnalysisService } from './analysis'
import { PublisherService } from './publisher'
import { YoutubeCookieService } from './youtube-cookies'
import { migrateLegacy } from './migration'
import { RemakeService } from './remake'
import { HypitConfigStore } from './hypit-config'
import { HypitCliService } from './hypit-cli'
import { SubscriptionService } from './subscriptions'
import { createLocalFileActions } from './local-files'
import { PushService } from './push'

type ServerEvent =
  | { type: 'tools'; event: ToolUpdateEvent }
  | { type: 'creator'; event: ScanEvent }
  | { type: 'downloads'; jobs: ReturnType<DownloadQueue['snapshot']> }
  | { type: 'library' | 'analysis' | 'remake' | 'publisher' | 'codex' | 'subscriptions'; at: string }

const clients = new Set<ServerResponse>()
const publish = (event: ServerEvent) => { const data = `data: ${JSON.stringify(event)}\n\n`; for (const client of clients) client.write(data) }
const changed = (type: 'library' | 'analysis' | 'remake' | 'publisher' | 'codex' | 'subscriptions') => publish({ type, at: new Date().toISOString() })
const config = new ConfigStore(), tools = new ToolManager(), media = new MediaService(tools), queue = new DownloadQueue(tools)
const db = new AppDatabase(), auth = new AuthService(db), library = new LibraryService(db), codex = new CodexService(() => changed('codex'))
const reportDownloads = (jobs: ReturnType<DownloadQueue['snapshot']>) => { void library.syncDownloads(jobs).then(() => changed('library')); publish({ type: 'downloads', jobs }) }
queue.setReporter(reportDownloads); queue.hydrate(db.downloads(), process.env.SVD_CLOUDFLARE_RUNTIME === '1')
const analysis = new AnalysisService(db, codex, () => changed('analysis'), id => library.resolvedFile(id)), publisher = new PublisherService(db, () => changed('publisher'), id => library.resolvedFile(id))
const hypitConfig = new HypitConfigStore()
const hypitCli = new HypitCliService(hypitConfig)
const remake = new RemakeService(db, library, codex, hypitConfig, () => changed('remake'))
const push = new PushService(db)
push.initialize()
const subscriptions = new SubscriptionService(db, media, queue, config, () => changed('subscriptions'), push)
const youtubeCookies = new YoutubeCookieService(), localFiles = createLocalFileActions()
const port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0'
function wakeBackgroundTasks() { queue.wake(); analysis.resumeQueued(); remake.resumeQueued(); publisher.wake() }
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client')
const browserProxy = httpProxy.createProxyServer({ target: process.env.SVD_BROWSER_VNC || 'http://browser:6080', ws: true })
browserProxy.on('error', (_error, _request, response) => { if ('writeHead' in response) { response.writeHead(502); response.end('远程浏览器不可用') } })

function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)) }
async function body<T>(request: IncomingMessage): Promise<T> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 2 * 1024 * 1024) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 }); chunks.push(chunk) } return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T }
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' }
function constantTimeEqual(actual: string, expected: string) { const actualBytes = Buffer.from(actual), expectedBytes = Buffer.from(expected); return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes) }
async function staticFile(requestPath: string, response: ServerResponse) { const decoded = decodeURIComponent(requestPath), candidate = path.resolve(clientDir, `.${decoded}`); let target = candidate.startsWith(`${clientDir}${path.sep}`) ? candidate : path.join(clientDir, 'index.html'); try { if (!(await stat(target)).isFile()) target = path.join(clientDir, 'index.html') } catch { target = path.join(clientDir, 'index.html') } response.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' }); createReadStream(target).pipe(response) }
async function libraryFiles(ids: unknown) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map(value => String(value)))].filter(Boolean)
  return Promise.all(unique.map(id => library.resolvedFile(id)))
}
async function downloadFile(id: string, request: IncomingMessage, response: ServerResponse) { const job = queue.get(id); if (!job || !['completed', 'skipped'].includes(job.status)) return json(response, 404, { error: '下载文件不存在' }); if (process.env.SVD_CLOUDFLARE_RUNTIME === '1' && job.assetId) return mediaResponse(job.assetId, request, response, true); if (!job.outputPath) return json(response, 404, { error: '下载文件不存在' }); const [root, file] = await Promise.all([realpath(config.get().outputRoot), realpath(job.outputPath)]); const relative = path.relative(root, file); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return json(response, 403, { error: '不允许访问该文件' }); const info = await stat(file), encodedName = encodeURIComponent(path.basename(file)); response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': info.size, 'content-disposition': `attachment; filename*=UTF-8''${encodedName}`, 'cache-control': 'private, no-store' }); createReadStream(file).pipe(response) }
async function mediaResponse(id: string, request: IncomingMessage, response: ServerResponse, attachment: boolean) { const url = await library.downloadUrl(id); if (url) { response.writeHead(302, { location: url, 'cache-control': 'private, no-store' }); response.end(); return }; return library.stream(id, request.headers.range, response, attachment) }

async function api(request: IncomingMessage, response: ServerResponse, url: URL) {
  const pathname = url.pathname
  if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { ok: true, database: true })
  if (request.method === 'POST' && pathname === '/api/internal/scheduler/tick') {
    const expected = process.env.SVD_INTERNAL_SCHEDULER_TOKEN || ''
    const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!expected || !constantTimeEqual(supplied, expected)) return json(response, 401, { error: 'Unauthorized' })
    wakeBackgroundTasks()
    return json(response, 200, await subscriptions.runScheduled())
  }
  if (request.method === 'POST' && pathname === '/api/internal/jobs/wake') {
    const expected = process.env.SVD_INTERNAL_SCHEDULER_TOKEN || ''
    const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!expected || !constantTimeEqual(supplied, expected)) return json(response, 401, { error: 'Unauthorized' })
    wakeBackgroundTasks()
    return json(response, 202, { accepted: true })
  }
  if (request.method === 'POST' && pathname === '/api/auth/login') { const value = await body<{ password: string }>(request); return json(response, 200, await auth.login(String(value.password || ''), request.socket.remoteAddress || 'unknown', response)) }
  if (request.method === 'GET' && pathname === '/api/auth/session') { const session = auth.session(request); return json(response, 200, session ? { authenticated: true, csrfToken: session.csrf_token } : { authenticated: false }) }
  if (request.method === 'POST' && pathname === '/api/auth/logout') { auth.require(request, true); auth.logout(request, response); return json(response, 200, { authenticated: false }) }
  auth.require(request, request.method !== 'GET' && request.method !== 'HEAD')
  if (request.method === 'GET' && pathname === '/api/events') { response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); response.write(`data: ${JSON.stringify({ type: 'downloads', jobs: queue.snapshot() })}\n\n`); clients.add(response); const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000); request.on('close', () => { clearInterval(heartbeat); clients.delete(response) }); return }
  if (request.method === 'GET' && pathname === '/api/tools') return json(response, 200, await tools.status())
  if (request.method === 'POST' && pathname === '/api/tools/update') return json(response, 200, await tools.update(event => publish({ type: 'tools', event })))
  if (request.method === 'GET' && pathname === '/api/cookies/status') return json(response, 200, await youtubeCookies.status())
  if (request.method === 'POST' && pathname === '/api/cookies/update') { const value = await body<{ platform: CookiePlatform }>(request); return json(response, 202, await youtubeCookies.update(value.platform)) }
  if (request.method === 'POST' && pathname === '/api/cookies/manual') { const value = await body<{ platform: CookiePlatform; contents: string }>(request); return json(response, 200, await youtubeCookies.manual(value.platform, String(value.contents || ''))) }
  if (request.method === 'GET' && pathname === '/api/cookies/view') return json(response, 200, await youtubeCookies.view(url.searchParams.get('reveal') === 'true'))
  if (request.method === 'POST' && pathname === '/api/source/analyze') return json(response, 200, await media.analyze(await body<AnalyzeRequest>(request)))
  if (request.method === 'POST' && pathname === '/api/creator/scan') return json(response, 200, await media.scan(await body<ScanRequest>(request), event => publish({ type: 'creator', event })))
  if (request.method === 'POST' && pathname === '/api/creator/stop') { media.stop(); return json(response, 200, null) }
  if (request.method === 'GET' && pathname === '/api/destination') return json(response, 200, config.get().outputRoot)
  const oldFile = request.method === 'GET' && pathname.match(/^\/api\/downloads\/([0-9a-f-]+)\/file$/); if (oldFile) return downloadFile(oldFile[1], request, response)
  if (request.method === 'GET' && pathname === '/api/downloads/jobs') return json(response, 200, queue.snapshot())
  if (request.method === 'POST' && pathname === '/api/downloads/start') {
    const value = await body<StartRequest>(request); value.options.outputRoot = config.get().outputRoot
    await config.patch({ cookieSource: value.options.cookieSource, options: { mode: value.options.mode, quality: value.options.quality, container: value.options.container, audioFormat: value.options.audioFormat, audioBitrate: value.options.audioBitrate, quickTimeCompatible: value.options.quickTimeCompatible, quickTimeQuality: value.options.quickTimeQuality } })
    return json(response, 200, await queue.start(value, reportDownloads))
  }
  if (request.method === 'POST' && pathname === '/api/downloads/cancel') { queue.cancel((await body<{ id?: string }>(request)).id); return json(response, 200, null) }
  if (request.method === 'POST' && pathname === '/api/downloads/retry') { const value = await body<{ id?: string }>(request); if (value.id) { queue.retry(String(value.id)); return json(response, 200, { count: 1 }) } return json(response, 200, { count: queue.retryFailed() }) }
  if (request.method === 'GET' && pathname === '/api/library') return json(response, 200, db.assets())
  if (request.method === 'GET' && pathname === '/api/library/local-actions') { const capabilities = await localFiles.capabilities(); return json(response, 200, process.env.SVD_CLOUDFLARE_RUNTIME === '1' ? { reveal: false, airdrop: false, upload: true } : { ...capabilities, upload: false }) }
  if (request.method === 'POST' && pathname === '/api/library/reveal') { if (process.env.SVD_CLOUDFLARE_RUNTIME === '1') throw Object.assign(new Error('打开宿主机目录仅适用于服务器或本地部署'), { statusCode: 409 }); const files = await libraryFiles((await body<{ ids?: string[] }>(request)).ids); await localFiles.reveal(files); db.audit('library.reveal', { count: files.length }); return json(response, 200, { count: files.length }) }
  if (request.method === 'POST' && pathname === '/api/library/airdrop') { if (process.env.SVD_CLOUDFLARE_RUNTIME === '1') throw Object.assign(new Error('AirDrop 仅适用于本地部署'), { statusCode: 409 }); const files = await libraryFiles((await body<{ ids?: string[] }>(request)).ids); await localFiles.airdrop(files); db.audit('library.airdrop', { count: files.length }); return json(response, 202, { count: files.length }) }
  if (request.method === 'POST' && pathname === '/api/library/import') return json(response, 200, await library.importDirectory(String((await body<{ directory: string }>(request)).directory || '')))
  if (request.method === 'POST' && pathname === '/api/library/upload-ticket') { const value = await body<{ filename?: string }>(request); return json(response, 201, await library.createUploadTicket(String(value.filename || ''))) }
  if (request.method === 'POST' && pathname === '/api/library/upload-complete') { const value = await body<{ id?: string }>(request); const asset = await library.completeUpload(String(value.id || '')); changed('library'); return json(response, 201, asset) }
  if (request.method === 'POST' && pathname === '/api/library/delete') { const value = await body<{ ids: string[]; deleteFiles?: boolean }>(request); const result = await library.deleteAssets(Array.isArray(value.ids) ? value.ids : [], Boolean(value.deleteFiles)); changed('library'); return json(response, 200, result) }
  const stateMatch = request.method === 'POST' && pathname.match(/^\/api\/library\/([^/]+)\/state$/)
  if (stateMatch) { const value = await body<{ state: 'processed' | 'unprocessed' }>(request); if (!['processed', 'unprocessed'].includes(value.state)) throw new Error('处理状态无效'); return json(response, 200, db.setAssetState(stateMatch[1], value.state)) }
  const thumbnailMatch = request.method === 'GET' && pathname.match(/^\/api\/library\/([^/]+)\/thumbnail$/); if (thumbnailMatch) return library.thumbnail(thumbnailMatch[1], response)
  const hashMatch = request.method === 'GET' && pathname.match(/^\/api\/library\/([^/]+)\/hash$/); if (hashMatch) return json(response, 200, await library.fileHash(hashMatch[1]))
  const metadataMatch = request.method === 'GET' && pathname.match(/^\/api\/library\/([^/]+)\/metadata$/); if (metadataMatch) return json(response, 200, await library.metadata(metadataMatch[1]))
  const mediaMatch = request.method === 'GET' && pathname.match(/^\/api\/library\/([^/]+)\/(media|file)$/); if (mediaMatch) return mediaResponse(mediaMatch[1], request, response, mediaMatch[2] === 'file')
  if (request.method === 'GET' && pathname === '/api/hypit/config') return json(response, 200, await hypitCli.status())
  if (request.method === 'PUT' && pathname === '/api/hypit/config') {
    const value = await body<{ baseUrl?: string; apiKey?: string }>(request)
    await hypitConfig.update({ baseUrl: value.baseUrl, apiKey: value.apiKey })
    return json(response, 200, await hypitCli.status())
  }
  if (request.method === 'POST' && pathname === '/api/hypit/install') return json(response, 200, await hypitCli.ensureInstalled())
  if (request.method === 'GET' && pathname === '/api/remakes') return json(response, 200, remake.list())
  if (request.method === 'POST' && pathname === '/api/remakes') { const value = await body<{ assetIds: string[]; direction: string; mode: 'editable' | 'render'; budget?: string }>(request); return json(response, 202, remake.start(Array.isArray(value.assetIds) ? value.assetIds : [], String(value.direction || ''), value.mode === 'render' ? 'render' : 'editable', value.budget)) }
  if (request.method === 'DELETE' && pathname === '/api/remakes') return json(response, 200, { count: remake.clearHistory() })
  const remakeCancel = request.method === 'POST' && pathname.match(/^\/api\/remakes\/([^/]+)\/cancel$/); if (remakeCancel) { remake.cancel(remakeCancel[1]); return json(response, 200, null) }
  const remakeRetry = request.method === 'POST' && pathname.match(/^\/api\/remakes\/([^/]+)\/retry$/); if (remakeRetry) return json(response, 202, remake.retry(remakeRetry[1]))
  const remakeDelete = request.method === 'DELETE' && pathname.match(/^\/api\/remakes\/([^/]+)$/); if (remakeDelete) { remake.delete(remakeDelete[1]); return json(response, 200, null) }
  if (request.method === 'GET' && pathname === '/api/analysis/jobs') return json(response, 200, db.analyses())
  if (request.method === 'POST' && pathname === '/api/analysis/jobs') { const value = await body<{ assetIds: string[]; force?: boolean }>(request); return json(response, 202, analysis.start(value.assetIds, value.force)) }
  if (request.method === 'DELETE' && pathname === '/api/analysis/jobs') return json(response, 200, { count: analysis.clearHistory() })
  const analysisCancel = request.method === 'POST' && pathname.match(/^\/api\/analysis\/jobs\/([^/]+)\/cancel$/); if (analysisCancel) { analysis.cancel(analysisCancel[1]); return json(response, 200, null) }
  const analysisRetry = request.method === 'POST' && pathname.match(/^\/api\/analysis\/jobs\/([^/]+)\/retry$/); if (analysisRetry) return json(response, 202, analysis.retry(analysisRetry[1]))
  const analysisDelete = request.method === 'DELETE' && pathname.match(/^\/api\/analysis\/jobs\/([^/]+)$/); if (analysisDelete) { analysis.delete(analysisDelete[1]); return json(response, 200, null) }
  if (request.method === 'GET' && pathname === '/api/codex/status') return json(response, 200, await codex.status())
  if (request.method === 'GET' && pathname === '/api/codex/connection') return json(response, 200, codex.connectionPublic())
  if (request.method === 'PUT' && pathname === '/api/codex/connection') {
    const value = await body<{
      mode?: 'official' | 'provider' | 'cc_switch'
      activeProviderId?: string
      ccSwitchBaseUrl?: string
      ccSwitchModel?: string
      ccSwitchReasoningEffort?: string
    }>(request)
    return json(response, 200, await codex.updateConnection(value))
  }
  if (request.method === 'POST' && pathname === '/api/codex/providers') {
    return json(response, 200, await codex.createProvider(await body<Record<string, unknown>>(request)))
  }
  const providerUpdate = request.method === 'PUT' && pathname.match(/^\/api\/codex\/providers\/([^/]+)$/)
  if (providerUpdate) return json(response, 200, await codex.updateProvider(providerUpdate[1], await body<Record<string, unknown>>(request)))
  const providerDelete = request.method === 'DELETE' && pathname.match(/^\/api\/codex\/providers\/([^/]+)$/)
  if (providerDelete) return json(response, 200, await codex.deleteProvider(providerDelete[1]))
  if (request.method === 'POST' && pathname === '/api/codex/connection/test') {
    return json(response, 200, await codex.testConnection(await body<{
      mode?: 'official' | 'provider' | 'cc_switch'
      providerId?: string
      ccSwitchBaseUrl?: string
      ccSwitchModel?: string
      baseUrl?: string
      apiKey?: string
    }>(request)))
  }
  if (request.method === 'POST' && pathname === '/api/codex/login') { codex.login(); return json(response, 202, await codex.status()) }
  if (request.method === 'POST' && pathname === '/api/codex/login/cancel') { codex.cancelLogin(); return json(response, 200, await codex.status()) }
  if (request.method === 'POST' && pathname === '/api/codex/logout') { await codex.logout(); return json(response, 200, await codex.status()) }
  if (request.method === 'GET' && pathname === '/api/publisher/status') return json(response, 200, await publisher.status())
  if (request.method === 'POST' && pathname === '/api/publisher/login') { const value = await body<{ platform?: string }>(request); publisher.login(value.platform); return json(response, 202, await publisher.status()) }
  if (request.method === 'POST' && pathname === '/api/publisher/check-login') { const value = await body<{ platform: string }>(request); return json(response, 200, await publisher.checkLogin(value.platform)) }
  if (request.method === 'GET' && pathname === '/api/publisher/jobs') return json(response, 200, db.publishBatches())
  const artifactMatch = request.method === 'GET' && pathname.match(/^\/api\/publisher\/artifacts\/([^/]+)$/)
  if (artifactMatch) {
    const requested = decodeURIComponent(artifactMatch[1]), screenshot = db.publishBatches().flatMap(batch => batch.jobs).map(job => job.screenshot).find(value => value && path.basename(value) === requested)
    if (!screenshot) return json(response, 404, { error: '诊断截图不存在' })
    const root = await realpath(path.join(process.env.SVD_CONFIG_DIR || '/config', 'publish-artifacts')), file = await realpath(screenshot), relative = path.relative(root, file)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return json(response, 403, { error: '不允许访问该文件' })
    const info = await stat(file); response.writeHead(200, { 'content-type': 'image/png', 'content-length': info.size, 'cache-control': 'private, no-store' }); return createReadStream(file).pipe(response)
  }
  if (request.method === 'POST' && pathname === '/api/publisher/publish') { const value = await body<{ jobs: Parameters<PublisherService['create']>[0]; dispatchMode: 'platform' | 'local'; idempotencyKey?: string; platforms?: string[] }>(request); return json(response, 202, publisher.create(value.jobs, value.dispatchMode, value.idempotencyKey, value.platforms)) }
  const publishRetry = request.method === 'POST' && pathname.match(/^\/api\/publisher\/jobs\/([^/]+)\/retry$/); if (publishRetry) { publisher.retry(publishRetry[1]); return json(response, 202, null) }
  const cancelBatch = request.method === 'POST' && pathname.match(/^\/api\/publisher\/batches\/([^/]+)\/cancel$/); if (cancelBatch) { publisher.cancelBatch(cancelBatch[1]); return json(response, 200, null) }
  if (request.method === 'DELETE' && pathname === '/api/publisher/batches') return json(response, 200, { count: await publisher.clearHistory() })
  const deleteBatch = request.method === 'DELETE' && pathname.match(/^\/api\/publisher\/batches\/([^/]+)$/); if (deleteBatch) { await publisher.deleteBatch(deleteBatch[1]); return json(response, 200, null) }
  if (request.method === 'GET' && pathname === '/api/subscriptions') return json(response, 200, subscriptions.list())
  if (request.method === 'POST' && pathname === '/api/subscriptions') {
    const value = await body<{ sourceUrl: string; autoDownload?: boolean }>(request)
    return json(response, 201, await subscriptions.create(String(value.sourceUrl || ''), Boolean(value.autoDownload)))
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions/schedule') return json(response, 200, subscriptions.schedule())
  if (request.method === 'PATCH' && pathname === '/api/subscriptions/schedule') {
    const value = await body<{ enabled?: boolean; hour?: number; minute?: number; timeZone?: string }>(request)
    return json(response, 200, subscriptions.updateSchedule(value))
  }
  if (request.method === 'POST' && pathname === '/api/subscriptions/poll') return json(response, 202, await subscriptions.pollNow())
  if (request.method === 'GET' && pathname === '/api/subscriptions/notifications') return json(response, 200, { notifications: subscriptions.notifications(), unreadCount: db.unreadNotificationCount(), schedule: subscriptions.schedule() })
  if (request.method === 'POST' && pathname === '/api/subscriptions/notifications/read') {
    const value = await body<{ ids?: string[]; all?: boolean }>(request)
    return json(response, 200, subscriptions.markRead(Array.isArray(value.ids) ? value.ids : undefined, Boolean(value.all)))
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions/status') return json(response, 200, subscriptions.status())
  if (request.method === 'GET' && pathname === '/api/push/public-key') return json(response, 200, { publicKey: push.publicKey() })
  if (request.method === 'GET' && pathname === '/api/push/devices') return json(response, 200, await push.devices())
  if (request.method === 'POST' && pathname === '/api/push/devices') {
    const value = await body<import('../shared/types').PushSubscriptionInput>(request)
    return json(response, 201, { id: await push.saveDevice(value) })
  }
  const pushDevice = request.method === 'DELETE' && pathname.match(/^\/api\/push\/devices\/([^/]+)$/)
  if (pushDevice) return json(response, 200, { removed: await push.removeDevice(pushDevice[1]) })
  const subscriptionPatch = request.method === 'PATCH' && pathname.match(/^\/api\/subscriptions\/([^/]+)$/)
  if (subscriptionPatch) {
    const value = await body<{ autoDownload?: boolean; enabled?: boolean; displayName?: string }>(request)
    return json(response, 200, subscriptions.update(subscriptionPatch[1], value))
  }
  const subscriptionDelete = request.method === 'DELETE' && pathname.match(/^\/api\/subscriptions\/([^/]+)$/)
  if (subscriptionDelete) { subscriptions.remove(subscriptionDelete[1]); return json(response, 200, null) }
  return json(response, 404, { error: '接口不存在' })
}

await config.load(); await mkdir(config.get().outputRoot, { recursive: true }); await auth.initialize(); await codex.initialize(); await hypitConfig.load(); await migrateLegacy(db, library)
if (process.env.SVD_CLOUDFLARE_RUNTIME === '1') wakeBackgroundTasks()
const server = createServer(async (request, response) => {
  try { const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`); if (url.pathname.startsWith('/remote-browser/')) { auth.require(request); request.url = `${url.pathname.slice('/remote-browser'.length) || '/'}${url.search}`; return browserProxy.web(request, response) } if (url.pathname.startsWith('/api/')) await api(request, response, url); else await staticFile(url.pathname === '/' ? '/index.html' : url.pathname, response) }
  catch (error) { json(response, (error as { statusCode?: number }).statusCode || 500, { error: error instanceof Error ? error.message : String(error) }) }
})
server.on('upgrade', (request, socket, head) => { try { const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`); if (!url.pathname.startsWith('/remote-browser/')) return socket.destroy(); auth.require(request); request.url = `${url.pathname.slice('/remote-browser'.length) || '/'}${url.search}`; browserProxy.ws(request, socket, head) } catch { socket.destroy() } })
server.listen(port, host, () => console.log(`Social Video Workbench: http://${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { media.stop(); queue.shutdown(); server.close(() => process.exit(0)) })
