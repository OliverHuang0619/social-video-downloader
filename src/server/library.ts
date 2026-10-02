import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DownloadJob, MediaAsset } from '../shared/types'
import type { AppDatabase } from './db'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.quicktime'])
const VIDEO_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.quicktime': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo' }

export class LibraryService {
  private roots: string[]
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
  async syncDownloads(jobs: DownloadJob[]) {
    for (const job of jobs) {
      this.db.saveDownload(job)
      if (!job.outputPath || !['completed', 'skipped'].includes(job.status)) continue
      try {
        const asset = await this.registerFile(job.outputPath, { sourceUrl: job.item.sourceUrl, platform: job.item.platform, uploader: job.item.uploader, duration: job.item.duration, thumbnail: job.item.thumbnail, publishedAt: job.item.publishedAt })
        job.assetId = asset.id
        this.db.saveDownload(job)
      } catch { /* a partially written path will be retried on the next queue event */ }
    }
  }
  async stream(id: string, requestRange: string | undefined, response: ServerResponse, attachment = false) {
    const asset = this.db.asset(id); if (!asset) throw Object.assign(new Error('视频不存在'), { statusCode: 404 })
    const file = await this.allowed(asset.file); if (!file) throw Object.assign(new Error('不允许访问该文件'), { statusCode: 403 })
    const info = await stat(file); let start = 0, end = info.size - 1, statusCode = 200
    if (requestRange) { const match = requestRange.match(/^bytes=(\d*)-(\d*)$/); if (!match) throw Object.assign(new Error('无效 Range'), { statusCode: 416 }); start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2])); end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1; if (start > end || start >= info.size) throw Object.assign(new Error('无效 Range'), { statusCode: 416 }); statusCode = 206 }
    response.writeHead(statusCode, { 'content-type': attachment ? 'application/octet-stream' : VIDEO_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': end - start + 1, 'accept-ranges': 'bytes', ...(statusCode === 206 ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}), ...(attachment ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}` } : {}) })
    createReadStream(file, { start, end }).pipe(response)
  }
}
