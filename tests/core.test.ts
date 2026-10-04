import { describe, expect, it } from 'vitest'
import { automaticPlatformPublishTimes, buildFormatArgs, detectPlatform, filterMediaAssets, formatsFromYtDlp, localPublishSubmissionTimes, mediaAssetDirectory, nextSafePlatformPublishTime, normalizePublishTopics, normalizeUrls, randomPublishSubmissionDelayMs, sanitizeFilename } from '../src/shared/core'
import { buildOutputTemplate, DownloadQueue, parseDownloadOutput, QUICKTIME_MAX_EDGE, quickTimeArgs, summarizeProcessError } from '../src/main/queue'
import { classifyError, mediaFromGalleryDlLine, youtubeAttemptSources, youtubeCookieArgs } from '../src/main/media'
import { CodexService, cleanCodexOutput, parseCodexLoginOutput, parseCodexRateLimits, resolveCodexAnalysisConfig } from '../src/server/codex'
import { executeAnalysisProcess, parseCodexProgressLine } from '../src/server/analysis'
import { hasPlatformLogin, parseManualCookies, serializeNetscapeCookies } from '../src/server/youtube-cookies'
import type { DownloadOptions, MediaAsset, MediaItem } from '../src/shared/types'

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

describe('媒体库筛选', () => {
  const asset = (id: string, processingState: MediaAsset['processingState'], analyzed: boolean): MediaAsset => ({
    id,
    file: `/downloads/${id}.mp4`,
    filename: `${id}.mp4`,
    processingState,
    analysis: analyzed ? { title: id, englishTitle: id, category: '英语', keyTopics: [], summary: id, confidence: 'high', evidenceNote: id } : undefined,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z'
  })

  it('等待分析筛选包含所有尚无分析结果的视频，不受处理状态影响', () => {
    const unprocessedAwaiting = asset('unprocessed-awaiting', 'unprocessed', false)
    const unprocessedAnalyzed = asset('unprocessed-analyzed', 'unprocessed', true)
    const processedAwaiting = asset('processed-awaiting', 'processed', false)
    const processedAnalyzed = asset('processed-analyzed', 'processed', true)
    const assets = [unprocessedAwaiting, unprocessedAnalyzed, processedAwaiting, processedAnalyzed]

    expect(filterMediaAssets(assets, 'awaiting-analysis', 'all', '')).toEqual([unprocessedAwaiting, processedAwaiting])
    expect(filterMediaAssets(assets, 'processed', 'all', '')).toEqual([processedAwaiting, processedAnalyzed])
    expect(filterMediaAssets(assets, 'unprocessed', 'all', '')).toEqual([unprocessedAnalyzed])
  })

  it('按媒体文件父目录筛选，并继续组合其他筛选条件', () => {
    const course = { ...asset('course', 'unprocessed', true), file: '/downloads/course-a/lesson.mp4' }
    const nested = { ...asset('nested', 'processed', true), file: '/downloads/course-a/unit-2/dialogue.mp4' }
    const other = { ...asset('other', 'unprocessed', true), file: '/downloads/course-b/story.mp4' }
    const assets = [course, nested, other]

    expect(mediaAssetDirectory(course.file)).toBe('/downloads/course-a')
    expect(mediaAssetDirectory('C:\\downloads\\course-a\\lesson.mp4')).toBe('C:/downloads/course-a')
    expect(filterMediaAssets(assets, 'all', 'all', '', '/downloads/course-a')).toEqual([course])
    expect(filterMediaAssets(assets, 'processed', 'all', '', '/downloads/course-a/unit-2')).toEqual([nested])
  })
})

describe('抖音自动排期', () => {
  it('发布话题固定包含英语启蒙并排除标题及其截断版本', () => {
    expect(normalizePublishTopics('The Cost of Using the Wrong Na', ['叫错名字的代价', 'The Cost of Using the Wrong Name', '#基础问答', '英语启蒙'])).toEqual(['英语启蒙', '叫错名字的代价', '基础问答'])
  })

  it('首条立即发布，后续从两小时后开始按配置间隔排期', () => {
    const now = new Date('2026-10-03T04:06:30.000Z')
    expect(automaticPlatformPublishTimes(4, 1, now)).toEqual([
      undefined,
      '2026-10-03T06:15:00.000Z',
      '2026-10-03T07:15:00.000Z',
      '2026-10-03T08:15:00.000Z',
    ])
    expect(nextSafePlatformPublishTime(now)).toBe('2026-10-03T06:15:00.000Z')
  })

  it('本地浏览器提交相邻作品时随机等待一至三分钟', () => {
    expect(randomPublishSubmissionDelayMs(() => 0)).toBe(60_000)
    expect(randomPublishSubmissionDelayMs(() => 0.5)).toBe(120_000)
    expect(randomPublishSubmissionDelayMs(() => 0.999)).toBe(180_000)
    const values = [0, 0.999]
    expect(localPublishSubmissionTimes(3, new Date('2026-10-03T04:06:30.000Z'), () => values.shift()!)).toEqual([
      '2026-10-03T04:06:30.000Z',
      '2026-10-03T04:07:30.000Z',
      '2026-10-03T04:10:30.000Z',
    ])
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

  it('把 Codex 限额转换为剩余百分比与重置时间', () => {
    expect(parseCodexRateLimits({ ordinaryUsageAllowed: true, rateLimitsByLimitId: { codex: { limitId: 'codex', planType: 'plus', primary: { usedPercent: 26, windowDurationMins: 10080, resetsAt: 1791587563 } } } })).toEqual({ planType: 'plus', ordinaryUsageAllowed: true, limits: [{ id: 'codex', name: undefined, primary: { usedPercent: 26, remainingPercent: 74, windowDurationMins: 10080, resetsAt: 1791587563 }, secondary: undefined }] })
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
    expect(parseDownloadOutput('[download] Resuming download at byte 1048576')).toEqual({ detail: '发现本地缓存，从断点继续下载…' })
    expect(parseDownloadOutput('[download] video.mp4 has already been downloaded')).toEqual({ detail: '文件已存在，复用本地文件…' })
  })
  it('QuickTime 转码限制为 1080p 级别并使用低内存预设', () => {
    const args = quickTimeArgs('/downloads/a.mp4', '/downloads/a.quicktime.mp4')
    const filter = args[args.indexOf('-vf') + 1]
    expect(filter).toContain(`min(iw,${QUICKTIME_MAX_EDGE})`)
    expect(filter).toContain('force_original_aspect_ratio=decrease')
    expect(filter).toContain('force_divisible_by=2')
    expect(args.slice(args.indexOf('-preset'), args.indexOf('-preset') + 2)).toEqual(['-preset', 'veryfast'])
    expect(args).toContain('+faststart')
    expect(args.at(-1)).toBe('/downloads/a.quicktime.mp4')
  })
  it('从 ffmpeg / yt-dlp 输出中提取真正的错误原因', () => {
    const ffmpeg = 'ffmpeg version 5.1.9\n  vendor_id       : [0][0][0][0]\n  encoder         : Lavc59.37.100 aac\nframe=    1 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x\r[aac @ 0x1] Error submitting packet\nConversion failed!\nframe=   46 fps=0.0 q=0.0 size=       0kB'
    expect(summarizeProcessError(ffmpeg, '未知错误')).toBe('[aac @ 0x1] Error submitting packet\nConversion failed!')
    expect(summarizeProcessError('ERROR: [youtube] abc: Sign in to confirm you’re not a bot', '下载失败')).toContain('Sign in')
    expect(summarizeProcessError('frame= 1 fps=0.0\n', '下载失败')).toBe('下载失败')
  })
  it('重启后恢复历史任务，失败任务可单个或批量重试并复用缓存', async () => {
    const queue = new DownloadQueue({ resolve: async () => undefined } as never)
    const item = (id: string): MediaItem => ({ id, sourceUrl: `https://example.com/${id}`, platform: 'other', title: id, uploader: '', duration: 0, thumbnail: '', publishedAt: '', selected: true, kind: 'video' })
    const persisted = ['a', 'b', 'c'].map((id, index) => ({ id, item: item(id), options, status: (['failed', 'completed', 'downloading'] as const)[index], progress: index * 10, attempts: 3, error: index === 0 ? '网络中断' : undefined }))
    queue.hydrate(persisted); queue.hydrate(persisted)
    expect(queue.snapshot()).toHaveLength(3)
    expect(queue.get('c')?.status).toBe('failed')
    const reported: string[][] = []
    queue.setReporter(jobs => reported.push(jobs.map(job => `${job.id}:${job.status}`)))
    expect(queue.retryFailed()).toBe(2)
    expect(reported[0]).toEqual(['c:queued', 'b:completed', 'a:queued'])
    // pump() reserves a slot right away, so the first attempt is already counted.
    expect(queue.get('a')).toMatchObject({ status: 'downloading', attempts: 1, progress: 0, error: undefined })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(queue.get('a')).toMatchObject({ status: 'failed', error: '未找到 yt-dlp' })
    expect(queue.get('b')?.status).toBe('completed')
    queue.retry('b'); expect(queue.get('b')?.status).toBe('completed')
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

describe('YouTube 解析容错', () => {
  it('使用 Cookie 失败后回退到公开解析', () => {
    expect(youtubeAttemptSources('file')).toEqual(['file', 'none'])
    expect(youtubeAttemptSources('none')).toEqual(['none', 'none'])
    expect(youtubeCookieArgs('file')).toContain('youtube:player_client=default,web_embedded')
    expect(youtubeCookieArgs('file')).toContain('node')
  })
  it('把 YouTube 临时刷新页和不可用视频转换为明确提示', () => {
    expect(classifyError('ERROR: [youtube] abc: The page needs to be reloaded.')).toContain('页面暂时异常')
    expect(classifyError('ERROR: [youtube] abc: This video is unavailable')).toBe('该内容不可用、为私密内容或受到地区限制。')
  })
})

describe('平台 Cookie 管理', () => {
  it('识别 YouTube 和 Instagram 登录会话', () => {
    expect(hasPlatformLogin('youtube', [{ name: 'PREF' }])).toBe(false)
    expect(hasPlatformLogin('youtube', [{ name: '__Secure-3PSID' }])).toBe(true)
    expect(hasPlatformLogin('instagram', [{ name: 'sessionid' }])).toBe(true)
  })
  it('生成 yt-dlp 可读取的 Netscape Cookie 文件', () => {
    const output = serializeNetscapeCookies([
      { name: 'SID', value: 'secret', domain: '.youtube.com', path: '/', expires: 1800000000, httpOnly: true, secure: true },
      { name: 'ignored', value: 'other', domain: '.example.com', path: '/', expires: -1, httpOnly: false, secure: false },
    ])
    expect(output).toContain('#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1800000000\tSID\tsecret')
    expect(output).toContain('.example.com')
  })
  it('支持手动粘贴 Cookie 请求头和浏览器 JSON', () => {
    expect(parseManualCookies('instagram', 'Cookie: sessionid=abc; csrftoken=def')).toHaveLength(2)
    expect(parseManualCookies('youtube', JSON.stringify([{ domain: '.youtube.com', name: 'SID', value: 'abc' }]))[0]).toMatchObject({ name: 'SID', domain: '.youtube.com' })
    expect(() => parseManualCookies('instagram', JSON.stringify([{ domain: '.youtube.com', name: 'SID', value: 'abc' }]))).toThrow('Instagram')
  })
})
