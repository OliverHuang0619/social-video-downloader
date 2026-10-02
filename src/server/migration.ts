import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AnalysisResult, PublishBatch, PublishJob } from '../shared/types'
import type { AppDatabase } from './db'
import type { LibraryService } from './library'

export async function migrateLegacy(db: AppDatabase, library: LibraryService) {
  if (db.meta('legacy-migration-v1') === 'complete') return
  const root = path.resolve(process.env.SVD_OUTPUT_DIR || '/downloads')
  let imported = 0, reports = 0
  try { imported = (await library.importDirectory(root)).count } catch { /* empty first-run volume */ }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('-catalog-report')) continue
    const reportDir = path.join(root, entry.name)
    try {
      const results = JSON.parse(await readFile(path.join(reportDir, 'results.json'), 'utf8')) as { videos?: Record<string, unknown>[] }
      for (const item of results.videos || []) {
        const asset = db.assetByFile(path.resolve(String(item.file || ''))); if (!asset) continue
        const analysis: AnalysisResult = { title: String(item.title || ''), englishTitle: String(item.english_title || ''), category: String(item.category || '其他'), keyTopics: Array.isArray(item.key_topics) ? item.key_topics.map(String).slice(0, 5) : [], summary: String(item.summary || ''), confidence: ['high', 'medium', 'low'].includes(String(item.confidence)) ? item.confidence as AnalysisResult['confidence'] : 'low', evidenceNote: String(item.evidence_note || '旧报告导入') }
        if (analysis.title && analysis.englishTitle) db.setAnalysis(asset.id, analysis)
      }
      reports++
      const history = JSON.parse(await readFile(path.join(reportDir, 'publish-jobs.json'), 'utf8').catch(() => '{}')) as Record<string, { id?: string; dispatchMode?: string; status?: string; createdAt?: string; updatedAt?: string; jobs?: Record<string, unknown>[] }>
      for (const old of Object.values(history)) {
        const batchId = `legacy-${String(old.id || randomUUID()).slice(0, 24)}`
        if (db.publishBatches().some(batch => batch.id === batchId)) continue
        const jobs: PublishJob[] = []
        for (const [index, item] of (old.jobs || []).entries()) {
          const asset = db.assetByFile(path.resolve(String(item.file || ''))); if (!asset) continue
          const status = String(item.status || 'interrupted') as PublishJob['status']
          jobs.push({ id: `${batchId}-${String(index + 1).padStart(3, '0')}`, batchId, assetId: asset.id, title: String(item.title || asset.analysis?.englishTitle || asset.filename).slice(0, 30), topics: Array.isArray(item.topics) ? item.topics.map(String).slice(0, 5) : ['英语学习'], publishAt: item.publishAt ? String(item.publishAt) : undefined, executeAt: item.executeAt ? String(item.executeAt) : undefined, aigc: item.aigc !== false, status: ['published', 'scheduled', 'failed', 'needs_login', 'needs_attention', 'interrupted'].includes(status) ? status : 'interrupted', error: item.error ? String(item.error) : undefined, screenshot: item.screenshot ? String(item.screenshot) : undefined })
          if (['published', 'scheduled'].includes(status)) db.setAssetState(asset.id, 'processed')
        }
        if (jobs.length) {
          const now = new Date().toISOString(), states = new Set(jobs.map(job => job.status))
          const status: PublishBatch['status'] = [...states].every(value => ['published', 'scheduled'].includes(value)) ? 'completed' : [...states].some(value => ['published', 'scheduled'].includes(value)) ? 'partial' : 'interrupted'
          db.createPublishBatch({ id: batchId, dispatchMode: old.dispatchMode === 'local' ? 'local' : 'platform', status, createdAt: old.createdAt || now, updatedAt: old.updatedAt || now, jobs })
        }
      }
    } catch { /* malformed legacy report remains untouched */ }
  }
  db.setMeta('legacy-migration-v1', 'complete'); db.audit('migration.legacy', { imported, reports })
}
