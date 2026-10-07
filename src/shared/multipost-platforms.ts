export const DOUYIN_PUBLISH_PLATFORM = 'douyin'
export const DOUYIN_TITLE_LIMIT = 30
export const MULTIPOST_TITLE_LIMIT = 100

export interface MultipostPlatform {
  id: string
  label: string
  homeUrl: string
  injectUrl: string
  /** Host guard required by the vendored injector, after any platform redirect. */
  injectorHost?: string
}

/** Video platforms from MultiPost-Extension, excluding its Douyin injector. */
export const MULTIPOST_PLATFORMS: MultipostPlatform[] = [
  { id: 'VIDEO_REDNOTE', label: '小红书', homeUrl: 'https://creator.xiaohongshu.com', injectUrl: 'https://creator.xiaohongshu.com/publish/publish?target=video' },
  { id: 'VIDEO_BILIBILI', label: '哔哩哔哩', homeUrl: 'https://member.bilibili.com/', injectUrl: 'https://member.bilibili.com/platform/upload/video/frame' },
  { id: 'VIDEO_WEIXINCHANNEL', label: '微信视频号', homeUrl: 'https://channels.weixin.qq.com/platform', injectUrl: 'https://channels.weixin.qq.com/platform/post/create' },
  { id: 'VIDEO_KUAISHOU', label: '快手', homeUrl: 'https://cp.kuaishou.com/', injectUrl: 'https://cp.kuaishou.com/article/publish/video' },
  { id: 'VIDEO_WEIBO', label: '微博', homeUrl: 'https://weibo.com/', injectUrl: 'https://weibo.com/upload/channel' },
  { id: 'VIDEO_BAIJIAHAO', label: '百家号', homeUrl: 'https://baijiahao.baidu.com/', injectUrl: 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2' },
  { id: 'VIDEO_TOUTIAOHAO', label: '今日头条号', homeUrl: 'https://www.toutiao.com/', injectUrl: 'https://mp.toutiao.com/profile_v4/xigua/upload-video' },
  { id: 'VIDEO_YOUTUBE', label: 'YouTube', homeUrl: 'https://studio.youtube.com/', injectUrl: 'https://studio.youtube.com/' },
  { id: 'VIDEO_TIKTOK', label: 'Tiktok', homeUrl: 'https://www.tiktok.com/tiktokstudio', injectUrl: 'https://www.tiktok.com/tiktokstudio/upload' },
  { id: 'VIDEO_ZHIHU', label: '知乎', homeUrl: 'https://www.zhihu.com/', injectUrl: 'https://www.zhihu.com/zvideo/upload-video' },
  { id: 'VIDEO_OKJIKE', label: '即刻', homeUrl: 'https://web.okjike.com', injectUrl: 'https://web.okjike.com' },
  { id: 'VIDEO_QIE', label: '企鹅号', homeUrl: 'https://om.qq.com/', injectUrl: 'https://om.qq.com/main/creation/video', injectorHost: 'om.qq.com' },
  { id: 'VIDEO_IQIYI', label: '爱奇艺', homeUrl: 'https://mp.iqiyi.com/', injectUrl: 'https://mp.iqiyi.com/sns/publishv2/video' },
  { id: 'VIDEO_YOUKU', label: '优酷', homeUrl: 'https://mp.youku.com/', injectUrl: 'https://mp.youku.com/v2/manage/upload' },
  { id: 'VIDEO_TENCENTVIDEO', label: '腾讯视频', homeUrl: 'https://v.qq.com/', injectUrl: 'https://cm.v.qq.com/upload' },
  { id: 'VIDEO_BLUESKY', label: 'BlueSky', homeUrl: 'https://bsky.app/', injectUrl: 'https://bsky.app/' },
  { id: 'VIDEO_EASTMONEY', label: '东方财富', homeUrl: 'https://www.eastmoney.com/', injectUrl: 'https://mp.eastmoney.com/collect/pc_writer/index.html#/publish/video' },
  { id: 'VIDEO_XIAOHEIHE', label: '小黑盒', homeUrl: 'https://www.xiaoheihe.cn/', injectUrl: 'https://www.xiaoheihe.cn/creator/editor/draft/video' },
  { id: 'VIDEO_CHEJIAHAO', label: '车家号', homeUrl: 'https://creator.autohome.com.cn/', injectUrl: 'https://creator.autohome.com.cn/web/publish/video', injectorHost: 'creator.autohome.com.cn' },
  { id: 'VIDEO_DEWU', label: '得物', homeUrl: 'https://creator.dewu.com/', injectUrl: 'https://creator.dewu.com/release' },
  { id: 'VIDEO_YICHE', label: '易车', homeUrl: 'https://mp.yiche.com/', injectUrl: 'https://mp.yiche.com/videos/video', injectorHost: 'mp.yiche.com' },
  { id: 'VIDEO_SOHU', label: '搜狐号', homeUrl: 'https://mp.sohu.com', injectUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addvideo', injectorHost: 'mp.sohu.com' },
  { id: 'VIDEO_SOHUTV', label: '搜狐视频', homeUrl: 'https://tv.sohu.com/s/center/', injectUrl: 'https://tv.sohu.com/s/center/' },
  { id: 'VIDEO_NETEASE', label: '网易号', homeUrl: 'http://mp.163.com/', injectUrl: 'https://dy.163.com/subscribe_v4/index.html#/home', injectorHost: 'dy.163.com' },
  { id: 'VIDEO_DAYU', label: '大鱼号', homeUrl: 'https://mp.dayu.com/', injectUrl: 'https://mp.dayu.com/dashboard/video/write', injectorHost: 'mp.dayu.com' },
  { id: 'VIDEO_ALIPAY', label: '支付宝', homeUrl: 'https://sweb.alipay.com', injectUrl: 'https://b.alipay.com/page/content-creation/publish/short-video', injectorHost: 'b.alipay.com' },
  { id: 'VIDEO_YIDIAN', label: '一点号', homeUrl: 'https://mp.yidianzixun.com/', injectUrl: 'https://mp.yidian.com/', injectorHost: 'yidian.com' },
  { id: 'VIDEO_PINDUODUO', label: '拼多多', homeUrl: 'https://live.pinduoduo.com/', injectUrl: 'https://live.pinduoduo.com/creator/live-record', injectorHost: 'pinduoduo.com' },
  { id: 'VIDEO_VIVOVIDEO', label: 'vivo视频', homeUrl: 'https://kaixinkan.vivo.com.cn/', injectUrl: 'https://video.vivo.com.cn/#/home', injectorHost: 'video.vivo.com.cn' },
]

const byId = new Map(MULTIPOST_PLATFORMS.map(platform => [platform.id, platform]))

export function isDouyinPublishPlatform(platform: string | undefined): boolean {
  return !platform || platform === DOUYIN_PUBLISH_PLATFORM
}

export function multipostPlatform(id: string): MultipostPlatform | undefined {
  return byId.get(id)
}

export function publishPlatformLabel(platform: string | undefined): string {
  if (isDouyinPublishPlatform(platform)) return '抖音'
  return byId.get(platform || '')?.label || platform || '抖音'
}

export function resolvePublishPlatforms(platforms?: string[]): string[] {
  const selected = [...new Set(platforms?.length ? platforms : [DOUYIN_PUBLISH_PLATFORM])]
  for (const id of selected) {
    if (!isDouyinPublishPlatform(id) && !byId.has(id)) throw new Error('发布平台无效')
  }
  return selected
}
