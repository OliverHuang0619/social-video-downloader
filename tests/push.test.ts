import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppDatabase as DatabaseType } from '../src/server/db'
import type { PushService as PushType } from '../src/server/push'

const root = mkdtempSync(path.join(tmpdir(), 'svw-push-test-'))
mkdirSync(root, { recursive: true })
process.env.SVD_CONFIG_DIR = root
process.env.NODE_ENV = 'test'

let db: DatabaseType, push: PushType
let PushConstructor: typeof import('../src/server/push').PushService
let expiredEndpoint: typeof import('../src/server/push').isExpiredPushEndpoint
beforeAll(async () => {
  const [{ AppDatabase }, { PushService, isExpiredPushEndpoint }] = await Promise.all([import('../src/server/db'), import('../src/server/push')])
  PushConstructor = PushService
  expiredEndpoint = isExpiredPushEndpoint
  db = new AppDatabase()
  push = new PushService(db)
  push.initialize()
})
afterAll(() => { db?.sqlite.close(); rmSync(root, { recursive: true, force: true }) })

describe('Web Push device persistence', () => {
  it('generates and persists one VAPID key pair per installation', () => {
    const publicKey = push.publicKey()
    const restarted = new PushConstructor(db)
    restarted.initialize()
    expect(restarted.publicKey()).toBe(publicKey)
    expect(publicKey.length).toBeGreaterThan(30)
  })

  it('stores device keys privately and only returns device metadata', async () => {
    const id = await push.saveDevice({ endpoint: 'https://push.example.test/endpoint/secret', keys: { p256dh: 'public-key', auth: 'auth-secret' }, label: 'Test Chrome' })
    const devices = await push.devices()
    expect(devices).toContainEqual(expect.objectContaining({ id, label: 'Test Chrome' }))
    expect(devices[0]).not.toHaveProperty('endpoint')
    expect(devices[0]).not.toHaveProperty('auth')
    expect(await push.removeDevice(id)).toBe(true)
    expect(await push.devices()).toEqual([])
  })

  it('rejects insecure or incomplete Push subscriptions', async () => {
    await expect(push.saveDevice({ endpoint: 'http://push.example.test', keys: { p256dh: 'p', auth: 'a' } })).rejects.toThrow('HTTPS')
    await expect(push.saveDevice({ endpoint: 'https://push.example.test', keys: { p256dh: '', auth: '' } })).rejects.toThrow('密钥')
  })

  it('recognizes expired push endpoints for automatic cleanup', () => {
    expect(expiredEndpoint({ statusCode: 404 })).toBe(true)
    expect(expiredEndpoint({ statusCode: 410 })).toBe(true)
    expect(expiredEndpoint({ statusCode: 503 })).toBe(false)
  })
})
