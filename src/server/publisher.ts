import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserStatus, PublishBatch, PublishJob } from '../shared/types'
import type { AppDatabase } from './db'

type PublishInput = { assetId: string; title: string; topics: string[]; publishAt?: string; aigc?: boolean }
const terminal = new Set(['published', 'scheduled', 'failed', 'needs_login', 'needs_attention', 'interrupted'])
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

function loadBrowserToken(mode: BrowserStatus['mode']) {
  if (mode !== 'host') return ''
  if (process.env.SVD_BROWSER_TOKEN) return process.env.SVD_BROWSER_TOKEN
  try { return readFileSync(process.env.SVD_BROWSER_TOKEN_FILE || '/config/local-browser.token', 'utf8').trim() } catch { return '' }
}

export class PublisherService {
  private running = false
  private wakeTimer?: NodeJS.Timeout
  private loginRunning = false
  private loginStatus: BrowserStatus['loginStatus'] = 'unknown'
  private message = '尚未检查抖音登录状态'
  private script = path.join(process.env.SVD_SKILL_DIR || path.resolve(process.cwd(), 'skills/english-video-catalog'), 'scripts/douyin_publisher.mjs')
  private artifactDir = path.join(process.env.SVD_CONFIG_DIR || '/config', 'publish-artifacts')
  private tempDir = path.join(process.env.SVD_CONFIG_DIR || '/config', 'publish-temp')
  private browserMode: BrowserStatus['mode'] = process.env.SVD_BROWSER_MODE === 'host' ? 'host' : 'container'
  private browserUrl = process.env.SVD_BROWSER_CDP || 'http://browser:9222'
  private browserToken = loadBrowserToken(this.browserMode)
  constructor(private db: AppDatabase, private changed: () => void) { void this.resume() }
  async status(): Promise<BrowserStatus> {
    let ready = false
    try { const response = await fetch(`${this.browserUrl}/json/version`, { headers: this.browserToken ? { authorization: `Bearer ${this.browserToken}` } : undefined, signal: AbortSignal.timeout(2500) }); ready = response.ok } catch { /* browser offline */ }
    const manageUrl = 'https://creator.douyin.com/creator-micro/content/manage'
    return { ready, mode: this.browserMode, loginStatus: this.loginStatus, message: ready ? this.message : this.browserMode === 'host' ? '本地浏览器连接助手未启动' : '远程浏览器不可用', remoteUrl: this.browserMode === 'host' ? manageUrl : '/remote-browser/vnc.html?autoconnect=1&resize=scale', manageUrl }
  }
  login() {
    if (this.loginRunning) return
    this.loginRunning = true; this.message = this.browserMode === 'host' ? '请在本地浏览器中扫码登录' : '请在站内远程浏览器中扫码登录'; this.changed()
    void this.execute(['login'], event => {
      if (event.event === 'login_ready') { this.loginStatus = 'ready'; this.message = '抖音创作者中心已登录' }
      if (event.event === 'error') { this.loginStatus = 'needs_attention'; this.message = String(event.message || '登录未完成') }
      this.changed()
    }).finally(() => { this.loginRunning = false; this.changed() })
  }
  create(jobs: PublishInput[], dispatchMode: PublishBatch['dispatchMode'], idempotencyKey?: string) {
    if (!jobs.length) throw new Error('没有可发布的视频')
    if (!['platform', 'local'].includes(dispatchMode)) throw new Error('发布方式无效')
    if (dispatchMode === 'local' && jobs.length === 1) throw new Error('本地定时仅用于批量发布')
    if (idempotencyKey) { const existing = this.db.meta(`publish:${idempotencyKey}`); if (existing) return this.db.publishBatches().find(batch => batch.id === existing)! }
    const now = new Date(), id = randomUUID(), items: PublishJob[] = jobs.map((input, index) => {
      const asset = this.db.asset(input.assetId); if (!asset) throw new Error('视频不存在')
      const title = input.title.trim(), topics = [...new Set(input.topics.map(value => value.trim().replace(/^#+/, '')).filter(Boolean))].slice(0, 5)
      if (!title || [...title].length > 30 || !topics.length) throw new Error('标题必须为 1–30 字符，话题必须为 1–5 个')
      let publishAt: string | undefined, executeAt: string | undefined
      if (input.publishAt) {
        const date = new Date(input.publishAt); if (Number.isNaN(date.getTime())) throw new Error('发布时间无效')
        const minimum = dispatchMode === 'local' ? 60_000 : 2 * 3600_000
        if (date.getTime() < now.getTime() + minimum) throw new Error(dispatchMode === 'local' ? '本地定时至少提前 1 分钟' : '平台排期至少提前 2 小时')
        if (dispatchMode === 'platform' && date.getTime() > now.getTime() + 7 * 24 * 3600_000) throw new Error('平台排期不能超过 7 天')
        if (dispatchMode === 'local') executeAt = date.toISOString(); else publishAt = date.toISOString()
      } else if (dispatchMode === 'local' || jobs.length > 1) throw new Error('批量发布必须指定首条时间')
      return { id: `${id}-${String(index + 1).padStart(3, '0')}`, batchId: id, assetId: asset.id, title, topics, publishAt, executeAt, aigc: input.aigc !== false, status: dispatchMode === 'local' ? 'waiting_local' : 'queued' }
    })
    const batch: PublishBatch = { id, dispatchMode, status: dispatchMode === 'local' ? 'waiting_local' : 'queued', createdAt: now.toISOString(), updatedAt: now.toISOString(), jobs: items }
    this.db.createPublishBatch(batch); if (idempotencyKey) this.db.setMeta(`publish:${idempotencyKey}`, id); this.db.audit('publish.created', { id, count: items.length, dispatchMode }); if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = undefined; void this.pump(); this.changed(); return batch
  }
  retry(jobId: string) {
    const batch = this.db.publishBatches().find(value => value.jobs.some(job => job.id === jobId)); const job = batch?.jobs.find(value => value.id === jobId)
    if (!batch || !job || !['failed', 'needs_login', 'needs_attention', 'interrupted'].includes(job.status)) throw new Error('该任务不能重试')
    this.db.updatePublishJob(job.id, batch.dispatchMode === 'local' && job.executeAt && new Date(job.executeAt) > new Date() ? 'waiting_local' : 'queued')
    this.db.updatePublishBatch(batch.id, batch.dispatchMode === 'local' ? 'waiting_local' : 'queued'); void this.pump(); this.changed()
  }
  async deleteBatch(id: string) {
    const batch = this.db.publishBatches().find(value => value.id === id)
    if (!batch || !this.db.deletePublishBatch(id)) throw new Error('任务仍在执行或不存在')
    await Promise.all(batch.jobs.map(job => job.screenshot ? unlink(job.screenshot).catch(() => undefined) : Promise.resolve()))
    this.changed()
  }
  private async resume() { await mkdir(this.artifactDir, { recursive: true }); await mkdir(this.tempDir, { recursive: true }); await this.pump() }
  private async pump() {
    if (this.running) return; this.running = true
    let nextWake: number | undefined
    try {
      for (const batch of this.db.publishBatches().reverse()) {
        if (!['queued', 'waiting_local'].includes(batch.status)) continue
        this.db.updatePublishBatch(batch.id, batch.dispatchMode === 'local' ? 'waiting_local' : 'running')
        let deferred = false
        for (const original of batch.jobs) {
          const current = this.db.publishBatches().find(value => value.id === batch.id)!.jobs.find(value => value.id === original.id)!
          if (!['queued', 'waiting_local'].includes(current.status)) continue
          if (current.executeAt) {
            const delay = new Date(current.executeAt).getTime() - Date.now()
            if (delay > 0) { this.db.updatePublishJob(current.id, 'waiting_local'); nextWake = Math.min(nextWake ?? delay, delay); deferred = true; this.changed(); break }
          }
          const ok = await this.runJob(current)
          if (!ok) { for (const rest of batch.jobs.filter(value => value.id > current.id && !terminal.has(value.status))) this.db.updatePublishJob(rest.id, 'interrupted', { error: '前一任务需要人工处理，批次已停止' }); break }
          await sleep(Number(process.env.SVD_PUBLISH_COOLDOWN_MS || 30_000))
        }
        if (deferred) continue
        const latest = this.db.publishBatches().find(value => value.id === batch.id)!, states = new Set(latest.jobs.map(job => job.status))
        const status = [...states].every(value => value === 'published' || value === 'scheduled') ? 'completed' : states.has('needs_login') || states.has('needs_attention') ? 'needs_attention' : states.has('published') || states.has('scheduled') ? 'partial' : 'failed'
        this.db.updatePublishBatch(batch.id, status); this.changed()
      }
    } finally {
      this.running = false
      if (nextWake !== undefined) this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; void this.pump() }, Math.max(1000, nextWake))
    }
  }
  private async runJob(job: PublishJob) {
    const asset = this.db.asset(job.assetId)!; const payloadPath = path.join(this.tempDir, `${job.id}.json`)
    await writeFile(payloadPath, JSON.stringify({ jobId: job.id, file: asset.file, title: job.title, topics: job.topics, publishAt: job.publishAt, aigc: job.aigc, artifactDir: this.artifactDir }))
    let succeeded = false
    await this.execute(['publish', payloadPath], event => {
      const name = String(event.event)
      if (['launching', 'uploading', 'scheduling', 'submitting', 'published', 'scheduled'].includes(name)) { this.db.updatePublishJob(job.id, name as PublishJob['status'], { screenshot: event.screenshot ? String(event.screenshot) : undefined }); succeeded = name === 'published' || name === 'scheduled' }
      if (name === 'error') { const message = String(event.message || '发布失败'); const status = message.includes('LOGIN_REQUIRED') ? 'needs_login' : message.includes('MANUAL_REVIEW_REQUIRED') ? 'needs_attention' : 'failed'; this.db.updatePublishJob(job.id, status, { error: message, screenshot: event.screenshot ? String(event.screenshot) : undefined }); this.loginStatus = status === 'needs_login' ? 'needs_login' : status === 'needs_attention' ? 'needs_attention' : this.loginStatus; this.message = message }
      this.changed()
    })
    await unlink(payloadPath).catch(() => undefined)
    if (succeeded) { this.db.setAssetState(job.assetId, 'processed'); this.loginStatus = 'ready'; this.message = '抖音发布服务已就绪' }
    return succeeded
  }
  private execute(args: string[], onEvent: (event: Record<string, unknown>) => void) {
    return new Promise<void>(resolve => {
      const child = spawn('node', [this.script, ...args], { env: { ...process.env, DOUYIN_CDP_URL: this.browserUrl, DOUYIN_CDP_TOKEN: this.browserToken }, windowsHide: true }); let buffer = ''
      const consume = (value: Buffer) => { buffer += value.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; for (const line of lines) { try { onEvent(JSON.parse(line)) } catch { /* ignore browser diagnostics */ } } }
      child.stdout.on('data', consume); child.stderr.on('data', consume); child.on('error', error => { onEvent({ event: 'error', message: error.message }); resolve() }); child.on('close', () => { if (buffer.trim()) { try { onEvent(JSON.parse(buffer)) } catch { /* ignore */ } } resolve() })
    })
  }
}
