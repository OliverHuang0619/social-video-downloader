import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AnalysisJob, AnalysisLogEntry, AnalysisResult } from '../shared/types'
import type { AppDatabase } from './db'
import { cleanCodexOutput, type CodexService } from './codex'

const confidence = new Set(['high', 'medium', 'low'])
type ProgressLine = { level: AnalysisLogEntry['level']; message: string; progress?: number }

function compact(value: unknown, limit = 600) {
  const cleaned = cleanCodexOutput(String(value || '')).replace(/\s+/g, ' ').trim()
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned
}

export function parseCodexProgressLine(line: string): ProgressLine | undefined {
  const cleaned = cleanCodexOutput(line)
  if (!cleaned) return undefined
  let event: Record<string, unknown>
  try { event = JSON.parse(cleaned) as Record<string, unknown> } catch { return { level: 'info', message: compact(cleaned) } }
  const type = String(event.type || '')
  if (type === 'thread.started') return { level: 'info', message: 'Codex 会话已建立', progress: 42 }
  if (type === 'turn.started') return { level: 'info', message: 'Codex 开始检查清单、字幕和画面证据', progress: 48 }
  if (type === 'turn.completed') {
    const usage = event.usage as Record<string, unknown> | undefined
    const tokens = usage ? Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0) : 0
    return { level: 'result', message: tokens ? `Codex 分析完成，本轮使用 ${tokens.toLocaleString()} tokens` : 'Codex 分析阶段完成', progress: 88 }
  }
  if (type === 'turn.failed' || type === 'error') return { level: 'error', message: compact(event.message || (event.error as Record<string, unknown> | undefined)?.message || 'Codex 返回错误') }
  const item = event.item as Record<string, unknown> | undefined
  if (!item) return undefined
  const itemType = String(item.type || '')
  const text = compact(item.text || item.message || item.output)
  if (itemType === 'command_execution') {
    const command = compact(item.command, 300)
    const exitCode = item.exit_code
    if (type === 'item.completed') return { level: exitCode === undefined || Number(exitCode) === 0 ? 'result' : 'error', message: `${command ? `命令完成：${command}` : '证据检查命令完成'}${exitCode === undefined ? '' : `（退出码 ${exitCode}）`}`, progress: 65 }
    return command ? { level: 'command', message: `正在检查证据：${command}`, progress: 56 } : undefined
  }
  if (itemType === 'reasoning' && text) return { level: 'info', message: `分析思路：${text}`, progress: 70 }
  if (itemType === 'agent_message' && text) return { level: 'result', message: `Codex：${text}`, progress: 80 }
  if (itemType === 'file_change') return { level: 'result', message: 'Codex 已写入结构化分析结果', progress: 86 }
  return undefined
}

export function executeAnalysisProcess(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout: number; onStart?: (child: ChildProcessWithoutNullStreams) => void; onLine?: (line: string, stream: 'stdout' | 'stderr') => void }) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(command, args, { env: options.env, cwd: options.cwd, windowsHide: true }); options.onStart?.(child)
    child.stdin.end()
    let output = '', stdoutBuffer = '', stderrBuffer = ''; const timer = setTimeout(() => child.kill('SIGTERM'), options.timeout)
    const consume = (value: Buffer, stream: 'stdout' | 'stderr') => {
      const text = value.toString(); output = `${output}${text}`.slice(-100_000)
      let buffer = `${stream === 'stdout' ? stdoutBuffer : stderrBuffer}${text}`
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''
      if (stream === 'stdout') stdoutBuffer = buffer; else stderrBuffer = buffer
      for (const line of lines) if (line.trim()) options.onLine?.(line, stream)
    }
    child.stdout.on('data', value => consume(value, 'stdout')); child.stderr.on('data', value => consume(value, 'stderr'))
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, output: error.message }) }); child.on('close', code => {
      clearTimeout(timer)
      if (stdoutBuffer.trim()) options.onLine?.(stdoutBuffer, 'stdout')
      if (stderrBuffer.trim()) options.onLine?.(stderrBuffer, 'stderr')
      resolve({ code, output })
    })
  })
}

export class AnalysisService {
  private active?: { id: string; child?: ChildProcessWithoutNullStreams }
  private root = path.join(process.env.SVD_CONFIG_DIR || '/config', 'analysis')
  private skillDir = process.env.SVD_SKILL_DIR || path.resolve(process.cwd(), 'skills/english-video-catalog')
  constructor(private db: AppDatabase, private codex: CodexService, private changed: () => void) {}
  start(assetIds: string[], force = false, reusableOutput?: string) {
    const unique = [...new Set(assetIds)]; if (!unique.length) throw new Error('请选择要分析的视频')
    if (this.active) throw new Error('已有分析任务正在运行')
    const assets = unique.map(id => this.db.asset(id)); if (assets.some(value => !value)) throw new Error('包含不存在的视频')
    if (!force && assets.every(asset => asset!.analysis)) throw new Error('所选视频已有分析结果；如需重跑请启用重新分析')
    const now = new Date().toISOString(), id = randomUUID(), output = reusableOutput || path.join(this.root, id)
    const job: AnalysisJob = { id, status: 'queued', assetIds: unique, progress: 0, message: '等待准备媒体', processedItems: 0, totalItems: unique.length, logs: [{ at: now, stage: 'queue', level: 'info', message: `已创建任务，共 ${unique.length} 个视频` }], createdAt: now, updatedAt: now }
    this.db.createAnalysis(job, output); this.active = { id }; void this.run(id, output); this.changed(); return job
  }
  cancel(id: string) { if (this.active?.id !== id) throw new Error('任务未在运行'); this.active.child?.kill('SIGTERM'); this.addLog(id, 'complete', 'info', '用户取消了分析任务', { status: 'cancelled', message: '已取消分析', currentItem: undefined }); this.active = undefined }
  retry(id: string) { const old = this.db.analysis(id); if (!old || !['failed', 'cancelled'].includes(old.status)) throw new Error('该任务不能重试'); return this.start(old.assetIds, true, this.db.analysisOutputDir(id)) }
  delete(id: string) {
    if (!this.db.analysis(id)) throw new Error('分析任务不存在')
    if (!this.db.deleteAnalysis(id)) throw new Error('运行中的分析任务不能删除')
    this.db.audit('analysis.deleted', { id }); this.changed()
  }
  clearHistory() {
    const count = this.db.clearAnalysisHistory()
    this.db.audit('analysis.history_cleared', { count }); this.changed(); return count
  }
  private update(id: string, values: Parameters<AppDatabase['updateAnalysis']>[1]) { this.db.updateAnalysis(id, values); this.changed() }
  private addLog(id: string, stage: AnalysisLogEntry['stage'], level: AnalysisLogEntry['level'], message: string, values: Parameters<AppDatabase['updateAnalysis']>[1] = {}) {
    const job = this.db.analysis(id); if (!job) return
    const entry: AnalysisLogEntry = { at: new Date().toISOString(), stage, level, message: compact(message) }
    this.update(id, { ...values, logs: [...job.logs, entry].slice(-200) })
  }
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
  private async hasReusableManifest(output: string, assets: { file: string }[]) {
    try {
      const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')) as { videos?: { file?: string }[] }
      const preparedFiles = new Set((manifest.videos || []).map(video => path.resolve(String(video.file || ''))))
      return preparedFiles.size === assets.length && assets.every(asset => preparedFiles.has(path.resolve(asset.file)))
    } catch { return false }
  }
  private async run(id: string, output: string) {
    try {
      const job = this.db.analysis(id)!; const assets = job.assetIds.map(assetId => this.db.asset(assetId)!)
      await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'files.json'), JSON.stringify(assets.map(asset => asset.file)))
      const reusePrepared = await this.hasReusableManifest(output, assets)
      this.addLog(id, 'prepare', 'info', reusePrepared ? `复用上次已准备的 ${assets.length} 个视频证据` : '开始读取媒体信息、字幕并生成九宫格联系表', { status: 'preparing', progress: reusePrepared ? 30 : 5, message: reusePrepared ? '正在复用已准备的媒体证据' : '正在准备媒体证据', processedItems: reusePrepared ? assets.length : 0 })
      const prepared = reusePrepared ? { code: 0, output: '' } : await executeAnalysisProcess('python3', [path.join(this.skillDir, 'scripts/prepare_media.py'), process.env.SVD_OUTPUT_DIR || '/downloads', '--files-json', path.join(output, 'files.json'), '--output', output], {
        timeout: 2 * 3600_000,
        onStart: child => { if (this.active?.id === id) this.active.child = child },
        onLine: line => {
          try {
            const event = JSON.parse(line) as Record<string, unknown>; const index = Number(event.index || 0), total = Number(event.total || assets.length), filename = String(event.filename || '')
            if (event.event === 'prepare_started') this.addLog(id, 'prepare', 'command', `正在准备 ${index}/${total}：${filename}`, { currentItem: filename, message: `正在准备第 ${index}/${total} 个视频`, progress: Math.round(5 + (index - 1) / total * 25) })
            if (event.event === 'prepare_completed') {
              const facts = [event.duration_seconds ? `${Math.round(Number(event.duration_seconds))} 秒` : '', event.resolution, event.sidecar_count ? `${event.sidecar_count} 个字幕/文本` : '无外部字幕', event.contact_sheet ? '联系表已生成' : '无联系表'].filter(Boolean).join(' · ')
              this.addLog(id, 'prepare', event.error ? 'error' : 'result', `${index}/${total} ${filename}：${event.error || facts}`, { processedItems: index, currentItem: filename, message: `媒体准备 ${index}/${total}`, progress: Math.round(5 + index / total * 25) })
            }
          } catch { if (line.trim()) this.addLog(id, 'prepare', 'info', line) }
        },
      })
      if (this.db.analysis(id)?.status === 'cancelled') return
      if (prepared.code !== 0) throw new Error(prepared.output.trim() || '媒体准备失败')
      this.addLog(id, 'codex', 'info', `媒体证据准备完成，开始分析 ${assets.length} 个视频`, { status: 'analyzing', progress: 35, message: 'Codex 正在分析视频证据', processedItems: assets.length, currentItem: undefined })
      const skillFile = path.join(this.skillDir, 'SKILL.md')
      const prompt = `首先完整阅读 ${skillFile}，然后使用 english-video-catalog 技能分析 ${path.join(output, 'manifest.json')} 中的全部视频。严格基于字幕、联系表和文件信息，生成中文分类、中文标题、英文标题、关键话题和摘要。不要修改源视频。只写入 ${path.join(output, 'results.json')}，结果必须符合技能 Results schema，且每个 file 必须保持 manifest 中的原始绝对路径。`
      // The app itself already runs inside a Docker container whose only media mounts are
      // /downloads, /imports and /config. Codex's Linux workspace sandbox requires user
      // namespaces (bwrap), which standard Docker deployments intentionally do not grant.
      const result = await executeAnalysisProcess(this.codex.command, ['--ask-for-approval', 'never', '--sandbox', 'danger-full-access', '--cd', output, 'exec', '--json', '--ephemeral', '--skip-git-repo-check', prompt], { env: this.codex.environment(), cwd: output, timeout: 6 * 3600_000, onStart: child => { if (this.active?.id === id) this.active.child = child }, onLine: line => { const detail = parseCodexProgressLine(line); if (detail) this.addLog(id, 'codex', detail.level, detail.message, detail.progress ? { progress: Math.max(this.db.analysis(id)?.progress || 0, detail.progress), message: detail.message } : {}) } })
      if (this.db.analysis(id)?.status === 'cancelled') return
      if (result.code !== 0) throw new Error(result.output.trim().slice(-4000) || 'Codex 分析失败')
      this.addLog(id, 'validate', 'info', 'Codex 已结束，正在读取并校验结构化结果', { progress: 92, message: '正在校验分析结果' })
      const parsed = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'))
      const validated = this.validate(parsed, new Set(assets.map(asset => path.resolve(asset.file))))
      for (const asset of assets) this.db.setAnalysis(asset.id, validated.get(path.resolve(asset.file))!)
      this.addLog(id, 'complete', 'result', `结果校验通过，已写入 ${assets.length} 个视频的标题、分类、话题和摘要`, { status: 'completed', progress: 100, message: `已完成 ${assets.length} 个视频的分析`, currentItem: undefined })
      this.db.audit('analysis.completed', { id, count: assets.length })
    } catch (error) {
      const current = this.db.analysis(id); if (current?.status !== 'cancelled') { const message = error instanceof Error ? error.message : String(error); this.addLog(id, 'complete', 'error', message, { status: 'failed', message: '分析失败', error: message, currentItem: undefined }) }
    } finally { if (this.active?.id === id) this.active = undefined; this.changed() }
  }
}
