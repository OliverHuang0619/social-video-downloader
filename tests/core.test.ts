import { describe, expect, it } from 'vitest'
import { buildFormatArgs, detectPlatform, formatsFromYtDlp, normalizeUrls, sanitizeFilename } from '../src/shared/core'
import { buildOutputTemplate, DownloadQueue, parseDownloadOutput } from '../src/main/queue'
import { mediaFromGalleryDlLine } from '../src/main/media'
import { CodexService, cleanCodexOutput, parseCodexLoginOutput, resolveCodexAnalysisConfig } from '../src/server/codex'
import { executeAnalysisProcess, parseCodexProgressLine } from '../src/server/analysis'
import type { DownloadOptions, MediaItem } from '../src/shared/types'

const options: DownloadOptions = { mode: 'video', quality: '1080', container: 'mp4', audioFormat: 'mp3', audioBitrate: '192', outputRoot: '/tmp', cookieSource: 'none', quickTimeCompatible: true }
describe('核心工具', () => {
  it('规范化并去重 URL', () => expect(normalizeUrls('https://youtu.be/a\nhttps://youtu.be/a#x')).toEqual(['https://youtu.be/a']))
  it('拒绝非 HTTP URL', () => expect(() => normalizeUrls('file:///etc/passwd')).toThrow('不支持'))
  it('识别平台', () => { expect(detectPlatform('https://youtube.com/watch?v=1')).toBe('youtube'); expect(detectPlatform('https://instagram.com/p/1')).toBe('instagram') })
  it('清理跨平台文件名', () => expect(sanitizeFilename('a:b/c*? ')).toBe('a_b_c__'))
  it('生成限制高度的视频参数', () => expect(buildFormatArgs(options)).toContain('bestvideo[height<=1080]+bestaudio/best[height<=1080]'))
  it('生成音频参数', () => expect(buildFormatArgs({ ...options, mode: 'audio' })).toEqual(['-x', '--audio-format', 'mp3', '--audio-quality', '192K']))
  it('解析全部媒体格式并生成音视频组合', () => {
    const formats = formatsFromYtDlp({ formats: [
      { format_id: '137', ext: 'mp4', height: 1080, vcodec: 'avc1.640028', acodec: 'none', filesize: 10 },
      { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', filesize: 3 },
      { format_id: '248', ext: 'webm', height: 1080, vcodec: 'vp9', acodec: 'none', filesize: 8 }
    ] })
    expect(formats.find(format => format.id === '137+140')).toMatchObject({ kind: 'video-audio', quickTimeCompatible: true, ext: 'mp4' })
    expect(formats.some(format => format.kind === 'video-only')).toBe(true)
    expect(formats.some(format => format.kind === 'audio-only')).toBe(true)
  })
  it('使用用户选择的精确格式', () => {
    const item = { selectedFormatId: '137+140', formats: [{ id: '137+140', selector: '137+140', kind: 'video-audio', ext: 'mp4', quickTimeCompatible: true }] } as MediaItem
    expect(buildFormatArgs(options, item)).toEqual(['-f', '137+140', '--merge-output-format', 'mp4'])
  })
  it('Instagram 扫描直链不再传递无意义的格式选择', () => {
    const item = { platform: 'instagram', selectedFormatId: 'best', formats: [{ id: 'best', selector: 'best', kind: 'video-audio', ext: 'mp4', quickTimeCompatible: false }] } as MediaItem
    expect(buildFormatArgs(options, item)).toEqual([])
  })
})

describe('Codex 设备登录输出', () => {
  const raw = '\u001b[90mWelcome to Codex\u001b[0m\nOpen this link:\n\u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\nEnter this one-time code (expires in 15 minutes)\n\u001b[94mA6FG-GHB4U\u001b[0m'
  it('移除终端 ANSI 控制码', () => expect(cleanCodexOutput(raw)).not.toContain('\u001b'))
  it('提取可点击链接和可复制登录码', () => expect(parseCodexLoginOutput(raw)).toMatchObject({ loginUrl: 'https://auth.openai.com/codex/device', loginCode: 'A6FG-GHB4U' }))
})

describe('Codex 分析进度输出', () => {
  it('默认固定使用 GPT-5.6 Sol 和 medium 推理强度', () => {
    expect(resolveCodexAnalysisConfig({})).toEqual({ model: 'gpt-5.6-sol', reasoningEffort: 'medium' })
    const codex = new CodexService(() => undefined)
    expect(codex.analysisArguments('/config/analysis/example', 'analyze manifest')).toEqual([
      '--model', 'gpt-5.6-sol', '--config', 'model_reasoning_effort="medium"', '--ask-for-approval', 'never', '--sandbox', 'danger-full-access', '--cd', '/config/analysis/example', 'exec', '--json', '--ephemeral', '--skip-git-repo-check', 'analyze manifest',
    ])
  })

  it('允许通过环境变量覆盖分析模型和推理强度', () => {
    expect(resolveCodexAnalysisConfig({ SVD_CODEX_MODEL: 'gpt-6-sol', SVD_CODEX_REASONING_EFFORT: 'HIGH' })).toEqual({ model: 'gpt-6-sol', reasoningEffort: 'high' })
  })

  it('关闭子进程标准输入，避免 Codex 等待额外输入', async () => {
    const result = await executeAnalysisProcess(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end', () => console.log('stdin-closed'))"], { timeout: 1000 })
    expect(result).toMatchObject({ code: 0 })
    expect(result.output).toContain('stdin-closed')
  })

  it('把 JSONL 命令事件转换为可读信息', () => {
    const result = parseCodexProgressLine(JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'python inspect.py manifest.json' } }))
    expect(result).toMatchObject({ level: 'command', message: '正在检查证据：python inspect.py manifest.json' })
  })

  it('显示 token 用量并过滤未知事件', () => {
    expect(parseCodexProgressLine(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1200, output_tokens: 300 } }))).toMatchObject({ level: 'result', message: 'Codex 分析完成，本轮使用 1,500 tokens' })
    expect(parseCodexProgressLine(JSON.stringify({ type: 'thread.metadata', value: 1 }))).toBeUndefined()
  })
})

describe('下载队列', () => {
  it('使用媒体标题而不是 CDN URL 生成安全的短文件名', () => {
    const item = { id: 'ABC123', sourceUrl: `https://cdn.example/${'x'.repeat(400)}.mp4?token=secret`, platform: 'instagram', title: 'Talk to each other 😂', uploader: '', duration: 0, thumbnail: '', publishedAt: '20261001', selected: true, kind: 'video' } as MediaItem
    const template = buildOutputTemplate('/downloads', item)
    expect(template).toBe('/downloads/2026-10-01_Talk to each other 😂_[ABC123].%(ext)s')
    expect(template).not.toContain('token')
  })
  it('解析 yt-dlp 的机器可读进度和准备阶段', () => {
    expect(parseDownloadOutput('svd: 11.6%|36.04KiB/s|00:29')).toEqual({ progress: 11.6, speed: '36.04KiB/s', eta: '00:29', detail: '正在下载媒体文件…' })
    expect(parseDownloadOutput('Extracting cookies from chrome')).toEqual({ detail: '正在读取服务器 Cookie 文件…' })
    expect(parseDownloadOutput('[Merger] Merging formats into "video.mp4"')).toEqual({ detail: '正在合并并处理媒体文件…' })
  })
  it('工具解析尚未完成时也只预留三个并发任务', async () => {
    const never = new Promise<string | undefined>(() => undefined)
    const queue = new DownloadQueue({ resolve: () => never } as never)
    const item = (id: string): MediaItem => ({ id, sourceUrl: `https://example.com/${id}`, platform: 'other', title: id, uploader: '', duration: 0, thumbnail: '', publishedAt: '', selected: true, kind: 'video' })
    const jobs = await queue.start({ items: ['1', '2', '3', '4', '5'].map(item), options }, () => undefined)
    expect(jobs.filter(job => job.status === 'downloading')).toHaveLength(3)
    expect(jobs.filter(job => job.status === 'queued')).toHaveLength(2)
  })
})

describe('Instagram 扫描', () => {
  it('解析 gallery-dl JSONL 的视频记录并忽略图片', () => {
    const video = mediaFromGalleryDlLine(JSON.stringify([2, 'https://cdn.example/media', { extension: 'mp4', post_shortcode: 'abc', username: 'owner' }]), 'fallback')
    expect(video).toMatchObject({ id: 'abc', sourceUrl: 'https://cdn.example/media', uploader: 'owner' })
    expect(mediaFromGalleryDlLine(JSON.stringify([2, 'https://cdn.example/image.jpg', { extension: 'jpg' }]), 'fallback')).toBeUndefined()
  })
  it('把 gallery-dl 内嵌错误显示给用户', () => {
    expect(() => mediaFromGalleryDlLine(JSON.stringify([-1, { error: 'AuthError', message: 'login required' }]), 'owner')).toThrow('login required')
  })
})
