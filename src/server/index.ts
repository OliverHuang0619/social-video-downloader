import { createReadStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from '../main/config'
import { ToolManager } from '../main/tools'
import { MediaService } from '../main/media'
import { DownloadQueue } from '../main/queue'
import type { AnalyzeRequest, ScanEvent, ScanRequest, StartRequest, ToolUpdateEvent } from '../shared/types'

type ServerEvent =
  | { type: 'tools'; event: ToolUpdateEvent }
  | { type: 'creator'; event: ScanEvent }
  | { type: 'downloads'; jobs: ReturnType<DownloadQueue['snapshot']> }

const clients = new Set<ServerResponse>()
const publish = (event: ServerEvent) => {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const client of clients) client.write(data)
}

const config = new ConfigStore()
const tools = new ToolManager()
const media = new MediaService(tools)
const queue = new DownloadQueue(tools)
const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '0.0.0.0'
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client')

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function body<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('请求内容过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon'
}

async function staticFile(requestPath: string, response: ServerResponse) {
  const decoded = decodeURIComponent(requestPath)
  const candidate = path.resolve(clientDir, `.${decoded}`)
  let target = candidate.startsWith(`${clientDir}${path.sep}`) ? candidate : path.join(clientDir, 'index.html')
  try {
    if (!(await stat(target)).isFile()) target = path.join(clientDir, 'index.html')
  } catch { target = path.join(clientDir, 'index.html') }
  response.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' })
  createReadStream(target).pipe(response)
}

async function api(request: IncomingMessage, response: ServerResponse, pathname: string) {
  if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { ok: true })
  if (request.method === 'GET' && pathname === '/api/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    response.write(`data: ${JSON.stringify({ type: 'downloads', jobs: queue.snapshot() })}\n\n`)
    clients.add(response)
    const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000)
    request.on('close', () => { clearInterval(heartbeat); clients.delete(response) })
    return
  }
  if (request.method === 'GET' && pathname === '/api/tools') return json(response, 200, await tools.status())
  if (request.method === 'POST' && pathname === '/api/tools/update') return json(response, 200, await tools.update(event => publish({ type: 'tools', event })))
  if (request.method === 'POST' && pathname === '/api/source/analyze') return json(response, 200, await media.analyze(await body<AnalyzeRequest>(request)))
  if (request.method === 'POST' && pathname === '/api/creator/scan') return json(response, 200, await media.scan(await body<ScanRequest>(request), event => publish({ type: 'creator', event })))
  if (request.method === 'POST' && pathname === '/api/creator/stop') { media.stop(); return json(response, 200, null) }
  if (request.method === 'GET' && pathname === '/api/destination') return json(response, 200, config.get().outputRoot)
  if (request.method === 'POST' && pathname === '/api/downloads/start') {
    const requestBody = await body<StartRequest>(request)
    requestBody.options.outputRoot = config.get().outputRoot
    await config.patch({ cookieSource: requestBody.options.cookieSource, options: { mode: requestBody.options.mode, quality: requestBody.options.quality, container: requestBody.options.container, audioFormat: requestBody.options.audioFormat, audioBitrate: requestBody.options.audioBitrate } })
    return json(response, 200, await queue.start(requestBody, jobs => publish({ type: 'downloads', jobs })))
  }
  if (request.method === 'POST' && pathname === '/api/downloads/cancel') { queue.cancel((await body<{ id?: string }>(request)).id); return json(response, 200, null) }
  if (request.method === 'POST' && pathname === '/api/downloads/retry') { queue.retry((await body<{ id: string }>(request)).id); return json(response, 200, null) }
  return json(response, 404, { error: '接口不存在' })
}

await config.load()
await mkdir(config.get().outputRoot, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname
    if (pathname.startsWith('/api/')) await api(request, response, pathname)
    else await staticFile(pathname === '/' ? '/index.html' : pathname, response)
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : String(error) })
  }
})
server.listen(port, host, () => console.log(`Social Video Downloader: http://${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { media.stop(); queue.shutdown(); server.close(() => process.exit(0)) })
