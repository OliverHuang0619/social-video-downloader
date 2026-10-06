import { describe, expect, it } from 'vitest'
import { MULTIPOST_PLATFORMS } from '../src/shared/multipost-platforms'
import { multipostInjectors } from '../skills/english-video-catalog/scripts/multipost/injectors.mjs'
import { buildSyncData, publishMediaUrls, resolveMediaFulfillment } from '../skills/english-video-catalog/scripts/multipost/media.mjs'
import { classifyPublishOutcome } from '../skills/english-video-catalog/scripts/multipost/outcome.mjs'

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
    }
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
  })

  it('发布载荷把摘要、话题和定时传给注入函数', () => {
    const urls = publishMediaUrls('job-1')
    const sync = buildSyncData({ platform: 'VIDEO_BILIBILI', file: '/downloads/lesson.mp4', title: 'Directions', summary: '练习问路。', topics: ['#英语启蒙', 'English'], publishAt: '2026-10-06T12:00:00.000Z', coverFile: '/config/thumbnails/job.jpg' }, urls)
    expect(sync.isAutoPublish).toBe(true)
    expect(sync.data).toMatchObject({ title: 'Directions', content: '练习问路。', tags: ['英语启蒙', 'English'], scheduledPublishTime: Date.parse('2026-10-06T12:00:00.000Z') })
    expect(sync.data.video).toEqual({ name: 'lesson.mp4', url: urls.videoUrl, type: 'video/mp4' })
    expect(sync.data.cover?.url).toBe(urls.coverUrl)
  })
})
