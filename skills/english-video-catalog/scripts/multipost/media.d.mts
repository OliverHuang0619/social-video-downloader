export function publishMediaUrls(jobId: string): { videoUrl: string; coverUrl: string }
export function videoContentType(file: string): string
export function isPublishMediaRequest(requestUrl: string): boolean
export function isWeixinMediaSuiteWasm(requestUrl: string): boolean
export function resolveMediaFulfillment(requestUrl: string, files: { videoUrl: string; videoPath: string; videoType: string; coverUrl?: string; coverPath?: string; coverType?: string }): { path: string; contentType: string } | null
export function clampPublishTitle(title: string, limit: number): string
export function buildSyncData(payload: { platform?: string; file?: string; title?: string; summary?: string; topics?: string[]; publishAt?: string; coverFile?: string; videoType?: string }, urls: { videoUrl: string; coverUrl: string }): { platforms: Array<{ name?: string }>; isAutoPublish: boolean; data: { title: string; content: string; video: { name: string; url: string; type: string }; tags: string[]; cover?: { name: string; url: string; type: string }; scheduledPublishTime?: number } }
