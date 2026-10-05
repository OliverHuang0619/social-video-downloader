import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AnalysisLogEntry, RemakeJob } from '../shared/types'
import type { AppDatabase } from './db'
import type { LibraryService } from './library'
import { cleanCodexOutput, type CodexService } from './codex'
import { executeAnalysisProcess, parseCodexProgressLine } from './analysis'
import { buildHypitRuntimeProfile, hypitProcessEnv, type HypitConfigStore } from './hypit-config'

export class RemakeService {
  private active?: { id: string; child?: ChildProcessWithoutNullStreams }
  private root = path.join(process.env.SVD_CONFIG_DIR || '/config', 'hypit-projects')
  private skillFile = process.env.SVD_HYPIT_SKILL_FILE || '/app/skills/hypit/SKILL.md'
  constructor(private db: AppDatabase, private library: LibraryService, private codex: CodexService, private hypit: HypitConfigStore, private changed: () => void) {}

  list() { return this.db.remakes() }
  start(assetIds: string[], direction: string, mode: RemakeJob['mode'], budget?: string, reusableProjectDir?: string) {
    const unique = [...new Set(assetIds.map(String))].filter(Boolean)
    if (!unique.length) throw new Error('请选择要重新制作的视频')
    if (unique.length > 10) throw new Error('一次最多重新制作 10 个视频')
    if (this.active) throw new Error('已有 Hypit 重新制作任务正在运行')
    const assets = unique.map(id => this.db.asset(id))
    if (assets.some(asset => !asset)) throw new Error('包含不存在的视频')
    const cleanDirection = direction.trim()
    if (cleanDirection.length < 6) throw new Error('请说明希望如何重新创作这些视频')
    if (mode === 'render' && !budget?.trim()) throw new Error('生成成片前请填写可接受的预算或明确的免费额度范围')
    if (mode === 'render' && !this.hypit.get().apiKey.trim()) throw Object.assign(new Error('生成成片前请先在设置页配置 Hypit API Key'), { statusCode: 400 })
    const id = randomUUID(), now = new Date().toISOString(), projectDir = reusableProjectDir || path.join(this.root, id)
    const job: RemakeJob = { id, status: 'queued', assetIds: unique, mode, direction: cleanDirection, budget: budget?.trim() || undefined, progress: 0, message: '等待建立 Hypit 工程', projectDir, outputs: [], logs: [{ at: now, stage: 'queue', level: 'info', message: reusableProjectDir ? `已重试任务，复用工程 ${path.basename(projectDir)}，共 ${unique.length} 个参考视频` : `已创建任务，共 ${unique.length} 个参考视频` }], createdAt: now, updatedAt: now }
    this.db.saveRemake(job); this.active = { id }; void this.run(job); this.changed(); return job
  }
  cancel(id: string) {
    if (this.active?.id !== id) throw new Error('任务未在运行')
    this.active.child?.kill('SIGTERM'); this.update(id, { status: 'cancelled', message: '已取消 Hypit 重新制作' }); this.active = undefined
  }
  retry(id: string) {
    const old = this.db.remake(id)
    if (!old || !['failed', 'cancelled'].includes(old.status)) throw new Error('该任务不能重试')
    return this.start(old.assetIds, old.direction, old.mode, old.budget, old.projectDir)
  }
  delete(id: string) {
    if (!this.db.remake(id)) throw new Error('Hypit 任务不存在')
    if (!this.db.deleteRemake(id)) throw new Error('运行中的任务不能删除')
    this.db.audit('hypit.remake.deleted', { id }); this.changed()
  }
  clearHistory() {
    const count = this.db.clearRemakeHistory()
    this.db.audit('hypit.remake.history_cleared', { count }); this.changed(); return count
  }
  private update(id: string, values: Partial<RemakeJob>) { const current = this.db.remake(id); if (!current) return; this.db.saveRemake({ ...current, ...values, updatedAt: new Date().toISOString() }); this.changed() }
  private log(id: string, stage: AnalysisLogEntry['stage'], level: AnalysisLogEntry['level'], message: string, values: Partial<RemakeJob> = {}) {
    const current = this.db.remake(id); if (!current) return
    const entry = { at: new Date().toISOString(), stage, level, message: cleanCodexOutput(message).slice(0, 1000) } satisfies AnalysisLogEntry
    this.update(id, { ...values, logs: [...current.logs, entry].slice(-200) })
  }
  private async findVideos(directory: string): Promise<string[]> {
    const output: string[] = []
    const walk = async (folder: string) => { for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) { const file = path.join(folder, entry.name); if (entry.isDirectory()) await walk(file); else if (/\.(mp4|mov|m4v|webm)$/i.test(entry.name)) output.push(file) } }
    await walk(directory); return output
  }
  private async writeRuntimeProfile(projectDir: string) {
    const config = this.hypit.get()
    const profile = buildHypitRuntimeProfile(config.baseUrl)
    await writeFile(path.join(projectDir, 'hypit.runtime.json'), `${JSON.stringify(profile, null, 2)}\n`)
    await mkdir(path.join(projectDir, '.hypit'), { recursive: true })
    await writeFile(path.join(projectDir, '.hypit', 'runtime'), 'hypit.runtime.json\n')
  }
  private async run(job: RemakeJob) {
    try {
      const assets = job.assetIds.map(id => this.db.asset(id)!)
      await mkdir(path.join(job.projectDir, 'productions'), { recursive: true })
      await writeFile(path.join(job.projectDir, 'package.json'), JSON.stringify({ name: `media-remake-${job.id.slice(0, 8)}`, version: '0.0.0', private: true, type: 'module' }, null, 2))
      await writeFile(path.join(job.projectDir, 'REQUEST.json'), JSON.stringify({ direction: job.direction, mode: job.mode, budget: job.budget, references: assets.map(asset => ({ id: asset.id, file: asset.file, title: asset.analysis?.title || asset.filename, analysis: asset.analysis })) }, null, 2))
      const brief = `# Brief\n\n## 目标\n${job.direction}\n\n## 交付\n${job.mode === 'render' ? '完成可编辑 Hypit 工程，并生成、检查最终成片。' : '完成翻拍 Treatment 与可编辑 Hypit 工程；不得提交付费生成或渲染。'}\n\n## 费用授权\n${job.mode === 'render' ? job.budget : '未授权任何付费生成。'}\n\n## 参考素材\n${assets.map(asset => `- ${asset.file}`).join('\n')}\n\n参考视频用于对齐情节结构、画面风格与声音节奏；成片须为重新生成的翻拍，不得只是裁剪、调色、镜像、换壳或搬运原片。\n`
      await writeFile(path.join(job.projectDir, 'BRIEF.md'), brief)
      await this.writeRuntimeProfile(job.projectDir)
      this.log(job.id, 'prepare', 'result', '已建立独立 Hypit 工程并写入 Brief、Runtime Profile 与参考清单', { status: 'directing', progress: 12, message: 'Codex 正在理解参考并规划高度还原翻拍' })
      const prompt = `完整阅读 ${this.skillFile} 并严格使用 Hypit 技能。工作区是 ${job.projectDir}，请求与参考清单在 REQUEST.json，用户授权边界在 BRIEF.md。工程已预置 hypit.runtime.json（HypiHub 经环境变量 HYPIT_API_KEY / HYPIT_BASE_URL），请保留该凭据路由，勿改成需要交互登录的方式。逐个完整理解参考视频（画面、声音、字幕和节奏），每个参考建立独立 target production，产出 ANALYSIS.md、TIMELINE.md、TREATMENT.md、PROGRESS.md、Source、Recipe 和 Run。必须严格按 BRIEF.md「目标」执行：高度还原翻拍，对齐情节结构、镜头节拍、画面风格与声音节奏；通过重新生成画面与声音实现，不得简单裁剪、调色、镜像或去水印；不得换题材、加新主线或改成完全不同的画风。${job.mode === 'render' ? `用户已授权的费用范围是：${job.budget}。只在此范围内使用已配置服务，完成构建与导出，最终视频复制到 ${(process.env.SVD_OUTPUT_DIR || '/downloads')}/remakes/${job.id}/ 并观看检查。` : '本任务只制作可编辑工程和完整制作方案，不得提交任何付费生成、模型调用或最终渲染；把实际执行所需服务、预计成本和下一步写入 PROGRESS.md。'} 不要修改或覆盖参考视频。遇到缺少 Hypit executable、Profile、Provider、凭据或素材时，把已完成工程保留下来，在 PROGRESS.md 写明精确阻塞项。`
      const env = { ...this.codex.environment(), ...hypitProcessEnv(this.hypit.get()) }
      const result = await executeAnalysisProcess(this.codex.command, this.codex.analysisArguments(job.projectDir, prompt), { env, cwd: job.projectDir, timeout: 12 * 3600_000, onStart: child => { if (this.active?.id === job.id) this.active.child = child }, onLine: line => { const detail = parseCodexProgressLine(line); if (detail) this.log(job.id, 'codex', detail.level, detail.message, { progress: Math.max(this.db.remake(job.id)?.progress || 0, Math.min(92, detail.progress || 25)), message: detail.message, status: job.mode === 'render' ? 'building' : 'directing' }) } })
      if (this.db.remake(job.id)?.status === 'cancelled') return
      if (result.code !== 0) throw new Error(result.output.trim().slice(-4000) || 'Hypit 重新制作失败')
      const outputDir = path.join(process.env.SVD_OUTPUT_DIR || '/downloads', 'remakes', job.id), outputs = job.mode === 'render' ? await this.findVideos(outputDir) : []
      for (const file of outputs) await this.library.registerFile(file)
      this.log(job.id, 'complete', 'result', outputs.length ? `完成并登记 ${outputs.length} 个原创成片` : '可编辑 Hypit 工程已准备完成', { status: 'completed', progress: 100, message: outputs.length ? `已生成 ${outputs.length} 个成片并加入媒体库` : '原创方案与可编辑工程已完成', outputs })
      this.db.audit('hypit.remake.completed', { id: job.id, mode: job.mode, outputs })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.db.remake(job.id)?.status !== 'cancelled') this.log(job.id, 'complete', 'error', message, { status: 'failed', message: 'Hypit 重新制作失败', error: message })
    } finally { if (this.active?.id === job.id) this.active = undefined; this.changed() }
  }
}
