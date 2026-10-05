import { randomUUID } from 'node:crypto'
import { detectPlatform, normalizeUrls } from '../shared/core'
import type { ConfigStore } from '../main/config'
import type { MediaService } from '../main/media'
import type { DownloadQueue } from '../main/queue'
import type {
  CreatorSubscription,
  MediaItem,
  SubscriptionNotification,
  SubscriptionSchedule,
  SubscriptionStatus,
} from '../shared/types'
import type { AppDatabase } from './db'

const SHALLOW_LIMIT = 30
const META_HOUR = 'subscription_poll_hour'
const META_MINUTE = 'subscription_poll_minute'
const META_ENABLED = 'subscription_poll_enabled'
const META_LAST = 'subscription_last_poll_at'
const META_NEXT = 'subscription_next_poll_at'

function mediaKey(item: MediaItem) {
  return `${item.platform}:${item.id}`
}

function displayNameFromItems(items: MediaItem[], url: string) {
  const fromItem = items.find(item => item.uploader || item.collection)
  if (fromItem?.uploader) return fromItem.uploader
  if (fromItem?.collection) return fromItem.collection
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean)
    return path[0] || url
  } catch {
    return url
  }
}

function nextPollDate(hour: number, minute: number, from = new Date()) {
  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1)
  return next
}

export class SubscriptionService {
  private wakeTimer?: ReturnType<typeof setTimeout>
  private safetyTimer?: ReturnType<typeof setInterval>
  private polling = false
  private pollQueued = false

  constructor(
    private db: AppDatabase,
    private media: MediaService,
    private queue: DownloadQueue,
    private config: ConfigStore,
    private onChange: () => void,
  ) {
    this.ensureScheduleDefaults()
    this.scheduleWake(this.msUntilNextPoll())
    this.safetyTimer = setInterval(() => { void this.tick() }, 15_000)
    this.safetyTimer.unref?.()
  }

  list() { return this.db.subscriptions() }
  notifications() { return this.db.notifications() }
  status(): SubscriptionStatus {
    return { schedule: this.schedule(), unreadCount: this.db.unreadNotificationCount() }
  }
  schedule(): SubscriptionSchedule {
    return {
      enabled: this.db.meta(META_ENABLED) !== '0',
      hour: Number(this.db.meta(META_HOUR) ?? 0),
      minute: Number(this.db.meta(META_MINUTE) ?? 0),
      lastPollAt: this.db.meta(META_LAST) || undefined,
      nextPollAt: this.db.meta(META_NEXT) || undefined,
      polling: this.polling,
    }
  }

  updateSchedule(value: { enabled?: boolean; hour?: number; minute?: number }) {
    if (value.enabled !== undefined) this.db.setMeta(META_ENABLED, value.enabled ? '1' : '0')
    if (value.hour !== undefined) {
      const hour = Math.max(0, Math.min(23, Math.floor(value.hour)))
      this.db.setMeta(META_HOUR, String(hour))
    }
    if (value.minute !== undefined) {
      const minute = Math.max(0, Math.min(59, Math.floor(value.minute)))
      this.db.setMeta(META_MINUTE, String(minute))
    }
    this.refreshNextPollMeta()
    this.scheduleWake(this.msUntilNextPoll())
    this.onChange()
    return this.schedule()
  }

  async create(sourceUrl: string, autoDownload = false): Promise<CreatorSubscription> {
    const [url] = normalizeUrls(sourceUrl)
    const platform = detectPlatform(url)
    if (platform !== 'youtube' && platform !== 'instagram') throw Object.assign(new Error('仅支持 YouTube 或 Instagram 主页链接'), { statusCode: 400 })
    if (this.db.subscriptionByUrl(url)) throw Object.assign(new Error('该博主已订阅'), { statusCode: 409 })

    const cookieSource = this.config.get().cookieSource
    const items = await this.media.collectScan({ url, cookieSource, limit: SHALLOW_LIMIT })
    const subscription = this.db.createSubscription({
      id: randomUUID(),
      platform,
      sourceUrl: url,
      displayName: displayNameFromItems(items, url),
      autoDownload,
      enabled: true,
    })
    this.db.markSeen(subscription.id, items.map(mediaKey))
    this.db.updateSubscription(subscription.id, { lastPolledAt: new Date().toISOString(), lastError: undefined })
    this.onChange()
    return this.db.subscription(subscription.id)!
  }

  update(id: string, values: { autoDownload?: boolean; enabled?: boolean; displayName?: string }) {
    const updated = this.db.updateSubscription(id, values)
    if (!updated) throw Object.assign(new Error('订阅不存在'), { statusCode: 404 })
    this.onChange()
    return updated
  }

  remove(id: string) {
    if (!this.db.deleteSubscription(id)) throw Object.assign(new Error('订阅不存在'), { statusCode: 404 })
    this.onChange()
  }

  markRead(ids?: string[], all = false) {
    this.db.markNotificationsRead(ids, all)
    this.onChange()
    return { unreadCount: this.db.unreadNotificationCount() }
  }

  async pollNow() {
    this.pollQueued = true
    await this.tick(true)
    return this.status()
  }

  private ensureScheduleDefaults() {
    if (this.db.meta(META_HOUR) === undefined) this.db.setMeta(META_HOUR, '0')
    if (this.db.meta(META_MINUTE) === undefined) this.db.setMeta(META_MINUTE, '0')
    if (this.db.meta(META_ENABLED) === undefined) this.db.setMeta(META_ENABLED, '1')
    this.refreshNextPollMeta()
  }

  private refreshNextPollMeta() {
    const schedule = this.schedule()
    if (!schedule.enabled) {
      this.db.setMeta(META_NEXT, '')
      return
    }
    this.db.setMeta(META_NEXT, nextPollDate(schedule.hour, schedule.minute).toISOString())
  }

  private msUntilNextPoll() {
    const schedule = this.schedule()
    if (!schedule.enabled) return 60_000
    return Math.max(50, nextPollDate(schedule.hour, schedule.minute).getTime() - Date.now())
  }

  private scheduleWake(delayMs: number) {
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    const wait = Math.max(50, Math.min(delayMs, 15_000))
    this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; void this.tick() }, wait)
    this.wakeTimer.unref?.()
  }

  private async tick(force = false) {
    const schedule = this.schedule()
    const due = force || (schedule.enabled && schedule.nextPollAt && Date.parse(schedule.nextPollAt) <= Date.now())
    if (!due && !this.pollQueued) {
      this.scheduleWake(this.msUntilNextPoll())
      return
    }
    if (this.polling) {
      this.pollQueued = true
      return
    }
    this.polling = true
    this.pollQueued = false
    this.onChange()
    try {
      await this.pollAll()
      this.db.setMeta(META_LAST, new Date().toISOString())
      this.refreshNextPollMeta()
    } finally {
      this.polling = false
      this.onChange()
      if (this.pollQueued) {
        this.pollQueued = false
        void this.tick(true)
      } else {
        this.scheduleWake(this.msUntilNextPoll())
      }
    }
  }

  private async pollAll() {
    const cookieSource = this.config.get().cookieSource
    const options = this.config.get()
    for (const subscription of this.db.subscriptions().filter(item => item.enabled)) {
      try {
        const items = await this.media.collectScan({ url: subscription.sourceUrl, cookieSource, limit: SHALLOW_LIMIT })
        const seen = this.db.seenKeys(subscription.id)
        const fresh = items.filter(item => !seen.has(mediaKey(item)))
        const created: SubscriptionNotification[] = []
        if (fresh.length) {
          const downloadItems: MediaItem[] = []
          for (const item of fresh) {
            const alreadyDownloaded = Boolean(this.db.assetBySourceUrl(item.sourceUrl))
            let downloadJobId: string | undefined
            if (subscription.autoDownload && !alreadyDownloaded) downloadItems.push(item)
            const notification = this.db.createNotification({
              id: randomUUID(),
              subscriptionId: subscription.id,
              mediaKey: mediaKey(item),
              title: item.title,
              sourceUrl: item.sourceUrl,
              thumbnail: item.thumbnail || undefined,
              downloadJobId,
            })
            created.push(notification)
          }
          if (downloadItems.length) {
            const jobs = await this.queue.start({
              items: downloadItems,
              options: {
                ...options.options,
                outputRoot: options.outputRoot,
                cookieSource,
              },
            })
            // Match notifications to newly queued jobs by source URL (newest first).
            const byUrl = new Map<string, string>()
            for (const job of [...jobs].reverse()) {
              if (!byUrl.has(job.item.sourceUrl) && downloadItems.some(item => item.sourceUrl === job.item.sourceUrl)) {
                byUrl.set(job.item.sourceUrl, job.id)
              }
            }
            for (const notification of created) {
              const jobId = byUrl.get(notification.sourceUrl)
              if (!jobId) continue
              this.db.setNotificationDownloadJob(notification.id, jobId)
            }
          }
          this.db.markSeen(subscription.id, fresh.map(mediaKey))
        }
        // Always refresh baseline for items still in the shallow window.
        this.db.markSeen(subscription.id, items.map(mediaKey))
        this.db.updateSubscription(subscription.id, {
          displayName: displayNameFromItems(items, subscription.sourceUrl) || subscription.displayName,
          lastPolledAt: new Date().toISOString(),
          lastError: undefined,
        })
      } catch (error) {
        this.db.updateSubscription(subscription.id, {
          lastPolledAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}
