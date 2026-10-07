import { describe, expect, it } from 'vitest'
import { MULTIPOST_PLATFORMS } from '../src/shared/multipost-platforms'
import { multipostInjectors } from '../skills/english-video-catalog/scripts/multipost/injectors.mjs'
import { buildSyncData, clampPublishTitle, isPublishMediaRequest, isWeixinMediaSuiteWasm, publishMediaUrls, resolveMediaFulfillment } from '../skills/english-video-catalog/scripts/multipost/media.mjs'
import { classifyPublishOutcome, waitForPublishOutcome } from '../skills/english-video-catalog/scripts/multipost/outcome.mjs'

describe('MultiPost 视频平台', () => {
  it('目录覆盖上游全部非抖音视频平台，并带有对应注入函数', () => {
    const ids = MULTIPOST_PLATFORMS.map(platform => platform.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain('VIDEO_DOUYIN')
    expect(ids).not.toContain('douyin')
    expect(ids).toEqual(expect.arrayContaining(['VIDEO_REDNOTE', 'VIDEO_BILIBILI', 'VIDEO_WEIXINCHANNEL', 'VIDEO_KUAISHOU', 'VIDEO_WEIBO', 'VIDEO_BAIJIAHAO', 'VIDEO_TOUTIAOHAO', 'VIDEO_YOUTUBE', 'VIDEO_TIKTOK']))
    expect(Object.keys(multipostInjectors).sort()).toEqual([...ids].sort())
    for (const platform of MULTIPOST_PLATFORMS) {
      expect(platform.homeUrl).toMatch(/^https?:\/\//)
      expect(platform.injectUrl).toMatch(/^https?:\/\//)
      expect(typeof multipostInjectors[platform.id]).toBe('function')
      const hostGuard = multipostInjectors[platform.id].toString().match(/window\.location\.href\.includes\("([^"]+)"\)/)?.[1]
      expect(platform.injectorHost).toBe(hostGuard)
      if (platform.injectorHost) expect(new URL(platform.injectUrl).hostname.endsWith(platform.injectorHost)).toBe(true)
    }
  })

  it('等待延迟出现的发布成功提示再返回终态', async () => {
    let reads = 0
    const outcome = await waitForPublishOutcome({
      getState: async () => ({ url: 'https://creator.xiaohongshu.com/publish', body: ++reads < 3 ? '正在提交' : '发布成功', hasFileInput: true }),
      wait: async () => undefined,
      timeoutMs: 100,
    })
    expect(outcome).toEqual({ event: 'published' })
    expect(reads).toBe(3)
  })

  it('只把本地视频和封面应答给发布页里的指定地址', () => {
    const urls = publishMediaUrls('job/1')
    const files = { videoUrl: urls.videoUrl, videoPath: '/downloads/a.mp4', videoType: 'video/mp4', coverUrl: urls.coverUrl, coverPath: '/config/thumbnails/a.jpg', coverType: 'image/jpeg' }
    expect(resolveMediaFulfillment(urls.videoUrl, files)).toEqual({ path: '/downloads/a.mp4', contentType: 'video/mp4' })
    expect(resolveMediaFulfillment(urls.coverUrl, files)).toEqual({ path: '/config/thumbnails/a.jpg', contentType: 'image/jpeg' })
    expect(resolveMediaFulfillment('https://creator.xiaohongshu.com/video.mp4', files)).toBeNull()
    expect(resolveMediaFulfillment('https://svd.local/publish/other/video', files)).toBeNull()
  })

  it('注入脚本只留下日志、页面没有成功信号时不能记成已发布', () => {
    const outcome = classifyPublishOutcome({
      url: 'https://creator.xiaohongshu.com/publish/publish?target=video',
      body: '发布',
      logs: ['视频上传已初始化', '发布过程中出错: timeout'],
      scheduled: false,
      hasFileInput: true,
    })
    expect(outcome.event).toBe('error')
    expect(outcome.message).toContain('MANUAL_REVIEW_REQUIRED')
    expect(outcome.event).not.toBe('published')
  })

  it('没有成功文案时保持需要检查，识别到成功后才区分立即发布和排期', () => {
    expect(classifyPublishOutcome({ url: 'https://example.com/upload', body: '标题已填写', logs: ['标题已填写'], hasFileInput: true }).event).toBe('error')
    expect(classifyPublishOutcome({ url: 'https://example.com/upload', body: '发布成功', logs: [], hasFileInput: true }).event).toBe('published')
    expect(classifyPublishOutcome({ url: 'https://example.com/upload', body: '定时发布成功', logs: [], scheduled: true, hasFileInput: true }).event).toBe('scheduled')
    expect(classifyPublishOutcome({ url: 'https://example.com/login', body: '扫码登录', hasFileInput: false }).message).toContain('LOGIN_REQUIRED')
    expect(classifyPublishOutcome({
      url: 'https://channels.weixin.qq.com/',
      body: '登录视频号助手\n一站式服务，让创作更简单。',
      logs: ['WeiXinVideo 发布过程中出错: Element with selector "input[type=file]" not found within 10000ms'],
      hasFileInput: false,
    }).message).toContain('LOGIN_REQUIRED')
  })

  it('发布载荷把摘要、话题和定时传给注入函数', () => {
    const urls = publishMediaUrls('job-1')
    const sync = buildSyncData({ platform: 'VIDEO_BILIBILI', file: '/downloads/lesson.mp4', title: 'Directions', summary: '练习问路。', topics: ['#英语启蒙', 'English'], publishAt: '2026-10-06T12:00:00.000Z', coverFile: '/config/thumbnails/job.jpg' }, urls)
    expect(sync.isAutoPublish).toBe(true)
    expect(sync.data).toMatchObject({ title: 'Directions', content: '练习问路。', tags: ['英语启蒙', 'English'], scheduledPublishTime: Date.parse('2026-10-06T12:00:00.000Z') })
    expect(sync.data.video).toEqual({ name: 'lesson.mp4', url: urls.videoUrl, type: 'video/mp4' })
    expect(sync.data.cover?.url).toBe(urls.coverUrl)
  })

  it('视频号短标题截到 16 字，并尽量停在单词边界', () => {
    expect(clampPublishTitle('Talking About Rainy Weather', 16)).toBe('Talking About')
    expect(clampPublishTitle('下雨天怎么说', 16)).toBe('下雨天怎么说')
    expect(clampPublishTitle('一二三四五六七八九十一二三四五六七八九十', 16)).toBe('一二三四五六七八九十一二三四五六')
    const urls = publishMediaUrls('job-wx')
    const sync = buildSyncData({ platform: 'VIDEO_WEIXINCHANNEL', file: '/downloads/lesson.mp4', title: 'Talking About Rainy Weather', summary: '练习下雨天。', topics: [] }, urls)
    expect(sync.data.title).toBe('Talking About')
  })

  it('视频号短标题替换不支持的撇号和逗号，保留允许的引号与标点', () => {
    const urls = publishMediaUrls('job-wx-punctuation')
    const sync = buildSyncData({ platform: 'VIDEO_WEIXINCHANNEL', file: '/downloads/lesson.mp4', title: "It's a Frog, 20%?", topics: [] }, urls)
    expect(sync.data.title).toBe('It’s a Frog 20%?')
    expect(sync.data.title).not.toContain("'")
  })

  it('只拦截本地发布文件和视频号编辑器 wasm', () => {
    const urls = publishMediaUrls('job-1')
    expect(isPublishMediaRequest(urls.videoUrl)).toBe(true)
    expect(isPublishMediaRequest('https://channels.weixin.qq.com/platform/post/create')).toBe(false)
    const wasm = 'https://aladin.wxqcloud.qq.com/aladin/ffmepeg/rhino-media-suite/1.5.18/rhino_video.wasm?_pageUrl=https%3A%2F%2Fchannels.weixin.qq.com%2Fmicro%2Fcontent%2Fpost%2Fcreate'
    expect(isWeixinMediaSuiteWasm(wasm)).toBe(true)
    expect(isWeixinMediaSuiteWasm('https://aladin.wxqcloud.qq.com/aladin/other.js')).toBe(false)
  })
})
