import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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
  private metadataCache = new Map<string, { key: string; value: { size: number; duration?: number; modifiedAt: string } }>()
  private thumbnailActive = 0
  private thumbnailWaiters: Array<() => void> = []
  private remoteFiles = new Map<string, Promise<string>>()
  constructor(private db: AppDatabase) { this.roots = [process.env.SVD_OUTPUT_DIR || '/downloads', process.env.SVD_IMPORT_DIR || '/imports'].map(value => path.resolve(value)) }
  private get cloudflare() { return process.env.SVD_CLOUDFLARE_RUNTIME === '1' }
  private objectKey(file: string) { return file.startsWith('r2://') ? file.slice(5) : undefined }
  private objectUrl(key: string) { return `http://svw.r2.internal/${encodeURIComponent(key)}` }
  private async presign(method: 'GET' | 'PUT', key: string) {
    const token = process.env.SVD_CF_BRIDGE_TOKEN
    if (!token) throw new Error('Cloudflare R2 连接密钥未配置')
    const response = await fetch('http://svw.r2.internal/presign', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, key }) })
    const result = await response.json() as { url?: string; error?: string }
    if (!response.ok || !result.url) throw new Error(result.error || `获取 R2 上传地址失败 (${response.status})`)
    return result.url
  }
  async createUploadTicket(filename: string) {
    if (!this.cloudflare) throw Object.assign(new Error('浏览器直传仅在 Cloudflare 部署中启用'), { statusCode: 409 })
    const safeName = path.basename(filename.trim()).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'upload.mp4'
    const extension = path.extname(safeName).toLowerCase()
    if (!VIDEO_EXTENSIONS.has(extension)) throw Object.assign(new Error('仅支持上传视频文件'), { statusCode: 415 })
    const id = randomUUID(), objectKey = `media/assets/${id}${extension}`, expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()
    this.db.createMediaUploadTicket({ id, objectKey, filename: safeName, expiresAt })
    try { return { id, filename: safeName, uploadUrl: await this.presign('PUT', objectKey), expiresAt } }
    catch (error) { this.db.deleteMediaUploadTicket(id); throw error }
  }
  async completeUpload(id: string) {
    const ticket = this.db.mediaUploadTicket(id)
    if (!ticket) throw Object.assign(new Error('上传记录不存在或已完成'), { statusCode: 404 })
    if (Date.parse(ticket.expiresAt) <= Date.now()) {
      this.db.deleteMediaUploadTicket(id)
      await this.deleteObject(ticket.objectKey)
      throw Object.assign(new Error('上传地址已过期，请重新上传'), { statusCode: 410 })
    }
    const token = process.env.SVD_CF_BRIDGE_TOKEN
    if (!token) throw new Error('Cloudflare R2 连接密钥未配置')
    const head = await fetch(this.objectUrl(ticket.objectKey), { method: 'HEAD', headers: { authorization: `Bearer ${token}` } })
    if (!head.ok) throw Object.assign(new Error(head.status === 404 ? 'R2 中没有找到已上传视频' : `检查 R2 上传结果失败 (${head.status})`), { statusCode: head.status === 404 ? 409 : 502 })
    const asset = this.db.upsertAsset({ id: ticket.id, file: `r2://${ticket.objectKey}`, filename: ticket.filename, uploader: '浏览器上传', processingState: 'unprocessed' })
    this.db.deleteMediaUploadTicket(id)
    return asset
  }
  async downloadUrl(id: string) {
    const asset = this.db.asset(id)
    if (!asset) throw Object.assign(new Error('视频不存在'), { statusCode: 404 })
    const key = this.objectKey(asset.file)
    if (!key || !this.cloudflare) return undefined
    return this.presign('GET', key)
  }
  private async putObject(key: string, file: string) {
    const token = process.env.SVD_CF_BRIDGE_TOKEN
    if (!token) throw new Error('Cloudflare R2 连接密钥未配置')
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream
    const response = await fetch(this.objectUrl(key), { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body, duplex: 'half' } as RequestInit & { duplex: 'half' })
    if (!response.ok) throw new Error(`保存媒体到 Cloudflare R2 失败 (${response.status})`)
  }
  private async getObject(key: string, range?: string) {
    const token = process.env.SVD_CF_BRIDGE_TOKEN
    if (!token) throw new Error('Cloudflare R2 连接密钥未配置')
    return fetch(this.objectUrl(key), { headers: { authorization: `Bearer ${token}`, ...(range ? { range } : {}) } })
  }
  private async deleteObject(key: string) {
    const token = process.env.SVD_CF_BRIDGE_TOKEN
    if (!token) throw new Error('Cloudflare R2 连接密钥未配置')
    const response = await fetch(this.objectUrl(key), { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
    if (!response.ok && response.status !== 404) throw new Error(`从 Cloudflare R2 删除媒体失败 (${response.status})`)
  }
  private async materialize(asset: MediaAsset) {
    const key = this.objectKey(asset.file)
    if (!key) {
      const file = await this.allowed(asset.file)
      if (!file) throw Object.assign(new Error('不允许访问该文件'), { statusCode: 403 })
      return file
    }
    let pending = this.remoteFiles.get(asset.id)
    if (!pending) {
      pending = (async () => {
        const directory = path.join('/tmp', 'svw-media-cache')
        await mkdir(directory, { recursive: true })
        const output = path.join(directory, `${asset.id}${path.extname(asset.filename)}`)
        if ((await stat(output).catch(() => undefined))?.isFile()) return output
        const response = await this.getObject(key)
        if (!response.ok || !response.body) throw Object.assign(new Error(`无法从 R2 读取媒体 (${response.status})`), { statusCode: response.status === 404 ? 404 : 502 })
        const temporary = `${output}.${randomUUID()}.tmp`
        try {
          await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(temporary, { mode: 0o600 }))
          await rename(temporary, output)
          return output
        } catch (error) { await rm(temporary, { force: true }); throw error }
      })().finally(() => this.remoteFiles.delete(asset.id))
      this.remoteFiles.set(asset.id, pending)
    }
    return pending
  }
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
  async resolvedFile(id: string) {
    const asset = this.db.asset(id)
    if (!asset) throw Object.assign(new Error('视频不存在'), { statusCode: 404 })
    return this.materialize(asset)
  }
  async registerFile(file: string, values: Partial<MediaAsset> = {}) {
    const resolved = await this.allowed(file)
    if (!resolved || !(await stat(resolved)).isFile() || !VIDEO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw new Error('媒体文件不在允许范围内')
    const id = values.id || randomUUID()
    let storedFile = resolved
    if (this.cloudflare) {
      const key = `media/assets/${id}${path.extname(resolved).toLowerCase()}`
      await this.putObject(key, resolved)
      storedFile = `r2://${key}`
    }
    return this.db.upsertAsset({ id, file: storedFile, filename: path.basename(resolved), sourceUrl: values.sourceUrl, platform: values.platform, uploader: values.uploader, duration: values.duration, thumbnail: values.thumbnail, publishedAt: values.publishedAt, processingState: values.processingState || 'unprocessed', analysis: values.analysis })
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
      const key = this.objectKey(asset.file)
      if (key) {
        try { await this.deleteObject(key); deletedFiles++ } catch { failed.push(asset.filename) }
        continue
      }
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
        await this.registerCompletedDownload(job)
      } catch (error) {
        job.libraryError = error instanceof Error ? error.message : String(error)
        this.db.saveDownload(job)
        console.error(`媒体库登记下载文件失败 (${job.outputPath}):`, error)
      }
    }
  }
  async registerCompletedDownload(job: DownloadJob) {
    if (!['completed', 'skipped'].includes(job.status) || !job.outputPath) throw new Error('下载文件尚未完成或路径不可用')
    if (job.assetId) {
      const existing = this.db.asset(job.assetId)
      if (existing) return existing
    }
    const asset = await this.registerFile(job.outputPath, { sourceUrl: job.item.sourceUrl, platform: job.item.platform, uploader: job.item.uploader, duration: job.item.duration, thumbnail: job.item.thumbnail, publishedAt: job.item.publishedAt })
    job.assetId = asset.id
    job.storagePath = asset.file
    job.libraryError = undefined
    this.db.saveDownload(job)
    return asset
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
      const file = await this.materialize(asset)
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
    const key = this.objectKey(asset.file)
    if (key) {
      const remote = await this.getObject(key, requestRange)
      if (!remote.ok || !remote.body) throw Object.assign(new Error('视频文件不存在'), { statusCode: remote.status === 404 ? 404 : 502 })
      const headers: Record<string, string> = { 'content-type': attachment ? 'application/octet-stream' : VIDEO_MIME[path.extname(asset.filename).toLowerCase()] || 'application/octet-stream', 'cache-control': 'private, no-store', 'accept-ranges': 'bytes' }
      for (const name of ['content-length', 'content-range']) { const value = remote.headers.get(name); if (value) headers[name] = value }
      if (attachment) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}`
      response.writeHead(remote.status, headers)
      Readable.fromWeb(remote.body as import('node:stream/web').ReadableStream).pipe(response)
      return
    }
    const file = await this.allowed(asset.file); if (!file) throw Object.assign(new Error('不允许访问该文件'), { statusCode: 403 })
    const info = await stat(file); let start = 0, end = info.size - 1, statusCode = 200
    if (requestRange) { const match = requestRange.match(/^bytes=(\d*)-(\d*)$/); if (!match) throw Object.assign(new Error('无效 Range'), { statusCode: 416 }); start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2])); end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1; if (start > end || start >= info.size) throw Object.assign(new Error('无效 Range'), { statusCode: 416 }); statusCode = 206 }
    response.writeHead(statusCode, { 'content-type': attachment ? 'application/octet-stream' : VIDEO_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': end - start + 1, 'accept-ranges': 'bytes', ...(statusCode === 206 ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}), ...(attachment ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}` } : {}) })
    createReadStream(file, { start, end }).pipe(response)
  }
  async fileHash(id: string) {
    const asset = this.db.asset(id); if (!asset) throw Object.assign(new Error('视频不存在'), { statusCode: 404 })
    const file = await this.materialize(asset)
    const info = await stat(file), key = `${file}:${info.size}:${info.mtimeMs}`, cached = this.hashCache.get(id)
    if (cached?.key === key) return cached.value
    const hash = await new Promise<string>((resolve, reject) => { const digest = createHash('sha256'), stream = createReadStream(file); stream.on('data', chunk => digest.update(chunk)); stream.once('error', reject); stream.once('end', () => resolve(digest.digest('hex'))) })
    const value = { algorithm: 'sha256' as const, hash, size: info.size, modifiedAt: info.mtime.toISOString() }
    this.hashCache.set(id, { key, value }); return value
  }
  async metadata(id: string) {
    const asset = this.db.asset(id); if (!asset) throw Object.assign(new Error('视频不存在'), { statusCode: 404 })
    const file = await this.materialize(asset)
    const info = await stat(file), key = `${file}:${info.size}:${info.mtimeMs}`, cached = this.metadataCache.get(id)
    if (cached?.key === key) return cached.value
    let duration = asset.duration
    if (!duration) duration = await new Promise<number | undefined>(resolve => {
      const child = spawn(process.env.SVD_FFPROBE_BIN || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { stdio: ['ignore', 'pipe', 'ignore'] })
      let output = ''; child.stdout.on('data', chunk => { if (output.length < 100) output += String(chunk) }); child.once('error', () => resolve(undefined)); child.once('close', code => { const value = Number(output.trim()); resolve(code === 0 && Number.isFinite(value) && value > 0 ? value : undefined) })
    })
    const value = { size: info.size, duration, modifiedAt: info.mtime.toISOString() }
    this.metadataCache.set(id, { key, value }); return value
  }
}
