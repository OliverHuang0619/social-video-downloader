import { createReadStream } from 'node:fs'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import httpProxy from 'http-proxy'
import { ConfigStore } from '../main/config'
import { ToolManager } from '../main/tools'
import { MediaService } from '../main/media'
import { DownloadQueue } from '../main/queue'
import type { AnalyzeRequest, ScanEvent, ScanRequest, StartRequest, ToolUpdateEvent } from '../shared/types'
import { AppDatabase } from './db'
import { AuthService } from './auth'
import { LibraryService } from './library'
import { CodexService } from './codex'
import { AnalysisService } from './analysis'
import { PublisherService } from './publisher'
import { migrateLegacy } from './migration'

type ServerEvent =
  | { type: 'tools'; event: ToolUpdateEvent }
  | { type: 'creator'; event: ScanEvent }
  | { type: 'downloads'; jobs: ReturnType<DownloadQueue['snapshot']> }
  | { type: 'library' | 'analysis' | 'publisher' | 'codex'; at: string }

const clients = new Set<ServerResponse>()
const publish = (event: ServerEvent) => { const data = `data: ${JSON.stringify(event)}\n\n`; for (const client of clients) client.write(data) }
const changed = (type: 'library' | 'analysis' | 'publisher' | 'codex') => publish({ type, at: new Date().toISOString() })
const config = new ConfigStore(), tools = new ToolManager(), media = new MediaService(tools), queue = new DownloadQueue(tools)
const db = new AppDatabase(), auth = new AuthService(db), library = new LibraryService(db), codex = new CodexService(() => changed('codex'))
const analysis = new AnalysisService(db, codex, () => changed('analysis')), publisher = new PublisherService(db, () => changed('publisher'))
const port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0'
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client')
const browserProxy = httpProxy.createProxyServer({ target: process.env.SVD_BROWSER_VNC || 'http://browser:6080', ws: true })
browserProxy.on('error', (_error, _request, response) => { if ('writeHead' in response) { response.writeHead(502); response.end('远程浏览器不可用') } })

function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)) }
async function body<T>(request: IncomingMessage): Promise<T> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 2 * 1024 * 1024) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 }); chunks.push(chunk) } return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T }
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' }
async function staticFile(requestPath: string, response: ServerResponse) { const decoded = decodeURIComponent(requestPath), candidate = path.resolve(clientDir, `.${decoded}`); let target = candidate.startsWith(`${clientDir}${path.sep}`) ? candidate : path.join(clientDir, 'index.html'); try { if (!(await stat(target)).isFile()) target = path.join(clientDir, 'index.html') } catch { target = path.join(clientDir, 'index.html') } response.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' }); createReadStream(target).pipe(response) }
async function downloadFile(id: string, response: ServerResponse) { const job = queue.get(id); if (!job?.outputPath || !['completed', 'skipped'].includes(job.status)) return json(response, 404, { error: '下载文件不存在' }); const [root, file] = await Promise.all([realpath(config.get().outputRoot), realpath(job.outputPath)]); const relative = path.relative(root, file); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return json(response, 403, { error: '不允许访问该文件' }); const info = await stat(file), encodedName = encodeURIComponent(path.basename(file)); response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': info.size, 'content-disposition': `attachment; filename*=UTF-8''${encodedName}`, 'cache-control': 'private, no-store' }); createReadStream(file).pipe(response) }

async function api(request: IncomingMessage, response: ServerResponse, url: URL) {
  const pathname = url.pathname
  if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { ok: true, database: true })
  if (request.method === 'POST' && pathname === '/api/auth/login') { const value = await body<{ password: string }>(request); return json(response, 200, await auth.login(String(value.password || ''), request.socket.remoteAddress || 'unknown', response)) }
  if (request.method === 'GET' && pathname === '/api/auth/session') { const session = auth.session(request); return json(response, 200, session ? { authenticated: true, csrfToken: session.csrf_token } : { authenticated: false }) }
  if (request.method === 'POST' && pathname === '/api/auth/logout') { auth.require(request, true); auth.logout(request, response); return json(response, 200, { authenticated: false }) }
  auth.require(request, request.method !== 'GET' && request.method !== 'HEAD')
  if (request.method === 'GET' && pathname === '/api/events') { response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); response.write(`data: ${JSON.stringify({ type: 'downloads', jobs: queue.snapshot() })}\n\n`); clients.add(response); const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000); request.on('close', () => { clearInterval(heartbeat); clients.delete(response) }); return }
  if (request.method === 'GET' && pathname === '/api/tools') return json(response, 200, await tools.status())
  if (request.method === 'POST' && pathname === '/api/tools/update') return json(response, 200, await tools.update(event => publish({ type: 'tools', event })))
  if (request.method === 'POST' && pathname === '/api/source/analyze') return json(response, 200, await media.analyze(await body<AnalyzeRequest>(request)))
  if (request.method === 'POST' && pathname === '/api/creator/scan') return json(response, 200, await media.scan(await body<ScanRequest>(request), event => publish({ type: 'creator', event })))
  if (request.method === 'POST' && pathname === '/api/creator/stop') { media.stop(); return json(response, 200, null) }
  if (request.method === 'GET' && pathname === '/api/destination') return json(response, 200, config.get().outputRoot)
  const oldFile = request.method === 'GET' && pathname.match(/^\/api\/downloads\/([0-9a-f-]+)\/file$/); if (oldFile) return downloadFile(oldFile[1], response)
  if (request.method === 'GET' && pathname === '/api/downloads/jobs') return json(response, 200, db.downloads())
  if (request.method === 'POST' && pathname === '/api/downloads/start') {
    const value = await body<StartRequest>(request); value.options.outputRoot = config.get().outputRoot
    await config.patch({ cookieSource: value.options.cookieSource, options: { mode: value.options.mode, quality: value.options.quality, container: value.options.container, audioFormat: value.options.audioFormat, audioBitrate: value.options.audioBitrate, quickTimeCompatible: value.options.quickTimeCompatible } })
    return json(response, 200, await queue.start(value, jobs => { void library.syncDownloads(jobs).then(() => changed('library')); publish({ type: 'downloads', jobs }) }))
  }
  if (request.method === 'POST' && pathname === '/api/downloads/cancel') { queue.cancel((await body<{ id?: string }>(request)).id); return json(response, 200, null) }
  if (request.method === 'POST' && pathname === '/api/downloads/retry') { queue.retry((await body<{ id: string }>(request)).id); return json(response, 200, null) }
  if (request.method === 'GET' && pathname === '/api/library') return json(response, 200, db.assets())
  if (request.method === 'POST' && pathname === '/api/library/import') return json(response, 200, await library.importDirectory(String((await body<{ directory: string }>(request)).directory || '')))
  const stateMatch = request.method === 'POST' && pathname.match(/^\/api\/library\/([^/]+)\/state$/)
  if (stateMatch) { const value = await body<{ state: 'processed' | 'unprocessed' }>(request); if (!['processed', 'unprocessed'].includes(value.state)) throw new Error('处理状态无效'); return json(response, 200, db.setAssetState(stateMatch[1], value.state)) }
  const mediaMatch = request.method === 'GET' && pathname.match(/^\/api\/library\/([^/]+)\/(media|file)$/); if (mediaMatch) return library.stream(mediaMatch[1], request.headers.range, response, mediaMatch[2] === 'file')
  if (request.method === 'GET' && pathname === '/api/analysis/jobs') return json(response, 200, db.analyses())
  if (request.method === 'POST' && pathname === '/api/analysis/jobs') { const value = await body<{ assetIds: string[]; force?: boolean }>(request); return json(response, 202, analysis.start(value.assetIds, value.force)) }
  const analysisCancel = request.method === 'POST' && pathname.match(/^\/api\/analysis\/jobs\/([^/]+)\/cancel$/); if (analysisCancel) { analysis.cancel(analysisCancel[1]); return json(response, 200, null) }
  const analysisRetry = request.method === 'POST' && pathname.match(/^\/api\/analysis\/jobs\/([^/]+)\/retry$/); if (analysisRetry) return json(response, 202, analysis.retry(analysisRetry[1]))
  if (request.method === 'GET' && pathname === '/api/codex/status') return json(response, 200, await codex.status())
  if (request.method === 'POST' && pathname === '/api/codex/login') { codex.login(); return json(response, 202, await codex.status()) }
  if (request.method === 'POST' && pathname === '/api/codex/login/cancel') { codex.cancelLogin(); return json(response, 200, await codex.status()) }
  if (request.method === 'POST' && pathname === '/api/codex/logout') { await codex.logout(); return json(response, 200, await codex.status()) }
  if (request.method === 'GET' && pathname === '/api/publisher/status') return json(response, 200, await publisher.status())
  if (request.method === 'POST' && pathname === '/api/publisher/login') { publisher.login(); return json(response, 202, await publisher.status()) }
  if (request.method === 'GET' && pathname === '/api/publisher/jobs') return json(response, 200, db.publishBatches())
  const artifactMatch = request.method === 'GET' && pathname.match(/^\/api\/publisher\/artifacts\/([^/]+)$/)
  if (artifactMatch) {
    const requested = decodeURIComponent(artifactMatch[1]), screenshot = db.publishBatches().flatMap(batch => batch.jobs).map(job => job.screenshot).find(value => value && path.basename(value) === requested)
    if (!screenshot) return json(response, 404, { error: '诊断截图不存在' })
    const root = await realpath(path.join(process.env.SVD_CONFIG_DIR || '/config', 'publish-artifacts')), file = await realpath(screenshot), relative = path.relative(root, file)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return json(response, 403, { error: '不允许访问该文件' })
    const info = await stat(file); response.writeHead(200, { 'content-type': 'image/png', 'content-length': info.size, 'cache-control': 'private, no-store' }); return createReadStream(file).pipe(response)
  }
  if (request.method === 'POST' && pathname === '/api/publisher/publish') { const value = await body<{ jobs: Parameters<PublisherService['create']>[0]; dispatchMode: 'platform' | 'local'; idempotencyKey?: string }>(request); return json(response, 202, publisher.create(value.jobs, value.dispatchMode, value.idempotencyKey)) }
  const publishRetry = request.method === 'POST' && pathname.match(/^\/api\/publisher\/jobs\/([^/]+)\/retry$/); if (publishRetry) { publisher.retry(publishRetry[1]); return json(response, 202, null) }
  const deleteBatch = request.method === 'DELETE' && pathname.match(/^\/api\/publisher\/batches\/([^/]+)$/); if (deleteBatch) { await publisher.deleteBatch(deleteBatch[1]); return json(response, 200, null) }
  return json(response, 404, { error: '接口不存在' })
}

await config.load(); await mkdir(config.get().outputRoot, { recursive: true }); await auth.initialize(); await codex.initialize(); await migrateLegacy(db, library)
const server = createServer(async (request, response) => {
  try { const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`); if (url.pathname.startsWith('/remote-browser/')) { auth.require(request); request.url = `${url.pathname.slice('/remote-browser'.length) || '/'}${url.search}`; return browserProxy.web(request, response) } if (url.pathname.startsWith('/api/')) await api(request, response, url); else await staticFile(url.pathname === '/' ? '/index.html' : url.pathname, response) }
  catch (error) { json(response, (error as { statusCode?: number }).statusCode || 500, { error: error instanceof Error ? error.message : String(error) }) }
})
server.on('upgrade', (request, socket, head) => { try { const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`); if (!url.pathname.startsWith('/remote-browser/')) return socket.destroy(); auth.require(request); request.url = `${url.pathname.slice('/remote-browser'.length) || '/'}${url.search}`; browserProxy.ws(request, socket, head) } catch { socket.destroy() } })
server.listen(port, host, () => console.log(`Social Video Workbench: http://${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { media.stop(); queue.shutdown(); server.close(() => process.exit(0)) })
