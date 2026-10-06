export function publishMediaUrls(jobId) {
  const id = encodeURIComponent(jobId)
  return {
    videoUrl: `https://svd.local/publish/${id}/video`,
    coverUrl: `https://svd.local/publish/${id}/cover`,
  }
}

export function videoContentType(file) {
  const ext = String(file).toLowerCase()
  if (ext.endsWith('.webm')) return 'video/webm'
  if (ext.endsWith('.mov')) return 'video/quicktime'
  if (ext.endsWith('.mkv')) return 'video/x-matroska'
  return 'video/mp4'
}

export function isPublishMediaRequest(requestUrl) {
  try { return new URL(requestUrl).hostname === 'svd.local' } catch { return false }
}

export function isWeixinMediaSuiteWasm(requestUrl) {
  try {
    const url = new URL(requestUrl)
    return url.hostname === 'aladin.wxqcloud.qq.com' && url.pathname.includes('/rhino-media-suite/') && url.pathname.endsWith('.wasm')
  } catch { return false }
}

export function resolveMediaFulfillment(requestUrl, files) {
  if (requestUrl === files.videoUrl) return { path: files.videoPath, contentType: files.videoType }
  if (files.coverUrl && requestUrl === files.coverUrl) return { path: files.coverPath, contentType: files.coverType }
  return null
}

/** Keep a platform title inside its character limit, breaking on a word when possible. */
export function clampPublishTitle(title, limit) {
  const chars = [...String(title || '').trim()]
  if (chars.length <= limit) return chars.join('')
  const cut = chars.slice(0, limit).join('')
  const space = cut.lastIndexOf(' ')
  if (space >= Math.ceil(limit / 2)) return cut.slice(0, space).trim()
  return cut.trim()
}

export function buildSyncData(payload, urls) {
  const videoName = String(payload.file || 'video.mp4').split(/[/\\]/).pop() || 'video.mp4'
  const titleLimit = payload.platform === 'VIDEO_WEIXINCHANNEL' ? 16 : 0
  const data = {
    title: titleLimit ? clampPublishTitle(payload.title || '', titleLimit) : (payload.title || ''),
    content: payload.summary || '',
    video: { name: videoName, url: urls.videoUrl, type: payload.videoType || videoContentType(payload.file || '') },
    tags: (payload.topics || []).map(topic => String(topic).replace(/^#+/, '').trim()).filter(Boolean).slice(0, 5),
  }
  if (payload.coverFile) {
    const coverName = String(payload.coverFile).split(/[/\\]/).pop() || 'cover.jpg'
    data.cover = { name: coverName, url: urls.coverUrl, type: 'image/jpeg' }
  }
  if (payload.publishAt) {
    const time = Date.parse(payload.publishAt)
    if (!Number.isNaN(time)) data.scheduledPublishTime = time
  }
  return { platforms: [{ name: payload.platform }], isAutoPublish: true, data }
}
