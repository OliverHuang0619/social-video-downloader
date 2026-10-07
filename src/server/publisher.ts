import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { nextSafePlatformPublishTime, normalizePublishTopics, randomPublishSubmissionDelayMs } from '../shared/core'
import { DOUYIN_TITLE_LIMIT, MULTIPOST_TITLE_LIMIT, isDouyinPublishPlatform, multipostPlatform, publishPlatformLabel, resolvePublishPlatforms } from '../shared/multipost-platforms'
import type { BrowserStatus, PublishBatch, PublishJob, PublishPlatformAuth, PublishPlatformAuthState } from '../shared/types'
import type { AppDatabase } from './db'

type PublishInput = { assetId: string; title: string; topics: string[]; summary?: string; publishAt?: string; aigc?: boolean; waitForCovers?: boolean }
const terminal = new Set(['submitted', 'published', 'scheduled', 'failed', 'needs_login', 'needs_attention', 'interrupted', 'cancelled'])
const cancellable = new Set(['queued', 'waiting_local', 'launching', 'waiting_login', 'uploading', 'scheduling', 'waiting_covers', 'submitting'])
const publishTimeoutMs = 15 * 60_000
const managedPlatforms = ['douyin', 'VIDEO_WEIXINCHANNEL', 'VIDEO_BILIBILI', 'VIDEO_TOUTIAOHAO']
function submissionTimesForAssets(assetIds: string[], now: Date, configuredCooldown?: string) {
  let submitAt = now.getTime()
  const fixedDelay = configuredCooldown === undefined ? undefined : Math.max(0, Number(configuredCooldown) || 0)
  return assetIds.map((assetId, index) => {
    if (index > 0 && assetId !== assetIds[index - 1]) submitAt += fixedDelay ?? randomPublishSubmissionDelayMs()
    return new Date(submitAt).toISOString()
  })
}
const platformProbeUrls: Record<string, string> = {
  douyin: 'https://creator.douyin.com/creator-micro/content/upload',
  VIDEO_WEIXINCHANNEL: 'https://channels.weixin.qq.com/platform/post/create',
  VIDEO_BILIBILI: 'https://member.bilibili.com/platform/upload/video/frame',
  VIDEO_TOUTIAOHAO: 'https://mp.toutiao.com/profile_v4/xigua/upload-video',
}

function loadBrowserToken(mode: BrowserStatus['mode']) {
  if (mode !== 'host') return ''
  if (process.env.SVD_BROWSER_TOKEN) return process.env.SVD_BROWSER_TOKEN
  try { return readFileSync(process.env.SVD_BROWSER_TOKEN_FILE || '/config/local-browser.token', 'utf8').trim() } catch { return '' }
}

export class PublisherService {
  private running = false
  private pumpQueued = false
  private wakeTimer?: NodeJS.Timeout
  private safetyTimer?: NodeJS.Timeout
  private loginRunning = false
  private loginStatus: BrowserStatus['loginStatus'] = 'unknown'
  private message = '尚未检查抖音登录状态'
  private activeChild?: ChildProcess
  private activeBatchId?: string
  private cancelledBatches = new Set<string>()
  private skillScripts = path.join(process.env.SVD_SKILL_DIR || path.resolve(process.cwd(), 'skills/english-video-catalog'), 'scripts')
  private douyinScript = path.join(this.skillScripts, 'douyin_publisher.mjs')
  private multipostScript = path.join(this.skillScripts, 'multipost_publisher.mjs')
  private artifactDir = path.join(process.env.SVD_CONFIG_DIR || '/config', 'publish-artifacts')
  private tempDir = path.join(process.env.SVD_CONFIG_DIR || '/config', 'publish-temp')
  private browserMode: BrowserStatus['mode'] = process.env.SVD_BROWSER_MODE === 'host' ? 'host' : 'container'
  private browserUrl = process.env.SVD_BROWSER_CDP || 'http://browser:9222'
  private browserToken = loadBrowserToken(this.browserMode)
  constructor(private db: AppDatabase, private changed: () => void, private resolveMediaFile?: (assetId: string) => Promise<string>) {
    void this.resume()
    this.safetyTimer = setInterval(() => { void this.pump() }, 15_000)
    this.safetyTimer.unref?.()
  }
  wake() { void this.pump() }
  async status(): Promise<BrowserStatus> {
    let ready = false
    try { const response = await fetch(`${this.browserUrl}/json/version`, { headers: this.browserToken ? { authorization: `Bearer ${this.browserToken}` } : undefined, signal: AbortSignal.timeout(2500) }); ready = response.ok } catch { /* browser offline */ }
    const manageUrl = 'https://creator.douyin.com/creator-micro/content/manage'
    const platformAuth = Object.fromEntries(managedPlatforms.map(platform => [platform, this.readPlatformAuth(platform)]))
    return { ready, mode: this.browserMode, loginStatus: this.loginStatus, message: ready ? this.message : this.browserMode === 'host' ? '本地浏览器连接助手未启动' : '远程浏览器不可用', remoteUrl: this.browserMode === 'host' ? manageUrl : '/remote-browser/vnc.html?autoconnect=1&resize=scale', manageUrl, platformAuth }
  }
  login(platform = 'douyin') {
    if (this.loginRunning) return
    const target = isDouyinPublishPlatform(platform) ? undefined : multipostPlatform(platform)
    if (!isDouyinPublishPlatform(platform) && !target) throw new Error('发布平台无效')
    const label = target?.label
    if (managedPlatforms.includes(platform)) this.savePlatformAuth(platform, 'pending', '已打开登录页，登录后请点击“验证并启用”')
    this.loginRunning = true
    this.message = label ? `请在浏览器中登录${label}` : this.browserMode === 'host' ? '请在本地浏览器中扫码登录' : '请在站内远程浏览器中扫码登录'
    this.changed()
    const script = target ? this.multipostScript : this.douyinScript
    const args = target ? ['login', target.homeUrl] : ['login']
    void this.execute(script, args, event => {
      if (event.event === 'login_opened' && label) this.message = `已打开${label}登录页，请在浏览器中完成登录`
      if (event.event === 'login_ready') { this.loginStatus = 'ready'; this.message = '抖音创作者中心已登录' }
      if (event.event === 'error') { this.loginStatus = 'needs_attention'; this.message = String(event.message || '登录未完成') }
      this.changed()
    }).finally(() => { this.loginRunning = false; this.changed() })
  }
  async checkLogin(platform: string) {
    if (!managedPlatforms.includes(platform)) throw new Error('该平台暂不支持登录授权管理')
    const url = platformProbeUrls[platform]
    let result: { status: PublishPlatformAuthState; message: string } = { status: 'unknown', message: '未能确认登录状态，请检查页面后重试' }
    await this.execute(this.multipostScript, ['check-login', url], event => {
      if (event.event === 'login_checked') result = { status: event.status as PublishPlatformAuthState, message: String(event.message || '') }
      if (event.event === 'error') result = { status: 'unknown', message: String(event.message || '登录状态检查失败') }
    })
    this.savePlatformAuth(platform, result.status, result.message)
    return this.status()
  }
  private readPlatformAuth(platform: string): PublishPlatformAuth {
    try {
      const saved = this.db.meta(`publisher:auth:${platform}`)
      if (saved) return JSON.parse(saved) as PublishPlatformAuth
    } catch { /* ignore invalid persisted state */ }
    return { status: 'not_configured', message: '尚未配置登录' }
  }
  private savePlatformAuth(platform: string, status: PublishPlatformAuthState, message: string) {
    this.db.setMeta(`publisher:auth:${platform}`, JSON.stringify({ status, message, updatedAt: new Date().toISOString() } satisfies PublishPlatformAuth))
    this.changed()
  }
  create(jobs: PublishInput[], dispatchMode: PublishBatch['dispatchMode'], idempotencyKey?: string, platforms?: string[]) {
    if (!jobs.length) throw new Error('没有可发布的视频')
    if (!['platform', 'local'].includes(dispatchMode)) throw new Error('发布方式无效')
    const selected = resolvePublishPlatforms(platforms)
    if (dispatchMode === 'local' && selected.some(platform => !isDouyinPublishPlatform(platform))) throw new Error('本地定时仅用于抖音发布')
    if (dispatchMode === 'local' && jobs.length === 1) throw new Error('本地定时仅用于批量发布')
    if (idempotencyKey) { const existing = this.db.meta(`publish:${idempotencyKey}`); if (existing) return this.db.publishBatches().find(batch => batch.id === existing)! }
    const now = new Date(), id = randomUUID()
    const expanded = jobs.flatMap((input, index) => selected.map(platform => ({ input, index, platform })))
    const configuredCooldown = process.env.SVD_PUBLISH_COOLDOWN_MS
    const submissionTimes = dispatchMode === 'platform' ? submissionTimesForAssets(expanded.map(item => item.input.assetId), now, configuredCooldown) : []
    const items: PublishJob[] = expanded.map(({ input, index, platform }, expandedIndex) => {
      const douyin = isDouyinPublishPlatform(platform)
      const asset = this.db.asset(input.assetId); if (!asset) throw new Error('视频不存在')
      const title = input.title.trim(), topics = normalizePublishTopics(title, input.topics, [asset.analysis?.title || '', asset.analysis?.englishTitle || ''])
      const limit = douyin ? DOUYIN_TITLE_LIMIT : MULTIPOST_TITLE_LIMIT
      if (!title || [...title].length > limit) throw new Error(douyin ? '标题必须为 1–30 字符' : '标题必须为 1–100 字符')
      let publishAt: string | undefined, executeAt: string | undefined
      if (input.publishAt) {
        const date = new Date(input.publishAt); if (Number.isNaN(date.getTime())) throw new Error('发布时间无效')
        if (douyin) {
          const minimum = dispatchMode === 'local' ? 60_000 : 2 * 3600_000
          if (date.getTime() < now.getTime() + minimum) throw new Error(dispatchMode === 'local' ? '本地定时至少提前 1 分钟' : '平台排期至少提前 2 小时')
          if (dispatchMode === 'platform' && date.getTime() > now.getTime() + 7 * 24 * 3600_000) throw new Error('平台排期不能超过 7 天')
          if (dispatchMode === 'local') executeAt = date.toISOString(); else publishAt = date.toISOString()
        } else {
          if (date.getTime() < now.getTime() + 60_000) throw new Error('定时发布时间至少提前 1 分钟')
          publishAt = date.toISOString()
        }
      } else if (douyin && (dispatchMode === 'local' || (jobs.length > 1 && index > 0))) throw new Error('批量发布除首条立即发布外，其余任务必须指定排期时间')
      const submitAt = dispatchMode === 'local' ? executeAt : submissionTimes[expandedIndex]
      return { id: `${id}-${String(expandedIndex + 1).padStart(3, '0')}`, batchId: id, assetId: asset.id, platform, title, topics, summary: input.summary === undefined ? asset.analysis?.summary || '' : input.summary.trim(), publishAt, executeAt, submitAt, aigc: input.aigc !== false, waitForCovers: douyin && input.waitForCovers === true, status: dispatchMode === 'local' ? 'waiting_local' : 'queued' }
    })
    const batch: PublishBatch = { id, dispatchMode, status: dispatchMode === 'local' ? 'waiting_local' : 'queued', createdAt: now.toISOString(), updatedAt: now.toISOString(), jobs: items }
    this.db.createPublishBatch(batch); if (idempotencyKey) this.db.setMeta(`publish:${idempotencyKey}`, id); this.db.audit('publish.created', { id, count: items.length, dispatchMode }); if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = undefined; void this.pump(); this.changed(); return batch
  }
  retry(jobId: string) {
    const batch = this.db.publishBatches().find(value => value.jobs.some(job => job.id === jobId)); const job = batch?.jobs.find(value => value.id === jobId)
    if (!batch || !job || !['failed', 'needs_login', 'needs_attention', 'interrupted', 'cancelled'].includes(job.status)) throw new Error('该任务不能重试')
    this.cancelledBatches.delete(batch.id)
    const retryable = batch.jobs.filter(value => value.id === job.id || (value.id > job.id && value.status === 'interrupted' && value.error === '前一任务需要人工处理，批次已停止'))
    const configuredCooldown = process.env.SVD_PUBLISH_COOLDOWN_MS
    const retryNow = new Date()
    const submissionTimes = batch.dispatchMode === 'platform' ? submissionTimesForAssets(retryable.map(value => value.assetId), retryNow, configuredCooldown) : []
    retryable.forEach((value, index) => {
      const publishAt = batch.dispatchMode === 'platform' && isDouyinPublishPlatform(value.platform) && value.publishAt && new Date(value.publishAt).getTime() < Date.now() + 2 * 3600_000 + 60_000 ? nextSafePlatformPublishTime() : undefined
      this.db.updatePublishJob(value.id, batch.dispatchMode === 'local' && value.executeAt && new Date(value.executeAt) > new Date() ? 'waiting_local' : 'queued', { publishAt, submitAt: submissionTimes[index] })
    })
    this.db.updatePublishBatch(batch.id, batch.dispatchMode === 'local' ? 'waiting_local' : 'queued'); void this.pump(); this.changed()
  }
  cancelBatch(id: string) {
    const batch = this.db.publishBatches().find(value => value.id === id)
    if (!batch || !['queued', 'waiting_local', 'running'].includes(batch.status)) throw new Error('该批次不能取消')
    this.cancelledBatches.add(id)
    if (this.wakeTimer) { clearTimeout(this.wakeTimer); this.wakeTimer = undefined }
    if (this.activeBatchId === id) this.activeChild?.kill('SIGTERM')
    for (const job of batch.jobs) {
      if (cancellable.has(job.status)) this.db.updatePublishJob(job.id, 'cancelled', { error: '用户取消了发布任务' })
    }
    this.db.updatePublishBatch(id, this.finalizeBatchStatus(id))
    this.changed()
  }
  async deleteBatch(id: string) {
    const batch = this.db.publishBatches().find(value => value.id === id)
    if (!batch || !this.db.deletePublishBatch(id)) throw new Error('任务仍在执行或不存在')
    await Promise.all(batch.jobs.map(job => job.screenshot ? unlink(job.screenshot).catch(() => undefined) : Promise.resolve()))
    this.changed()
  }
  async clearHistory() {
    const finished = this.db.publishBatches().filter(batch => !['queued', 'waiting_local', 'running'].includes(batch.status))
    const screenshots = finished.flatMap(batch => batch.jobs.map(job => job.screenshot).filter((value): value is string => Boolean(value)))
    const count = this.db.clearPublishHistory()
    await Promise.all(screenshots.map(file => unlink(file).catch(() => undefined)))
    this.db.audit('publisher.history_cleared', { count })
    this.changed()
    return count
  }
  private finalizeBatchStatus(batchId: string): PublishBatch['status'] {
    const latest = this.db.publishBatches().find(value => value.id === batchId)!
    const states = [...new Set(latest.jobs.map(job => job.status))]
    if (states.every(value => ['submitted', 'published', 'scheduled'].includes(value))) return 'completed'
    if (states.every(value => value === 'cancelled')) return 'cancelled'
    if (states.every(value => ['submitted', 'published', 'scheduled', 'cancelled'].includes(value))) return 'partial'
    if (states.some(value => ['submitted', 'published', 'scheduled'].includes(value))) return 'partial'
    if (states.includes('needs_login') || states.includes('needs_attention')) return 'needs_attention'
    if (states.includes('cancelled') && states.every(value => terminal.has(value))) return 'cancelled'
    return 'failed'
  }
  private async resume() { await mkdir(this.artifactDir, { recursive: true }); await mkdir(this.tempDir, { recursive: true }); await this.pump() }
  private scheduleWake(delayMs: number) {
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    // Cap each timer so we re-check often even if the clock drifts or a wake is missed.
    const wait = Math.max(50, Math.min(delayMs, 15_000))
    this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; void this.pump() }, wait)
    this.wakeTimer.unref?.()
  }
  private recoverStuckBatches() {
    for (const batch of this.db.publishBatches()) {
      if (batch.status !== 'running') continue
      if (this.activeBatchId === batch.id) continue
      const pending = batch.jobs.some(job => ['queued', 'waiting_local'].includes(job.status))
      this.db.updatePublishBatch(batch.id, pending ? (batch.dispatchMode === 'local' ? 'waiting_local' : 'queued') : this.finalizeBatchStatus(batch.id))
      this.changed()
    }
  }
  private async pump() {
    if (this.running) { this.pumpQueued = true; return }
    this.running = true
    let nextWake: number | undefined
    try {
      this.recoverStuckBatches()
      for (const batch of this.db.publishBatches().reverse()) {
        if (!['queued', 'waiting_local'].includes(batch.status) || this.cancelledBatches.has(batch.id)) continue
        let deferred = false
        for (const original of batch.jobs) {
          if (this.cancelledBatches.has(batch.id)) break
          const current = this.db.publishBatches().find(value => value.id === batch.id)!.jobs.find(value => value.id === original.id)!
          if (!['queued', 'waiting_local'].includes(current.status)) continue
          const readyAt = current.submitAt || current.executeAt
          if (readyAt) {
            const delay = new Date(readyAt).getTime() - Date.now()
            if (delay > 0) {
              this.db.updatePublishJob(current.id, 'waiting_local')
              this.db.updatePublishBatch(batch.id, 'waiting_local')
              nextWake = Math.min(nextWake ?? delay, delay)
              deferred = true
              this.changed()
              break
            }
          }
          let runnable = current
          if (isDouyinPublishPlatform(current.platform) && batch.dispatchMode === 'platform' && current.publishAt && new Date(current.publishAt).getTime() < Date.now() + 2 * 3600_000 + 60_000) {
            const publishAt = nextSafePlatformPublishTime()
            this.db.updatePublishJob(current.id, current.status, { publishAt })
            runnable = { ...current, publishAt }
          }
          this.db.updatePublishBatch(batch.id, 'running')
          this.changed()
          await this.runJob(runnable)
          if (this.cancelledBatches.has(batch.id)) break
        }
        if (this.cancelledBatches.has(batch.id)) {
          this.db.updatePublishBatch(batch.id, this.finalizeBatchStatus(batch.id))
          this.cancelledBatches.delete(batch.id)
          this.changed()
          continue
        }
        if (deferred) continue
        this.db.updatePublishBatch(batch.id, this.finalizeBatchStatus(batch.id)); this.changed()
      }
    } finally {
      this.running = false
      if (nextWake !== undefined) this.scheduleWake(nextWake)
      if (this.pumpQueued) {
        this.pumpQueued = false
        void this.pump()
      }
    }
  }
  private async runJob(job: PublishJob) {
    if (this.cancelledBatches.has(job.batchId)) return false
    const asset = this.db.asset(job.assetId)!, mediaFile = this.resolveMediaFile ? await this.resolveMediaFile(asset.id) : asset.file; const payloadPath = path.join(this.tempDir, `${job.id}.json`)
    const douyin = isDouyinPublishPlatform(job.platform)
    const cover = path.join(process.env.SVD_CONFIG_DIR || '/config', 'thumbnails', `${asset.id}.jpg`)
    const payload = douyin
      ? { jobId: job.id, file: mediaFile, title: job.title, topics: job.topics, publishAt: job.publishAt, aigc: job.aigc, waitForCovers: job.waitForCovers, artifactDir: this.artifactDir }
      : { jobId: job.id, platform: job.platform, injectUrl: multipostPlatform(job.platform)?.injectUrl, injectorHost: multipostPlatform(job.platform)?.injectorHost, file: mediaFile, title: job.title, shortTitle: job.title, topics: job.topics, summary: job.summary ?? asset.analysis?.summary ?? '', publishAt: job.publishAt, coverFile: existsSync(cover) ? cover : undefined, artifactDir: this.artifactDir }
    await writeFile(payloadPath, JSON.stringify(payload))
    let succeeded = false
    await this.execute(douyin ? this.douyinScript : this.multipostScript, ['publish', payloadPath], event => {
      if (this.cancelledBatches.has(job.batchId)) return
      const latest = this.db.publishBatches().find(value => value.id === job.batchId)?.jobs.find(value => value.id === job.id)
      if (latest?.status === 'cancelled') return
      const name = String(event.event)
      if (['launching', 'waiting_login', 'uploading', 'scheduling', 'waiting_covers', 'submitting', 'submitted', 'published', 'scheduled'].includes(name)) {
        this.db.updatePublishJob(job.id, name as PublishJob['status'], { screenshot: event.screenshot ? String(event.screenshot) : undefined })
        succeeded = name === 'submitted' || name === 'published' || name === 'scheduled'
        if (succeeded) this.db.setAssetState(job.assetId, 'processed')
        if (name === 'waiting_login') {
          this.loginStatus = 'needs_login'
          this.message = '发布时检测到平台登录已失效，请在发布浏览器中扫码；登录后会继续发布'
          if (managedPlatforms.includes(job.platform)) this.savePlatformAuth(job.platform, 'needs_login', '发布时平台跳转到登录页，请扫码登录；完成后发布会继续')
        }
      }
      if (name === 'error') { const message = String(event.message || '发布失败'); const status = message.includes('LOGIN_REQUIRED') ? 'needs_login' : message.includes('MANUAL_REVIEW_REQUIRED') ? 'needs_attention' : 'failed'; this.db.updatePublishJob(job.id, status, { error: message, screenshot: event.screenshot ? String(event.screenshot) : undefined }); if (status === 'needs_login' && managedPlatforms.includes(job.platform)) this.savePlatformAuth(job.platform, 'needs_login', '发布时检测到未登录，请重新登录并验证'); this.loginStatus = status === 'needs_login' ? 'needs_login' : status === 'needs_attention' ? 'needs_attention' : this.loginStatus; this.message = message }
      this.changed()
    }, job.batchId)
    await unlink(payloadPath).catch(() => undefined)
    const latest = this.db.publishBatches().find(value => value.id === job.batchId)?.jobs.find(value => value.id === job.id)
    if (this.cancelledBatches.has(job.batchId) || latest?.status === 'cancelled') {
      if (latest && cancellable.has(latest.status)) this.db.updatePublishJob(job.id, 'cancelled', { error: '用户取消了发布任务' })
      return false
    }
    if (succeeded) {
      this.loginStatus = 'ready'
      this.message = douyin ? '抖音发布服务已就绪' : `${publishPlatformLabel(job.platform)}发布流程已结束`
      if (managedPlatforms.includes(job.platform)) this.savePlatformAuth(job.platform, 'authorized', '发布时已确认平台登录有效')
      this.changed()
    }
    return succeeded
  }
  private execute(script: string, args: string[], onEvent: (event: Record<string, unknown>) => void, batchId?: string) {
    return new Promise<void>(resolve => {
      const child = spawn('node', [script, ...args], { env: { ...process.env, DOUYIN_CDP_URL: this.browserUrl, DOUYIN_CDP_TOKEN: this.browserToken }, windowsHide: true }); let buffer = '', terminalTimer: NodeJS.Timeout | undefined, timeoutTimer: NodeJS.Timeout | undefined, killTimer: NodeJS.Timeout | undefined, hasTerminalEvent = false, timedOut = false, finished = false
      if (batchId) { this.activeChild = child; this.activeBatchId = batchId }
      const finish = () => {
        if (finished) return
        finished = true
        if (terminalTimer) clearTimeout(terminalTimer)
        if (timeoutTimer) clearTimeout(timeoutTimer)
        if (killTimer) clearTimeout(killTimer)
        if (batchId && this.activeChild === child) { this.activeChild = undefined; this.activeBatchId = undefined }
        resolve()
      }
      const consumeEvent = (event: Record<string, unknown>) => {
        if (['submitted', 'published', 'scheduled', 'error', 'login_opened', 'login_ready', 'login_checked'].includes(String(event.event))) hasTerminalEvent = true
        onEvent(event)
        // A remote CDP websocket can keep Node alive after the page has closed. Once
        // the publisher reports a terminal result, give cleanup a short grace period
        // and then release the queue even if that connection is still holding open.
        if (batchId && ['submitted', 'published', 'scheduled', 'error'].includes(String(event.event)) && !terminalTimer) {
          const grace = Math.max(50, Number(process.env.SVD_PUBLISH_TERMINAL_GRACE_MS || 5_000) || 5_000)
          terminalTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM') }, grace)
          terminalTimer.unref?.()
        }
      }
      const consume = (value: Buffer) => { buffer += value.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; for (const line of lines) { try { consumeEvent(JSON.parse(line)) } catch { /* ignore browser diagnostics */ } } }
      const timeout = Math.max(1, Number(process.env.SVD_PUBLISH_JOB_TIMEOUT_MS) || publishTimeoutMs)
      if (batchId) {
        timeoutTimer = setTimeout(() => {
          timedOut = true
          consumeEvent({ event: 'error', message: `MANUAL_REVIEW_REQUIRED：发布流程超过 ${Math.round(timeout / 60_000)} 分钟，已停止；请先到平台确认是否已发布` })
          child.kill('SIGTERM')
          killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 5_000)
          killTimer.unref?.()
        }, timeout)
        timeoutTimer.unref?.()
      }
      child.stdout.on('data', consume); child.stderr.on('data', consume)
      child.on('error', error => { consumeEvent({ event: 'error', message: `发布子进程启动失败：${error.message}` }); finish() })
      child.on('close', (code, signal) => {
        if (buffer.trim()) { try { consumeEvent(JSON.parse(buffer)) } catch { /* ignore */ } }
        if (!hasTerminalEvent) {
          const detail = timedOut ? '发布子进程在超时后退出' : `发布子进程意外退出（${signal ? `信号 ${signal}` : `退出码 ${code}`}），没有返回发布结果`
          consumeEvent({ event: 'error', message: `MANUAL_REVIEW_REQUIRED：${detail}；请先到平台确认是否已发布` })
        }
        finish()
      })
    })
  }
}
