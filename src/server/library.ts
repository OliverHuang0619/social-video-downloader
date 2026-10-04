import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DownloadJob, MediaAsset } from '../shared/types'
import type { AppDatabase } from './db'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.quicktime'])
const VIDEO_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.quicktime': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo' }

export class LibraryService {
  private roots: string[]
  private thumbnailJobs = new Map<string, Promise<string>>()
  private hashCache = new Map<string, { key: string; value: { algorithm: 'sha256'; hash: string; size: number; modifiedAt: string } }>()
  private thumbnailActive = 0
  private thumbnailWaiters: Array<() => void> = []
  constructor(private db: AppDatabase) { this.roots = [process.env.SVD_OUTPUT_DIR || '/downloads', process.env.SVD_IMPORT_DIR || '/imports'].map(value => path.resolve(value)) }
  private async allowed(file: string) {
    const target = await realpath(file)
    for (const configured of this.roots) {
      const root = await realpath(configured).catch(() => configured)
      if (target === root || target.startsWith(`${root}${path.sep}`)) return target
    }
    return undefined
  }
  async importDirectory(directory: string) {
    const root = await this.allowed(directory)
    if (!root || !(await stat(root)).isDirectory()) throw new Error('目录不在允许导入的范围内')
    let count = 0
    const walk = async (folder: string) => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) { if (!entry.name.endsWith('-catalog-report')) await walk(file) }
        else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) { await this.registerFile(file); count++ }
      }
    }
    await walk(root); this.db.audit('library.import', { directory: root, count }); return { count }
  }
  async registerFile(file: string, values: Partial<MediaAsset> = {}) {
    const resolved = await this.allowed(file)
    if (!resolved || !(await stat(resolved)).isFile() || !VIDEO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw new Error('媒体文件不在允许范围内')
    return this.db.upsertAsset({ id: values.id || randomUUID(), file: resolved, filename: path.basename(resolved), sourceUrl: values.sourceUrl, platform: values.platform, uploader: values.uploader, duration: values.duration, thumbnail: values.thumbnail, publishedAt: values.publishedAt, processingState: values.processingState || 'unprocessed', analysis: values.analysis })
  }
  async deleteAssets(ids: string[], deleteFiles: boolean) {
    const unique = [...new Set(ids.map(String))].filter(Boolean)
    if (!unique.length) throw new Error('请选择要删除的视频')
    const assets = unique.map(id => this.db.asset(id)).filter((asset): asset is MediaAsset => Boolean(asset))
    const busy = this.db.busyAssetIds(assets.map(asset => asset.id))
    if (busy.size) throw new Error(`${busy.size} 个视频正在分析或发布中，或正在由 Hypit 重新制作，请先取消相关任务`)
    const count = this.db.deleteAssets(assets.map(asset => asset.id))
    const thumbnails = path.join(process.env.SVD_CONFIG_DIR || '/config', 'thumbnails')
    let deletedFiles = 0; const failed: string[] = []
    for (const asset of assets) {
      await rm(path.join(thumbnails, `${asset.id}.jpg`), { force: true })
      if (!deleteFiles) continue
      const file = await this.allowed(asset.file).catch(() => undefined)
      if (!file) continue
      try { await rm(file); deletedFiles++ } catch { failed.push(asset.filename) }
    }
    this.db.audit('library.delete', { ids: assets.map(asset => asset.id), deleteFiles, count, deletedFiles, failed })
    return { count, deletedFiles, failed }
  }
  async syncDownloads(jobs: DownloadJob[]) {
    for (const job of jobs) {
      this.db.saveDownload(job)
      // Already registered once; skipping keeps a deliberately deleted asset from reappearing.
      if (job.assetId) continue
      if (!job.outputPath || !['completed', 'skipped'].includes(job.status)) continue
      try {
        const asset = await this.registerFile(job.outputPath, { sourceUrl: job.item.sourceUrl, platform: job.item.platform, uploader: job.item.uploader, duration: job.item.duration, thumbnail: job.item.thumbnail, publishedAt: job.item.publishedAt })
        job.assetId = asset.id
        this.db.saveDownload(job)
      } catch { /* a partially written path will be retried on the next queue event */ }
    }
  }
  private async withThumbnailSlot<T>(work: () => Promise<T>) {
    if (this.thumbnailActive >= 2) await new Promise<void>(resolve => this.thumbnailWaiters.push(resolve))
    this.thumbnailActive++
    try { return await work() }
    finally { this.thumbnailActive--; this.thumbnailWaiters.shift()?.() }
  }
  private async thumbnailFile(id: string) {
    const existing = this.thumbnailJobs.get(id); if (existing) return existing
    const job = this.withThumbnailSlot(async () => {
      const asset = this.db.asset(id); if (!asset) throw Object.assign(new Error('视频不存在'), { statusCode: 404 })
      const file = await this.allowed(asset.file); if (!file) throw Object.assign(new Error('不允许访问该文件'), { statusCode: 403 })
      const directory = path.join(process.env.SVD_CONFIG_DIR || '/config', 'thumbnails')
      const output = path.join(directory, `${id}.jpg`)
      const [sourceInfo, thumbnailInfo] = await Promise.all([stat(file), stat(output).catch(() => undefined)])
      if (thumbnailInfo && thumbnailInfo.mtimeMs >= sourceInfo.mtimeMs) return output
      await mkdir(directory, { recursive: true })
      const temporary = path.join(directory, `${id}.${randomUUID()}.tmp.jpg`)
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.env.SVD_FFMPEG_BIN || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2:force_original_aspect_ratio=decrease', '-q:v', '3', temporary], { stdio: ['ignore', 'ignore', 'pipe'] })
          let error = ''; child.stderr.on('data', chunk => { if (error.length < 4_000) error += String(chunk) })
          child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(error.trim() || `ffmpeg 退出码 ${code}`)))
        })
        await rename(temporary, output)
        return output
      } catch (error) {
        await rm(temporary, { force: true })
        throw Object.assign(new Error(`无法读取视频首帧：${error instanceof Error ? error.message : String(error)}`), { statusCode: 422 })
      }
    }).finally(() => this.thumbnailJobs.delete(id))
    this.thumbnailJobs.set(id, job)
    return job
  }
  async thumbnail(id: string, response: ServerResponse) {
    const file = await this.thumbnailFile(id), info = await stat(file)
    response.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': info.size, 'cache-control': 'private, max-age=86400' })
    createReadStream(file).pipe(response)
  }
  async stream(id: string, requestRange: string | undefined, response: ServerResponse, attachment = false) {
    const asset = this.db.asset(id); if (!asset) throw Object.assign(new Error('视频不存在'), { statusCode: 404 })
    const file = await this.allowed(asset.file); if (!file) throw Object.assign(new Error('不允许访问该文件'), { statusCode: 403 })
    const info = await stat(file); let start = 0, end = info.size - 1, statusCode = 200
    if (requestRange) { const match = requestRange.match(/^bytes=(\d*)-(\d*)$/); if (!match) throw Object.assign(new Error('无效 Range'), { statusCode: 416 }); start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2])); end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1; if (start > end || start >= info.size) throw Object.assign(new Error('无效 Range'), { statusCode: 416 }); statusCode = 206 }
    response.writeHead(statusCode, { 'content-type': attachment ? 'application/octet-stream' : VIDEO_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': end - start + 1, 'accept-ranges': 'bytes', ...(statusCode === 206 ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}), ...(attachment ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}` } : {}) })
    createReadStream(file, { start, end }).pipe(response)
  }
  async fileHash(id: string) {
    const asset = this.db.asset(id); if (!asset) throw Object.assign(new Error('视频不存在'), { statusCode: 404 })
    const file = await this.allowed(asset.file); if (!file) throw Object.assign(new Error('不允许访问该文件'), { statusCode: 403 })
    const info = await stat(file), key = `${file}:${info.size}:${info.mtimeMs}`, cached = this.hashCache.get(id)
    if (cached?.key === key) return cached.value
    const hash = await new Promise<string>((resolve, reject) => { const digest = createHash('sha256'), stream = createReadStream(file); stream.on('data', chunk => digest.update(chunk)); stream.once('error', reject); stream.once('end', () => resolve(digest.digest('hex'))) })
    const value = { algorithm: 'sha256' as const, hash, size: info.size, modifiedAt: info.mtime.toISOString() }
    this.hashCache.set(id, { key, value }); return value
  }
}
