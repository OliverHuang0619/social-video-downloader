import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AnalysisJob, AnalysisResult } from '../shared/types'
import type { AppDatabase } from './db'
import type { CodexService } from './codex'

const confidence = new Set(['high', 'medium', 'low'])
function execute(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout: number; onStart?: (child: ChildProcessWithoutNullStreams) => void }) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(command, args, { env: options.env, cwd: options.cwd, windowsHide: true }); options.onStart?.(child)
    let output = ''; const timer = setTimeout(() => child.kill('SIGTERM'), options.timeout)
    child.stdout.on('data', value => output = `${output}${value}`.slice(-100_000)); child.stderr.on('data', value => output = `${output}${value}`.slice(-100_000))
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, output: error.message }) }); child.on('close', code => { clearTimeout(timer); resolve({ code, output }) })
  })
}

export class AnalysisService {
  private active?: { id: string; child?: ChildProcessWithoutNullStreams }
  private root = path.join(process.env.SVD_CONFIG_DIR || '/config', 'analysis')
  private skillDir = process.env.SVD_SKILL_DIR || path.resolve(process.cwd(), 'skills/english-video-catalog')
  constructor(private db: AppDatabase, private codex: CodexService, private changed: () => void) {}
  start(assetIds: string[], force = false) {
    const unique = [...new Set(assetIds)]; if (!unique.length) throw new Error('请选择要分析的视频')
    if (this.active) throw new Error('已有分析任务正在运行')
    const assets = unique.map(id => this.db.asset(id)); if (assets.some(value => !value)) throw new Error('包含不存在的视频')
    if (!force && assets.every(asset => asset!.analysis)) throw new Error('所选视频已有分析结果；如需重跑请启用重新分析')
    const now = new Date().toISOString(), id = randomUUID(), output = path.join(this.root, id)
    const job: AnalysisJob = { id, status: 'queued', assetIds: unique, progress: 0, message: '等待准备媒体', createdAt: now, updatedAt: now }
    this.db.createAnalysis(job, output); this.active = { id }; void this.run(id, output); this.changed(); return job
  }
  cancel(id: string) { if (this.active?.id !== id) throw new Error('任务未在运行'); this.active.child?.kill('SIGTERM'); this.db.updateAnalysis(id, { status: 'cancelled', message: '已取消分析' }); this.active = undefined; this.changed() }
  retry(id: string) { const old = this.db.analysis(id); if (!old || !['failed', 'cancelled'].includes(old.status)) throw new Error('该任务不能重试'); return this.start(old.assetIds, true) }
  private update(id: string, values: Parameters<AppDatabase['updateAnalysis']>[1]) { this.db.updateAnalysis(id, values); this.changed() }
  private validate(raw: unknown, files: Set<string>): Map<string, AnalysisResult> {
    const videos = (raw as { videos?: unknown[] })?.videos; if (!Array.isArray(videos) || videos.length !== files.size) throw new Error('分析结果数量与任务视频数量不一致')
    const output = new Map<string, AnalysisResult>()
    for (const item of videos as Record<string, unknown>[]) {
      const file = path.resolve(String(item.file || '')), title = String(item.title || '').trim(), englishTitle = String(item.english_title || '').trim(), topics = item.key_topics
      if (!files.has(file) || output.has(file)) throw new Error('分析结果包含任务外或重复的视频')
      if (!title || [...title].length >= 30 || title.endsWith('…') || !englishTitle || [...englishTitle].length > 60) throw new Error(`标题不符合规范：${path.basename(file)}`)
      if (!Array.isArray(topics) || topics.length < 2 || topics.length > 5 || !confidence.has(String(item.confidence))) throw new Error(`分析字段不符合规范：${path.basename(file)}`)
      output.set(file, { title, englishTitle, category: String(item.category || '其他'), keyTopics: topics.map(String), summary: String(item.summary || ''), confidence: item.confidence as AnalysisResult['confidence'], evidenceNote: String(item.evidence_note || '') })
    }
    return output
  }
  private async run(id: string, output: string) {
    try {
      const job = this.db.analysis(id)!; const assets = job.assetIds.map(assetId => this.db.asset(assetId)!)
      await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'files.json'), JSON.stringify(assets.map(asset => asset.file)))
      this.update(id, { status: 'preparing', progress: 10, message: '正在读取媒体信息并生成联系表' })
      const prepared = await execute('python3', [path.join(this.skillDir, 'scripts/prepare_media.py'), process.env.SVD_OUTPUT_DIR || '/downloads', '--files-json', path.join(output, 'files.json'), '--output', output], { timeout: 2 * 3600_000, onStart: child => { if (this.active?.id === id) this.active.child = child } })
      if (prepared.code !== 0) throw new Error(prepared.output.trim() || '媒体准备失败')
      this.update(id, { status: 'analyzing', progress: 35, message: 'Codex 正在分析视频证据' })
      const prompt = `使用 english-video-catalog 技能分析 ${path.join(output, 'manifest.json')} 中的全部视频。严格基于字幕、联系表和文件信息，生成中文分类、中文标题、英文标题、关键话题和摘要。不要修改源视频。只写入 ${path.join(output, 'results.json')}，结果必须符合技能 Results schema，且每个 file 必须保持 manifest 中的原始绝对路径。`
      const result = await execute(this.codex.command, ['--ask-for-approval', 'never', '--sandbox', 'workspace-write', '--cd', output, 'exec', '--ephemeral', '--skip-git-repo-check', prompt], { env: this.codex.environment(), cwd: output, timeout: 6 * 3600_000, onStart: child => { if (this.active?.id === id) this.active.child = child } })
      if (result.code !== 0) throw new Error(result.output.trim().slice(-4000) || 'Codex 分析失败')
      const parsed = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'))
      const validated = this.validate(parsed, new Set(assets.map(asset => path.resolve(asset.file))))
      for (const asset of assets) this.db.setAnalysis(asset.id, validated.get(path.resolve(asset.file))!)
      this.update(id, { status: 'completed', progress: 100, message: `已完成 ${assets.length} 个视频的分析` })
      this.db.audit('analysis.completed', { id, count: assets.length })
    } catch (error) {
      const current = this.db.analysis(id); if (current?.status !== 'cancelled') this.update(id, { status: 'failed', message: '分析失败', error: error instanceof Error ? error.message : String(error) })
    } finally { if (this.active?.id === id) this.active = undefined; this.changed() }
  }
}
