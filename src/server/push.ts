import { randomUUID } from 'node:crypto'
import webpush from 'web-push'
import type { PushDevice, PushSubscriptionInput, SubscriptionNotification } from '../shared/types'
import type { AppDatabase } from './db'

const META_PUBLIC = 'webpush_vapid_public'
const META_PRIVATE = 'webpush_vapid_private'
const { generateVAPIDKeys } = webpush

class PushDeviceStore {
  private cloud = process.env.SVD_CLOUDFLARE_RUNTIME === '1'
  private async query<T>(sql: string, values: unknown[] = [], mode: 'first' | 'all' | 'run' = 'all'): Promise<T> {
    const token = process.env.SVD_CF_BRIDGE_TOKEN
    if (!token) throw new Error('Cloudflare D1 连接密钥未配置')
    const response = await fetch('http://svw.d1.internal/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ sql, values, mode }),
    })
    const result = await response.json() as { result?: T; error?: string }
    if (!response.ok) throw new Error(result.error || `Cloudflare D1 请求失败 (${response.status})`)
    return result.result as T
  }
  async save(id: string, value: PushSubscriptionInput) {
    if (!this.cloud) return undefined
    const row = await this.query<{ id: string }>(`INSERT INTO push_devices(id,endpoint,p256dh,auth,label,created_at,last_sent_at)
      VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,label=excluded.label RETURNING id`,
    [id, value.endpoint, value.keys.p256dh, value.keys.auth, value.label?.slice(0, 100) || '此浏览器', new Date().toISOString()], 'first')
    return row.id
  }
  async devices(): Promise<PushDevice[]> {
    if (!this.cloud) return []
    return this.query<PushDevice[]>('SELECT id,label,created_at AS createdAt,last_sent_at AS lastSentAt FROM push_devices ORDER BY created_at DESC')
  }
  async subscriptions() {
    if (!this.cloud) return []
    return this.query<Array<{ id: string; endpoint: string; p256dh: string; auth: string; label: string }>>('SELECT id,endpoint,p256dh,auth,label FROM push_devices')
  }
  async remove(id: string) { if (this.cloud) { const result = await this.query<{ changes: number }>('DELETE FROM push_devices WHERE id=?', [id], 'run'); return result.changes > 0 }; return false }
  async removeEndpoint(endpoint: string) { if (this.cloud) { await this.query('DELETE FROM push_devices WHERE endpoint=?', [endpoint], 'run'); return }; }
  async touch(id: string) { if (this.cloud) await this.query('UPDATE push_devices SET last_sent_at=? WHERE id=?', [new Date().toISOString(), id], 'run') }
}

export function isExpiredPushEndpoint(error: unknown) {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode
  return statusCode === 404 || statusCode === 410
}

export class PushService {
  private deviceStore = new PushDeviceStore()
  constructor(private db: AppDatabase) {}

  initialize() {
    let publicKey = process.env.SVD_VAPID_PUBLIC_KEY
    let privateKey = process.env.SVD_VAPID_PRIVATE_KEY
    if (Boolean(publicKey) !== Boolean(privateKey)) throw new Error('SVD_VAPID_PUBLIC_KEY 与 SVD_VAPID_PRIVATE_KEY 必须同时配置')
    const externallyManaged = Boolean(publicKey && privateKey)
    publicKey ||= this.db.meta(META_PUBLIC)
    privateKey ||= this.db.meta(META_PRIVATE)
    if (!publicKey || !privateKey) {
      const keys = generateVAPIDKeys()
      publicKey = keys.publicKey
      privateKey = keys.privateKey
      if (!externallyManaged) {
        this.db.setMeta(META_PUBLIC, publicKey)
        this.db.setMeta(META_PRIVATE, privateKey)
      }
    }
    webpush.setVapidDetails(process.env.SVD_VAPID_SUBJECT || 'mailto:admin@example.com', publicKey, privateKey)
  }

  publicKey() {
    const value = process.env.SVD_VAPID_PUBLIC_KEY || this.db.meta(META_PUBLIC)
    if (!value) throw new Error('Web Push 尚未初始化')
    return value
  }

  async devices(): Promise<PushDevice[]> { return this.deviceStore.devices().then(values => process.env.SVD_CLOUDFLARE_RUNTIME === '1' ? values : this.db.pushDevices()) }

  async saveDevice(value: PushSubscriptionInput) {
    if (!value || typeof value.endpoint !== 'string' || !value.endpoint.startsWith('https://')) {
      throw Object.assign(new Error('Push endpoint 必须是 HTTPS 地址'), { statusCode: 400 })
    }
    if (!value.keys || typeof value.keys.p256dh !== 'string' || typeof value.keys.auth !== 'string' || !value.keys.p256dh || !value.keys.auth) {
      throw Object.assign(new Error('Push 订阅缺少加密密钥'), { statusCode: 400 })
    }
    const id = randomUUID()
    return await this.deviceStore.save(id, value) || this.db.savePushDevice(id, value).id
  }

  async removeDevice(id: string) { return process.env.SVD_CLOUDFLARE_RUNTIME === '1' ? this.deviceStore.remove(id) : this.db.removePushDevice(id) }

  async notifyNewSubscriptionVideo(notification: SubscriptionNotification) {
    const devices = process.env.SVD_CLOUDFLARE_RUNTIME === '1' ? await this.deviceStore.subscriptions() : this.db.pushDeviceSubscriptions()
    if (!devices.length) return
    const payload = JSON.stringify({
      title: notification.displayName || '订阅更新',
      body: notification.title,
      tag: notification.id,
      url: notification.sourceUrl,
    })
    await Promise.all(devices.map(async device => {
      try {
        await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, { TTL: 60 })
        if (process.env.SVD_CLOUDFLARE_RUNTIME === '1') await this.deviceStore.touch(device.id)
        else this.db.touchPushDevice(device.id)
      } catch (error) {
        if (isExpiredPushEndpoint(error)) {
          if (process.env.SVD_CLOUDFLARE_RUNTIME === '1') await this.deviceStore.removeEndpoint(device.endpoint)
          else this.db.removePushEndpoint(device.endpoint)
        }
        else console.warn(`Web Push delivery failed for device ${device.id}:`, error instanceof Error ? error.message : String(error))
      }
    }))
  }
}
