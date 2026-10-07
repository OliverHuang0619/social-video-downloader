import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AnalysisJob, AnalysisResult, CreatorSubscription, DownloadJob, MediaAsset, Platform, PublishBatch, PublishJob, RemakeJob, SubscriptionNotification } from '../shared/types'

const configDir = process.env.SVD_CONFIG_DIR || path.join(process.cwd(), 'config')
mkdirSync(configDir, { recursive: true })

export class AppDatabase {
  readonly sqlite = new DatabaseSync(path.join(configDir, 'workbench.sqlite'))

  constructor() {
    this.sqlite.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY, file TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, source_url TEXT, platform TEXT,
        uploader TEXT, duration REAL, thumbnail TEXT, published_at TEXT, processing_state TEXT NOT NULL DEFAULT 'unprocessed',
        analysis_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analysis_jobs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, asset_ids TEXT NOT NULL, progress REAL NOT NULL,
        message TEXT NOT NULL, error TEXT, output_dir TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS publish_batches (
        id TEXT PRIMARY KEY, dispatch_mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publish_jobs (
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES publish_batches(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES media_assets(id), platform TEXT NOT NULL DEFAULT 'douyin', title TEXT NOT NULL, topics TEXT NOT NULL,
        publish_at TEXT, execute_at TEXT, submit_at TEXT, aigc INTEGER NOT NULL, wait_for_covers INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL, error TEXT, screenshot TEXT
      );
      CREATE TABLE IF NOT EXISTS download_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remake_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS creator_subscriptions (
        id TEXT PRIMARY KEY, platform TEXT NOT NULL, source_url TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
        auto_download INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
        last_polled_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subscription_seen_items (
        subscription_id TEXT NOT NULL REFERENCES creator_subscriptions(id) ON DELETE CASCADE,
        media_key TEXT NOT NULL, PRIMARY KEY (subscription_id, media_key)
      );
      CREATE TABLE IF NOT EXISTS subscription_notifications (
        id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES creator_subscriptions(id) ON DELETE CASCADE,
        media_key TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT NOT NULL, thumbnail TEXT,
        download_job_id TEXT, read_at TEXT, created_at TEXT NOT NULL
      );
    `)
    const publishJobColumns = this.sqlite.prepare('PRAGMA table_info(publish_jobs)').all() as Array<{ name: string }>
    if (!publishJobColumns.some(column => column.name === 'summary')) this.sqlite.exec('ALTER TABLE publish_jobs ADD COLUMN summary TEXT')
    const analysisColumns = new Set((this.sqlite.prepare('PRAGMA table_info(analysis_jobs)').all() as { name: string }[]).map(column => column.name))
    if (!analysisColumns.has('detail_json')) this.sqlite.exec("ALTER TABLE analysis_jobs ADD COLUMN detail_json TEXT NOT NULL DEFAULT '{}'")
    const publishColumns = new Set((this.sqlite.prepare('PRAGMA table_info(publish_jobs)').all() as { name: string }[]).map(column => column.name))
    if (!publishColumns.has('wait_for_covers')) this.sqlite.exec('ALTER TABLE publish_jobs ADD COLUMN wait_for_covers INTEGER NOT NULL DEFAULT 0')
    if (!publishColumns.has('submit_at')) this.sqlite.exec('ALTER TABLE publish_jobs ADD COLUMN submit_at TEXT')
    if (!publishColumns.has('platform')) this.sqlite.exec("ALTER TABLE publish_jobs ADD COLUMN platform TEXT NOT NULL DEFAULT 'douyin'")
    this.sqlite.exec("UPDATE analysis_jobs SET status='failed', error='服务重启，原分析任务已中断', updated_at=datetime('now') WHERE status IN ('queued','preparing','analyzing')")
    this.sqlite.exec("UPDATE publish_jobs SET status='interrupted', error='服务曾在发布过程中重启，请先到对应平台确认是否已经发布' WHERE status IN ('launching','waiting_login','uploading','scheduling','waiting_covers','submitting')")
    this.sqlite.exec("UPDATE publish_batches SET status='interrupted', updated_at=datetime('now') WHERE status='running'")
    this.sqlite.exec("UPDATE media_assets SET processing_state='processed', updated_at=datetime('now') WHERE id IN (SELECT asset_id FROM publish_jobs WHERE status IN ('published','scheduled'))")
    this.sqlite.exec("UPDATE publish_batches SET status='completed', updated_at=datetime('now') WHERE status='interrupted' AND EXISTS (SELECT 1 FROM publish_jobs WHERE batch_id=publish_batches.id) AND NOT EXISTS (SELECT 1 FROM publish_jobs WHERE batch_id=publish_batches.id AND status NOT IN ('published','scheduled'))")
    // Resume batches that still have pending local submissions after a restart left them interrupted.
    this.sqlite.exec("UPDATE publish_batches SET status='queued', updated_at=datetime('now') WHERE status='interrupted' AND EXISTS (SELECT 1 FROM publish_jobs WHERE batch_id=publish_batches.id AND status IN ('queued','waiting_local'))")
    this.sqlite.exec("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    const interruptedDownloads = this.sqlite.prepare('SELECT id,payload FROM download_jobs').all() as { id: string; payload: string }[]
    for (const row of interruptedDownloads) {
      const job = JSON.parse(row.payload) as DownloadJob
      if (['queued', 'downloading'].includes(job.status)) { job.status = 'failed'; job.error = '服务重启，原下载任务已中断'; job.detail = undefined; this.saveDownload(job) }
    }
    for (const row of this.sqlite.prepare('SELECT id,payload FROM remake_jobs').all() as { id: string; payload: string }[]) {
      const job = JSON.parse(row.payload) as RemakeJob
      if (['queued', 'preparing', 'directing', 'building'].includes(job.status)) { job.status = 'failed'; job.error = '服务重启，原 Hypit 任务已中断；工程文件已保留'; job.message = '任务已中断'; this.saveRemake(job) }
    }
  }

  meta(key: string) { return (this.sqlite.prepare('SELECT value FROM app_meta WHERE key=?').get(key) as { value: string } | undefined)?.value }
  setMeta(key: string, value: string) { this.sqlite.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value) }
  audit(event: string, detail: unknown) { this.sqlite.prepare('INSERT INTO audit_log(event,detail,created_at) VALUES(?,?,?)').run(event, JSON.stringify(detail), new Date().toISOString()) }

  upsertAsset(value: Omit<MediaAsset, 'createdAt' | 'updatedAt'> & Partial<Pick<MediaAsset, 'createdAt' | 'updatedAt'>>) {
    const now = new Date().toISOString()
    this.sqlite.prepare(`INSERT INTO media_assets(id,file,filename,source_url,platform,uploader,duration,thumbnail,published_at,processing_state,analysis_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(file) DO UPDATE SET
      source_url=COALESCE(excluded.source_url,source_url), platform=COALESCE(excluded.platform,platform), uploader=COALESCE(excluded.uploader,uploader),
      duration=COALESCE(excluded.duration,duration), thumbnail=COALESCE(excluded.thumbnail,thumbnail), published_at=COALESCE(excluded.published_at,published_at),
      processing_state=CASE WHEN excluded.processing_state='processed' THEN 'processed' ELSE processing_state END,
      analysis_json=COALESCE(excluded.analysis_json,analysis_json), updated_at=excluded.updated_at`).run(
        value.id, value.file, value.filename, value.sourceUrl || null, value.platform || null, value.uploader || null,
        value.duration ?? null, value.thumbnail || null, value.publishedAt || null, value.processingState,
        value.analysis ? JSON.stringify(value.analysis) : null, value.createdAt || now, value.updatedAt || now,
      )
    return this.assetByFile(value.file)!
  }

  private mapAsset(row: Record<string, unknown>): MediaAsset {
    return {
      id: String(row.id), file: String(row.file), filename: String(row.filename), sourceUrl: row.source_url ? String(row.source_url) : undefined,
      platform: row.platform as MediaAsset['platform'], uploader: row.uploader ? String(row.uploader) : undefined,
      duration: row.duration === null ? undefined : Number(row.duration), thumbnail: row.thumbnail ? String(row.thumbnail) : undefined,
      publishedAt: row.published_at ? String(row.published_at) : undefined, processingState: row.processing_state as MediaAsset['processingState'],
      analysis: row.analysis_json ? JSON.parse(String(row.analysis_json)) as AnalysisResult : undefined,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }
  assets() { return (this.sqlite.prepare('SELECT * FROM media_assets ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(row => this.mapAsset(row)) }
  asset(id: string) { const row = this.sqlite.prepare('SELECT * FROM media_assets WHERE id=?').get(id) as Record<string, unknown> | undefined; return row ? this.mapAsset(row) : undefined }
  assetByFile(file: string) { const row = this.sqlite.prepare('SELECT * FROM media_assets WHERE file=?').get(file) as Record<string, unknown> | undefined; return row ? this.mapAsset(row) : undefined }
  setAssetState(id: string, state: MediaAsset['processingState']) { this.sqlite.prepare('UPDATE media_assets SET processing_state=?,updated_at=? WHERE id=?').run(state, new Date().toISOString(), id); return this.asset(id) }
  setAnalysis(id: string, analysis: AnalysisResult) { this.sqlite.prepare('UPDATE media_assets SET analysis_json=?,updated_at=? WHERE id=?').run(JSON.stringify(analysis), new Date().toISOString(), id) }
  /** Assets referenced by an analysis job or publish job that is still running. */
  busyAssetIds(ids: string[]) {
    const wanted = new Set(ids), busy = new Set<string>()
    for (const row of this.sqlite.prepare("SELECT asset_ids FROM analysis_jobs WHERE status IN ('queued','preparing','analyzing')").all() as { asset_ids: string }[]) for (const id of JSON.parse(row.asset_ids) as string[]) if (wanted.has(id)) busy.add(id)
    for (const row of this.sqlite.prepare("SELECT asset_id FROM publish_jobs WHERE status IN ('queued','waiting_local','launching','waiting_login','uploading','scheduling','waiting_covers','submitting')").all() as { asset_id: string }[]) if (wanted.has(row.asset_id)) busy.add(row.asset_id)
    for (const row of this.sqlite.prepare('SELECT payload FROM remake_jobs').all() as { payload: string }[]) {
      const job = JSON.parse(row.payload) as RemakeJob
      if (['queued', 'preparing', 'directing', 'building'].includes(job.status)) for (const id of job.assetIds) if (wanted.has(id)) busy.add(id)
    }
    return busy
  }
  /** Removes assets together with their publish history; batches left empty are removed too. */
  deleteAssets(ids: string[]) {
    if (!ids.length) return 0
    this.sqlite.exec('BEGIN')
    try {
      const placeholders = ids.map(() => '?').join(',')
      this.sqlite.prepare(`DELETE FROM publish_jobs WHERE asset_id IN (${placeholders})`).run(...ids)
      this.sqlite.exec('DELETE FROM publish_batches WHERE NOT EXISTS (SELECT 1 FROM publish_jobs WHERE batch_id=publish_batches.id)')
      const count = this.sqlite.prepare(`DELETE FROM media_assets WHERE id IN (${placeholders})`).run(...ids).changes
      this.sqlite.exec('COMMIT')
      return count
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error }
  }

  saveDownload(job: DownloadJob) { this.sqlite.prepare('INSERT INTO download_jobs(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(job.id, JSON.stringify(job), new Date().toISOString()) }
  downloads() { return (this.sqlite.prepare('SELECT payload FROM download_jobs ORDER BY updated_at DESC').all() as { payload: string }[]).map(row => JSON.parse(row.payload) as DownloadJob) }

  saveRemake(job: RemakeJob) { this.sqlite.prepare('INSERT INTO remake_jobs(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(job.id, JSON.stringify(job), job.updatedAt) }
  remake(id: string) { const row = this.sqlite.prepare('SELECT payload FROM remake_jobs WHERE id=?').get(id) as { payload: string } | undefined; return row ? JSON.parse(row.payload) as RemakeJob : undefined }
  remakes() { return (this.sqlite.prepare('SELECT payload FROM remake_jobs ORDER BY updated_at DESC').all() as { payload: string }[]).map(row => JSON.parse(row.payload) as RemakeJob) }
  deleteRemake(id: string) { const job = this.remake(id); if (!job || ['queued', 'preparing', 'directing', 'building'].includes(job.status)) return false; return this.sqlite.prepare('DELETE FROM remake_jobs WHERE id=?').run(id).changes > 0 }
  clearRemakeHistory() {
    let count = 0
    for (const job of this.remakes()) {
      if (['queued', 'preparing', 'directing', 'building'].includes(job.status)) continue
      if (this.deleteRemake(job.id)) count += 1
    }
    return count
  }

  createAnalysis(job: AnalysisJob, outputDir: string) { this.sqlite.prepare('INSERT INTO analysis_jobs(id,status,asset_ids,progress,message,error,output_dir,created_at,updated_at,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run(job.id, job.status, JSON.stringify(job.assetIds), job.progress, job.message, job.error || null, outputDir, job.createdAt, job.updatedAt, JSON.stringify({ currentItem: job.currentItem, processedItems: job.processedItems, totalItems: job.totalItems, logs: job.logs })) }
  updateAnalysis(id: string, values: Partial<Pick<AnalysisJob, 'status' | 'progress' | 'message' | 'error' | 'currentItem' | 'processedItems' | 'totalItems' | 'logs'>>) {
    const current = this.analysis(id); if (!current) return
    const next = { ...current, ...values, updatedAt: new Date().toISOString() }
    this.sqlite.prepare('UPDATE analysis_jobs SET status=?,progress=?,message=?,error=?,detail_json=?,updated_at=? WHERE id=?').run(next.status, next.progress, next.message, next.error || null, JSON.stringify({ currentItem: next.currentItem, processedItems: next.processedItems, totalItems: next.totalItems, logs: next.logs }), next.updatedAt, id)
    return next
  }
  analysis(id: string): AnalysisJob | undefined {
    const row = this.sqlite.prepare('SELECT * FROM analysis_jobs WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) return undefined
    const detail = JSON.parse(String(row.detail_json || '{}')) as Partial<Pick<AnalysisJob, 'currentItem' | 'processedItems' | 'totalItems' | 'logs'>>
    return { id: String(row.id), status: row.status as AnalysisJob['status'], assetIds: JSON.parse(String(row.asset_ids)), progress: Number(row.progress), message: String(row.message), currentItem: detail.currentItem, processedItems: Number(detail.processedItems || 0), totalItems: Number(detail.totalItems || JSON.parse(String(row.asset_ids)).length), logs: Array.isArray(detail.logs) ? detail.logs : [], error: row.error ? String(row.error) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }
  analysisOutputDir(id: string) { return (this.sqlite.prepare('SELECT output_dir FROM analysis_jobs WHERE id=?').get(id) as { output_dir: string } | undefined)?.output_dir }
  analyses() { return (this.sqlite.prepare('SELECT id FROM analysis_jobs ORDER BY created_at DESC').all() as { id: string }[]).map(row => this.analysis(row.id)!) }
  deleteAnalysis(id: string) { return this.sqlite.prepare("DELETE FROM analysis_jobs WHERE id=? AND status NOT IN ('queued','preparing','analyzing')").run(id).changes > 0 }
  clearAnalysisHistory() { return this.sqlite.prepare("DELETE FROM analysis_jobs WHERE status NOT IN ('queued','preparing','analyzing')").run().changes }

  createPublishBatch(batch: PublishBatch) {
    this.sqlite.exec('BEGIN')
    try {
      this.sqlite.prepare('INSERT INTO publish_batches VALUES(?,?,?,?,?)').run(batch.id, batch.dispatchMode, batch.status, batch.createdAt, batch.updatedAt)
      const insert = this.sqlite.prepare('INSERT INTO publish_jobs (id,batch_id,asset_id,platform,title,topics,summary,publish_at,execute_at,submit_at,aigc,wait_for_covers,status,error,screenshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      for (const job of batch.jobs) insert.run(job.id, batch.id, job.assetId, job.platform || 'douyin', job.title, JSON.stringify(job.topics), job.summary ?? null, job.publishAt || null, job.executeAt || null, job.submitAt || null, job.aigc ? 1 : 0, job.waitForCovers ? 1 : 0, job.status, job.error || null, job.screenshot || null)
      this.sqlite.exec('COMMIT')
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error }
  }
  updatePublishJob(id: string, status: PublishJob['status'], values: { error?: string; screenshot?: string; publishAt?: string; submitAt?: string } = {}) { this.sqlite.prepare('UPDATE publish_jobs SET status=?,error=?,screenshot=COALESCE(?,screenshot),publish_at=COALESCE(?,publish_at),submit_at=COALESCE(?,submit_at) WHERE id=?').run(status, values.error || null, values.screenshot || null, values.publishAt || null, values.submitAt || null, id) }
  updatePublishBatch(id: string, status: PublishBatch['status']) { this.sqlite.prepare('UPDATE publish_batches SET status=?,updated_at=? WHERE id=?').run(status, new Date().toISOString(), id) }
  publishBatches(): PublishBatch[] {
    const batches = this.sqlite.prepare('SELECT * FROM publish_batches ORDER BY created_at DESC').all() as Record<string, unknown>[]
    const jobsFor = this.sqlite.prepare('SELECT * FROM publish_jobs WHERE batch_id=? ORDER BY id')
    return batches.map(row => ({ id: String(row.id), dispatchMode: row.dispatch_mode as PublishBatch['dispatchMode'], status: row.status as PublishBatch['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), jobs: (jobsFor.all(String(row.id)) as Record<string, unknown>[]).map(job => ({ id: String(job.id), batchId: String(job.batch_id), assetId: String(job.asset_id), platform: job.platform ? String(job.platform) : 'douyin', title: String(job.title), topics: JSON.parse(String(job.topics)), summary: job.summary === null || job.summary === undefined ? undefined : String(job.summary), publishAt: job.publish_at ? String(job.publish_at) : undefined, executeAt: job.execute_at ? String(job.execute_at) : undefined, submitAt: job.submit_at ? String(job.submit_at) : undefined, aigc: Boolean(job.aigc), waitForCovers: Boolean(job.wait_for_covers), status: job.status as PublishJob['status'], error: job.error ? String(job.error) : undefined, screenshot: job.screenshot ? String(job.screenshot) : undefined })) }))
  }
  deletePublishBatch(id: string) { return this.sqlite.prepare("DELETE FROM publish_batches WHERE id=? AND status NOT IN ('queued','waiting_local','running')").run(id).changes > 0 }
  clearPublishHistory() {
    let count = 0
    for (const batch of this.publishBatches()) {
      if (['queued', 'waiting_local', 'running'].includes(batch.status)) continue
      if (this.deletePublishBatch(batch.id)) count += 1
    }
    return count
  }

  private mapSubscription(row: Record<string, unknown>): CreatorSubscription {
    return {
      id: String(row.id), platform: row.platform as Platform, sourceUrl: String(row.source_url), displayName: String(row.display_name),
      autoDownload: Boolean(row.auto_download), enabled: Boolean(row.enabled),
      lastPolledAt: row.last_polled_at ? String(row.last_polled_at) : undefined,
      lastError: row.last_error ? String(row.last_error) : undefined,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }
  subscriptions() {
    return (this.sqlite.prepare('SELECT * FROM creator_subscriptions ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(row => this.mapSubscription(row))
  }
  subscription(id: string) {
    const row = this.sqlite.prepare('SELECT * FROM creator_subscriptions WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? this.mapSubscription(row) : undefined
  }
  subscriptionByUrl(sourceUrl: string) {
    const row = this.sqlite.prepare('SELECT * FROM creator_subscriptions WHERE source_url=?').get(sourceUrl) as Record<string, unknown> | undefined
    return row ? this.mapSubscription(row) : undefined
  }
  createSubscription(value: Omit<CreatorSubscription, 'createdAt' | 'updatedAt' | 'lastPolledAt' | 'lastError'> & Partial<Pick<CreatorSubscription, 'lastPolledAt' | 'lastError'>>) {
    const now = new Date().toISOString()
    this.sqlite.prepare(`INSERT INTO creator_subscriptions(id,platform,source_url,display_name,auto_download,enabled,last_polled_at,last_error,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(value.id, value.platform, value.sourceUrl, value.displayName, value.autoDownload ? 1 : 0, value.enabled ? 1 : 0, value.lastPolledAt || null, value.lastError || null, now, now)
    return this.subscription(value.id)!
  }
  updateSubscription(id: string, values: Partial<Pick<CreatorSubscription, 'displayName' | 'autoDownload' | 'enabled' | 'lastPolledAt' | 'lastError'>>) {
    const current = this.subscription(id); if (!current) return undefined
    const next = {
      displayName: values.displayName ?? current.displayName,
      autoDownload: values.autoDownload ?? current.autoDownload,
      enabled: values.enabled ?? current.enabled,
      lastPolledAt: 'lastPolledAt' in values ? values.lastPolledAt : current.lastPolledAt,
      lastError: 'lastError' in values ? values.lastError : current.lastError,
    }
    this.sqlite.prepare('UPDATE creator_subscriptions SET display_name=?,auto_download=?,enabled=?,last_polled_at=?,last_error=?,updated_at=? WHERE id=?')
      .run(next.displayName, next.autoDownload ? 1 : 0, next.enabled ? 1 : 0, next.lastPolledAt || null, next.lastError || null, new Date().toISOString(), id)
    return this.subscription(id)
  }
  deleteSubscription(id: string) {
    return this.sqlite.prepare('DELETE FROM creator_subscriptions WHERE id=?').run(id).changes > 0
  }
  seenKeys(subscriptionId: string) {
    return new Set((this.sqlite.prepare('SELECT media_key FROM subscription_seen_items WHERE subscription_id=?').all(subscriptionId) as { media_key: string }[]).map(row => row.media_key))
  }
  markSeen(subscriptionId: string, mediaKeys: string[]) {
    if (!mediaKeys.length) return
    const insert = this.sqlite.prepare('INSERT OR IGNORE INTO subscription_seen_items(subscription_id,media_key) VALUES(?,?)')
    this.sqlite.exec('BEGIN')
    try {
      for (const key of mediaKeys) insert.run(subscriptionId, key)
      this.sqlite.exec('COMMIT')
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error }
  }
  private mapNotification(row: Record<string, unknown>): SubscriptionNotification {
    return {
      id: String(row.id), subscriptionId: String(row.subscription_id), mediaKey: String(row.media_key),
      title: String(row.title), sourceUrl: String(row.source_url),
      thumbnail: row.thumbnail ? String(row.thumbnail) : undefined,
      downloadJobId: row.download_job_id ? String(row.download_job_id) : undefined,
      readAt: row.read_at ? String(row.read_at) : undefined, createdAt: String(row.created_at),
      displayName: row.display_name ? String(row.display_name) : undefined,
      platform: row.platform ? row.platform as Platform : undefined,
    }
  }
  createNotification(value: Omit<SubscriptionNotification, 'createdAt' | 'readAt' | 'displayName' | 'platform'> & Partial<Pick<SubscriptionNotification, 'readAt' | 'downloadJobId'>>) {
    const now = new Date().toISOString()
    this.sqlite.prepare(`INSERT INTO subscription_notifications(id,subscription_id,media_key,title,source_url,thumbnail,download_job_id,read_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(value.id, value.subscriptionId, value.mediaKey, value.title, value.sourceUrl, value.thumbnail || null, value.downloadJobId || null, value.readAt || null, now)
    return this.notification(value.id)!
  }
  setNotificationDownloadJob(id: string, downloadJobId: string) {
    this.sqlite.prepare('UPDATE subscription_notifications SET download_job_id=? WHERE id=?').run(downloadJobId, id)
  }
  notification(id: string) {
    const row = this.sqlite.prepare(`SELECT n.*, s.display_name, s.platform FROM subscription_notifications n
      LEFT JOIN creator_subscriptions s ON s.id=n.subscription_id WHERE n.id=?`).get(id) as Record<string, unknown> | undefined
    return row ? this.mapNotification(row) : undefined
  }
  notifications(limit = 100) {
    return (this.sqlite.prepare(`SELECT n.*, s.display_name, s.platform FROM subscription_notifications n
      LEFT JOIN creator_subscriptions s ON s.id=n.subscription_id ORDER BY n.created_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[]).map(row => this.mapNotification(row))
  }
  unreadNotificationCount() {
    return Number((this.sqlite.prepare('SELECT COUNT(*) AS count FROM subscription_notifications WHERE read_at IS NULL').get() as { count: number }).count)
  }
  markNotificationsRead(ids?: string[], all = false) {
    const now = new Date().toISOString()
    if (all) return this.sqlite.prepare('UPDATE subscription_notifications SET read_at=? WHERE read_at IS NULL').run(now).changes
    if (!ids?.length) return 0
    const placeholders = ids.map(() => '?').join(',')
    return this.sqlite.prepare(`UPDATE subscription_notifications SET read_at=? WHERE id IN (${placeholders}) AND read_at IS NULL`).run(now, ...ids).changes
  }
  assetBySourceUrl(sourceUrl: string) {
    const row = this.sqlite.prepare('SELECT * FROM media_assets WHERE source_url=?').get(sourceUrl) as Record<string, unknown> | undefined
    return row ? this.mapAsset(row) : undefined
  }
}
