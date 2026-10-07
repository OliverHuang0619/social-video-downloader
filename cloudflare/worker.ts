import { Container, ContainerProxy, getContainer, type OutboundHandlerContext } from '@cloudflare/containers'
import { presignR2 } from './r2-presign'

interface Env {
  APP_CONTAINER: DurableObjectNamespace<WorkbenchContainer>
  ASSETS: Fetcher
  DB: D1Database
  MEDIA: R2Bucket
  JOBS: Queue<{ type: 'subscription-tick' | 'work-wake' }>
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
  SVD_CF_BRIDGE_TOKEN: string
  SVD_INTERNAL_SCHEDULER_TOKEN: string
  SVD_VAPID_PUBLIC_KEY: string
  SVD_VAPID_PRIVATE_KEY: string
  SVD_DATA_ENCRYPTION_KEY: string
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
}

function equalSecret(actual: string, expected: string) {
  if (!actual || actual.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference === 0
}

function authorize(request: Request, env: Env) {
  return equalSecret(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '', env.SVD_CF_BRIDGE_TOKEN)
}

async function databaseBinding(request: Request, env: Env) {
  if (!authorize(request, env)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const input = await request.json() as { sql?: string; values?: unknown[]; mode?: 'first' | 'all' | 'run' | 'batch'; statements?: Array<{ sql: string; values: unknown[] }> }
  const validValues = (values: unknown[]) => values.length <= 100 && values.every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value))
  const validBatch = input.mode === 'batch' && Array.isArray(input.statements) && input.statements.length > 0 && input.statements.length <= 100 && input.statements.every(statement => typeof statement.sql === 'string' && statement.sql.length <= 32_000 && Array.isArray(statement.values) && validValues(statement.values))
  const validSingle = ['first', 'all', 'run'].includes(input.mode || '') && typeof input.sql === 'string' && input.sql.length > 0 && input.sql.length <= 32_000 && Array.isArray(input.values) && validValues(input.values)
  if (!validSingle && !validBatch) {
    return Response.json({ error: 'Invalid query' }, { status: 400 })
  }
  try {
    if (input.mode === 'batch') {
      const statements = input.statements!.map(item => env.DB.prepare(item.sql).bind(...item.values as Array<string | number | null | ArrayBuffer | boolean>))
      const results = await env.DB.batch(statements)
      return Response.json({ result: results.map(result => ({ meta: { changes: result.meta.changes, last_row_id: result.meta.last_row_id } })) })
    }
    const statement = env.DB.prepare(input.sql!).bind(...input.values! as Array<string | number | null | ArrayBuffer | boolean>)
    if (input.mode === 'first') return Response.json({ result: await statement.first() })
    if (input.mode === 'run') {
      const result = await statement.run()
      return Response.json({ result: { changes: result.meta.changes, lastRowId: result.meta.last_row_id } })
    }
    const result = await statement.all()
    return Response.json({ result: result.results })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}

function objectKey(request: Request) {
  const raw = decodeURIComponent(new URL(request.url).pathname.slice(1))
  if (!raw || raw.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return undefined
  return raw
}

async function mediaBinding(request: Request, env: Env, context: OutboundHandlerContext) {
  if (!authorize(request, env)) return new Response('Unauthorized', { status: 401 })
  if (new URL(request.url).pathname === '/presign' && request.method === 'POST') {
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return Response.json({ error: 'R2 S3 API 凭据未配置' }, { status: 503 })
    const { method, key } = await request.json() as { method?: string; key?: string }
    if (!['GET', 'PUT'].includes(method || '') || typeof key !== 'string' || !key.startsWith('media/assets/') || key.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
      return Response.json({ error: 'Invalid presign request' }, { status: 400 })
    }
    return Response.json({ url: await presignR2({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }, method as 'GET' | 'PUT', `instances/${context.containerId}/${key}`) })
  }
  const key = objectKey(request)
  if (!key) return new Response('Invalid object key', { status: 400 })
  // Container-internal backup calls include their instance ID in the URL to
  // keep the bridge path explicit. Remove it before applying the R2 namespace.
  const instancePrefix = `${context.containerId}/`
  const objectPath = key.startsWith(instancePrefix) ? key.slice(instancePrefix.length) : key
  const scopedKey = `instances/${context.containerId}/${objectPath}`
  if (request.method === 'PUT') {
    const object = await env.MEDIA.put(scopedKey, request.body, { httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' } })
    return Response.json({ key, etag: object?.etag })
  }
  if (request.method === 'DELETE') {
    await env.MEDIA.delete(scopedKey)
    return new Response(null, { status: 204 })
  }
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', { status: 405 })
  const rangeHeader = request.headers.get('range')
  const parsedRange = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/)
  if (rangeHeader && !parsedRange) return new Response('Invalid range', { status: 416 })
  const range = parsedRange ? { offset: Number(parsedRange[1]), ...(parsedRange[2] ? { length: Number(parsedRange[2]) - Number(parsedRange[1]) + 1 } : {}) } : undefined
  const object = await env.MEDIA.get(scopedKey, range ? { range } : undefined)
  if (!object) return new Response('Not Found', { status: 404 })
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('content-length', String(object.size))
  headers.set('accept-ranges', 'bytes')
  const responseRange = object.range && 'offset' in object.range && 'length' in object.range && object.range.offset !== undefined && object.range.length !== undefined ? object.range : undefined
  if (responseRange) {
    const offset = Number(responseRange.offset)
    const length = Number(responseRange.length)
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
  }
  if (request.method === 'HEAD') return new Response(null, { status: responseRange ? 206 : 200, headers })
  headers.set('content-length', String(responseRange ? Number(responseRange.length) : object.size))
  return new Response(object.body, { status: responseRange ? 206 : 200, headers })
}


export class WorkbenchContainer extends Container<Env> {
  defaultPort = 3000
  // Encrypted /config snapshots run every 5m15s, so retain enough idle time
  // for the next snapshot after the last user request.
  sleepAfter = '10m'
  enableInternet = true
  envVars: Record<string, string>
  private workCheckScheduled = false

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env)
    this.envVars = {
      NODE_ENV: 'production',
      PORT: '3000',
      HOST: '0.0.0.0',
      SVD_RUNTIME: 'cloudflare',
      SVD_CLOUDFLARE_RUNTIME: '1',
      SVD_OUTPUT_DIR: '/downloads',
      SVD_CONFIG_DIR: '/config',
      SVD_IMPORT_DIR: '/imports',
      SVD_BROWSER_MODE: 'container',
      SVD_BROWSER_CDP: 'http://127.0.0.1:9222',
      SVD_BROWSER_VNC: 'http://127.0.0.1:6080',
      SVD_CF_CONTAINER_ID: ctx.id.toString(),
      ADMIN_PASSWORD: env.ADMIN_PASSWORD,
      SESSION_SECRET: env.SESSION_SECRET,
      SVD_CF_BRIDGE_TOKEN: env.SVD_CF_BRIDGE_TOKEN,
      SVD_INTERNAL_SCHEDULER_TOKEN: env.SVD_INTERNAL_SCHEDULER_TOKEN,
      SVD_VAPID_PUBLIC_KEY: env.SVD_VAPID_PUBLIC_KEY,
      SVD_VAPID_PRIVATE_KEY: env.SVD_VAPID_PRIVATE_KEY,
      SVD_DATA_ENCRYPTION_KEY: env.SVD_DATA_ENCRYPTION_KEY,
      TZ: 'Asia/Shanghai',
    }
  }

  override async onStart() {
    await this.scheduleWorkActivityCheck()
  }

  /** Called by the Worker after a task wake or a mutating app request. */
  async ensureWorkActivityCheck() {
    this.renewActivityTimeout()
    await this.scheduleWorkActivityCheck()
  }

  private async scheduleWorkActivityCheck() {
    if (this.workCheckScheduled) return
    this.workCheckScheduled = true
    const scheduled = await this.ctx.storage.get<boolean>('work-activity-check-scheduled')
    if (scheduled) return
    await this.ctx.storage.put('work-activity-check-scheduled', true)
    try {
      await this.schedule(30, 'checkWorkActivity')
    } catch (error) {
      this.workCheckScheduled = false
      await this.ctx.storage.delete('work-activity-check-scheduled')
      throw error
    }
  }

  async checkWorkActivity() {
    this.workCheckScheduled = false
    await this.ctx.storage.delete('work-activity-check-scheduled')
    const active = await this.env.DB.prepare(`
      SELECT 1 AS active
      WHERE EXISTS (SELECT 1 FROM analysis_jobs WHERE status IN ('preparing','analyzing'))
         OR EXISTS (SELECT 1 FROM download_jobs WHERE json_extract(payload, '$.status')='downloading')
         OR EXISTS (SELECT 1 FROM remake_jobs WHERE json_extract(payload, '$.status') IN ('preparing','directing','building'))
         OR EXISTS (SELECT 1 FROM publish_jobs WHERE status IN ('launching','waiting_login','uploading','scheduling','waiting_covers','submitting'))
         OR EXISTS (SELECT 1 FROM app_meta WHERE key='subscription_polling' AND value='1')
    `).first()
    if (active) {
      this.renewActivityTimeout()
      await this.scheduleWorkActivityCheck()
    }
  }

}

// ContainerProxy reads these handlers from the @cloudflare/containers
// registry. Assign after the class declaration so the inherited static setter
// registers them (a subclass static field would shadow the setter).
WorkbenchContainer.outboundByHost = {
  'svw.d1.internal': (request: Request, rawEnv: unknown) => databaseBinding(request, rawEnv as Env),
  'svw.r2.internal': (request: Request, rawEnv: unknown, context: OutboundHandlerContext) => mediaBinding(request, rawEnv as Env, context),
}

export { ContainerProxy }

async function routeToContainer(request: Request, env: Env) {
  return getContainer(env.APP_CONTAINER, 'primary').fetch(request)
}

function dueWorkQuery() {
  return `
    SELECT 1 AS pending
    WHERE EXISTS (SELECT 1 FROM analysis_jobs WHERE status='queued')
       OR EXISTS (SELECT 1 FROM download_jobs WHERE json_extract(payload, '$.status')='queued')
       OR EXISTS (SELECT 1 FROM remake_jobs WHERE json_extract(payload, '$.status')='queued')
       OR EXISTS (SELECT 1 FROM publish_jobs WHERE status='queued' AND COALESCE(submit_at, execute_at, publish_at, '1970-01-01T00:00:00.000Z') <= ?)
       OR EXISTS (SELECT 1 FROM publish_jobs WHERE status='waiting_local' AND COALESCE(execute_at, submit_at, '1970-01-01T00:00:00.000Z') <= ?)
  `
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/remote-browser/')) {
      const container = getContainer(env.APP_CONTAINER, 'primary')
      const response = await container.fetch(request)
      if (url.pathname.startsWith('/api/') && request.method !== 'GET' && request.method !== 'HEAD' && !url.pathname.startsWith('/api/internal/') && response.ok) {
        ctx.waitUntil(Promise.all([
          env.JOBS.send({ type: 'work-wake' }),
          container.ensureWorkActivityCheck(),
        ]).catch(error => console.error('Background task wake enqueue failed:', error)))
      }
      return response
    }
    return env.ASSETS.fetch(request)
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = new Date().toISOString()
    const [schedule, pendingWork] = await Promise.all([
      env.DB.prepare("SELECT value FROM app_meta WHERE key='subscription_next_poll_at'").first<{ value: string }>(),
      env.DB.prepare(dueWorkQuery()).bind(now, now).first(),
    ])
    const enqueues: Promise<unknown>[] = []
    if (schedule?.value && Date.parse(schedule.value) <= Date.now()) enqueues.push(env.JOBS.send({ type: 'subscription-tick' }))
    if (pendingWork) enqueues.push(env.JOBS.send({ type: 'work-wake' }))
    if (enqueues.length) ctx.waitUntil(Promise.all(enqueues))
  },
  async queue(batch: MessageBatch<{ type: 'subscription-tick' | 'work-wake' }>, env: Env) {
    for (const message of batch.messages) {
      try {
        const endpoint = message.body.type === 'subscription-tick' ? '/api/internal/scheduler/tick' : '/api/internal/jobs/wake'
        const response = await routeToContainer(new Request(`https://workbench.internal${endpoint}`, {
          method: 'POST', headers: { authorization: `Bearer ${env.SVD_INTERNAL_SCHEDULER_TOKEN}` },
        }), env)
        if (!response.ok) throw new Error(`container task wake returned ${response.status}`)
        await getContainer(env.APP_CONTAINER, 'primary').ensureWorkActivityCheck()
        message.ack()
      } catch (error) {
        console.error('Subscription schedule dispatch failed:', error)
        message.retry()
      }
    }
  },
} satisfies ExportedHandler<Env, { type: 'subscription-tick' | 'work-wake' }>
