import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AnalysisJob, AnalysisResult, DownloadJob, MediaAsset, PublishBatch, PublishJob } from '../shared/types'

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
        asset_id TEXT NOT NULL REFERENCES media_assets(id), title TEXT NOT NULL, topics TEXT NOT NULL,
        publish_at TEXT, execute_at TEXT, aigc INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, screenshot TEXT
      );
      CREATE TABLE IF NOT EXISTS download_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
    `)
    const analysisColumns = new Set((this.sqlite.prepare('PRAGMA table_info(analysis_jobs)').all() as { name: string }[]).map(column => column.name))
    if (!analysisColumns.has('detail_json')) this.sqlite.exec("ALTER TABLE analysis_jobs ADD COLUMN detail_json TEXT NOT NULL DEFAULT '{}'")
    this.sqlite.exec("UPDATE analysis_jobs SET status='failed', error='服务重启，原分析任务已中断', updated_at=datetime('now') WHERE status IN ('queued','preparing','analyzing')")
    this.sqlite.exec("UPDATE publish_jobs SET status='interrupted', error='服务曾在发布过程中重启，请先到抖音作品管理确认' WHERE status IN ('launching','uploading','scheduling','waiting_covers','submitting')")
    this.sqlite.exec("UPDATE publish_batches SET status='interrupted', updated_at=datetime('now') WHERE status='running'")
    this.sqlite.exec("UPDATE media_assets SET processing_state='processed', updated_at=datetime('now') WHERE id IN (SELECT asset_id FROM publish_jobs WHERE status IN ('published','scheduled'))")
    this.sqlite.exec("UPDATE publish_batches SET status='completed', updated_at=datetime('now') WHERE status='interrupted' AND EXISTS (SELECT 1 FROM publish_jobs WHERE batch_id=publish_batches.id) AND NOT EXISTS (SELECT 1 FROM publish_jobs WHERE batch_id=publish_batches.id AND status NOT IN ('published','scheduled'))")
    this.sqlite.exec("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    const interruptedDownloads = this.sqlite.prepare('SELECT id,payload FROM download_jobs').all() as { id: string; payload: string }[]
    for (const row of interruptedDownloads) {
      const job = JSON.parse(row.payload) as DownloadJob
      if (['queued', 'downloading'].includes(job.status)) { job.status = 'failed'; job.error = '服务重启，原下载任务已中断'; job.detail = undefined; this.saveDownload(job) }
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

  saveDownload(job: DownloadJob) { this.sqlite.prepare('INSERT INTO download_jobs(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(job.id, JSON.stringify(job), new Date().toISOString()) }
  downloads() { return (this.sqlite.prepare('SELECT payload FROM download_jobs ORDER BY updated_at DESC').all() as { payload: string }[]).map(row => JSON.parse(row.payload) as DownloadJob) }

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
      const insert = this.sqlite.prepare('INSERT INTO publish_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      for (const job of batch.jobs) insert.run(job.id, batch.id, job.assetId, job.title, JSON.stringify(job.topics), job.publishAt || null, job.executeAt || null, job.aigc ? 1 : 0, job.status, job.error || null, job.screenshot || null)
      this.sqlite.exec('COMMIT')
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error }
  }
  updatePublishJob(id: string, status: PublishJob['status'], values: { error?: string; screenshot?: string } = {}) { this.sqlite.prepare('UPDATE publish_jobs SET status=?,error=?,screenshot=COALESCE(?,screenshot) WHERE id=?').run(status, values.error || null, values.screenshot || null, id) }
  updatePublishBatch(id: string, status: PublishBatch['status']) { this.sqlite.prepare('UPDATE publish_batches SET status=?,updated_at=? WHERE id=?').run(status, new Date().toISOString(), id) }
  publishBatches(): PublishBatch[] {
    const batches = this.sqlite.prepare('SELECT * FROM publish_batches ORDER BY created_at DESC').all() as Record<string, unknown>[]
    const jobsFor = this.sqlite.prepare('SELECT * FROM publish_jobs WHERE batch_id=? ORDER BY id')
    return batches.map(row => ({ id: String(row.id), dispatchMode: row.dispatch_mode as PublishBatch['dispatchMode'], status: row.status as PublishBatch['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), jobs: (jobsFor.all(String(row.id)) as Record<string, unknown>[]).map(job => ({ id: String(job.id), batchId: String(job.batch_id), assetId: String(job.asset_id), title: String(job.title), topics: JSON.parse(String(job.topics)), publishAt: job.publish_at ? String(job.publish_at) : undefined, executeAt: job.execute_at ? String(job.execute_at) : undefined, aigc: Boolean(job.aigc), status: job.status as PublishJob['status'], error: job.error ? String(job.error) : undefined, screenshot: job.screenshot ? String(job.screenshot) : undefined })) }))
  }
  deletePublishBatch(id: string) { return this.sqlite.prepare("DELETE FROM publish_batches WHERE id=? AND status NOT IN ('queued','waiting_local','running')").run(id).changes > 0 }
}
