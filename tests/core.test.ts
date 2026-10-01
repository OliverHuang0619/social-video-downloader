import { describe, expect, it } from 'vitest'
import { buildFormatArgs, detectPlatform, normalizeUrls, sanitizeFilename } from '../src/shared/core'
import { DownloadQueue, parseDownloadOutput } from '../src/main/queue'
import type { DownloadOptions, MediaItem } from '../src/shared/types'

const options: DownloadOptions = { mode: 'video', quality: '1080', container: 'mp4', audioFormat: 'mp3', audioBitrate: '192', outputRoot: '/tmp', cookieSource: 'none' }
describe('核心工具', () => {
  it('规范化并去重 URL', () => expect(normalizeUrls('https://youtu.be/a\nhttps://youtu.be/a#x')).toEqual(['https://youtu.be/a']))
  it('拒绝非 HTTP URL', () => expect(() => normalizeUrls('file:///etc/passwd')).toThrow('不支持'))
  it('识别平台', () => { expect(detectPlatform('https://youtube.com/watch?v=1')).toBe('youtube'); expect(detectPlatform('https://instagram.com/p/1')).toBe('instagram') })
  it('清理跨平台文件名', () => expect(sanitizeFilename('a:b/c*? ')).toBe('a_b_c__'))
  it('生成限制高度的视频参数', () => expect(buildFormatArgs(options)).toContain('bestvideo[height<=1080]+bestaudio/best[height<=1080]'))
  it('生成音频参数', () => expect(buildFormatArgs({ ...options, mode: 'audio' })).toEqual(['-x', '--audio-format', 'mp3', '--audio-quality', '192K']))
})

describe('下载队列', () => {
  it('解析 yt-dlp 的机器可读进度和准备阶段', () => {
    expect(parseDownloadOutput('svd: 11.6%|36.04KiB/s|00:29')).toEqual({ progress: 11.6, speed: '36.04KiB/s', eta: '00:29', detail: '正在下载媒体文件…' })
    expect(parseDownloadOutput('Extracting cookies from chrome')).toEqual({ detail: '正在从浏览器安全读取登录 Cookie…' })
    expect(parseDownloadOutput('[Merger] Merging formats into "video.mp4"')).toEqual({ detail: '正在合并并处理媒体文件…' })
  })
  it('工具解析尚未完成时也只预留三个并发任务', async () => {
    const never = new Promise<string | undefined>(() => undefined)
    const queue = new DownloadQueue({ resolve: () => never } as never)
    const item = (id: string): MediaItem => ({ id, sourceUrl: `https://example.com/${id}`, platform: 'other', title: id, uploader: '', duration: 0, thumbnail: '', publishedAt: '', selected: true, kind: 'video' })
    const sender = { isDestroyed: () => false, send: () => undefined }
    const jobs = await queue.start({ items: ['1', '2', '3', '4', '5'].map(item), options }, sender as never)
    expect(jobs.filter(job => job.status === 'downloading')).toHaveLength(3)
    expect(jobs.filter(job => job.status === 'queued')).toHaveLength(2)
  })
})
