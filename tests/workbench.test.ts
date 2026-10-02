import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppDatabase as DatabaseType } from '../src/server/db'
import type { AuthService as AuthType } from '../src/server/auth'
import type { LibraryService as LibraryType } from '../src/server/library'

const root = mkdtempSync(path.join(tmpdir(), 'svw-test-'))
const config = path.join(root, 'config'), downloads = path.join(root, 'downloads'), imports = path.join(root, 'imports')
mkdirSync(config); mkdirSync(downloads); mkdirSync(imports)
process.env.SVD_CONFIG_DIR = config
process.env.SVD_OUTPUT_DIR = downloads
process.env.SVD_IMPORT_DIR = imports
process.env.ADMIN_PASSWORD = 'test-password'
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'
process.env.NODE_ENV = 'test'

let db: DatabaseType, auth: AuthType, library: LibraryType
beforeAll(async () => {
  const [{ AppDatabase }, { AuthService }, { LibraryService }] = await Promise.all([import('../src/server/db'), import('../src/server/auth'), import('../src/server/library')])
  db = new AppDatabase(); auth = new AuthService(db); await auth.initialize(); library = new LibraryService(db)
})

describe('工作台持久化与安全边界', () => {
  it('媒体库仅登记允许根目录内的视频并去重', async () => {
    const file = path.join(downloads, 'lesson.mp4'); writeFileSync(file, '')
    const first = await library.registerFile(file); const second = await library.registerFile(file)
    expect(second.id).toBe(first.id)
    expect(db.assets()).toHaveLength(1)
    const outside = path.join(root, 'outside.mp4'); writeFileSync(outside, '')
    await expect(library.registerFile(outside)).rejects.toThrow('允许范围')
  })

  it('分析结果与处理状态可持久更新', () => {
    const asset = db.assets()[0]
    db.setAnalysis(asset.id, { title: '问路表达', englishTitle: 'Asking for Directions', category: '日常交流', keyTopics: ['directions', 'places'], summary: '练习问路。', confidence: 'high', evidenceNote: '字幕 + 画面' })
    db.setAssetState(asset.id, 'processed')
    expect(db.asset(asset.id)).toMatchObject({ processingState: 'processed', analysis: { englishTitle: 'Asking for Directions' } })
  })

  it('分析任务持久保存逐步执行信息', () => {
    const now = new Date().toISOString(), asset = db.assets()[0]
    db.createAnalysis({ id: 'analysis-progress', status: 'preparing', assetIds: [asset.id], progress: 12, message: '正在准备', currentItem: asset.filename, processedItems: 0, totalItems: 1, logs: [{ at: now, stage: 'prepare', level: 'command', message: `正在准备：${asset.filename}` }], createdAt: now, updatedAt: now }, path.join(config, 'analysis-progress'))
    db.updateAnalysis('analysis-progress', { progress: 30, processedItems: 1, logs: [{ at: now, stage: 'prepare', level: 'result', message: '联系表已生成' }] })
    expect(db.analysis('analysis-progress')).toMatchObject({ progress: 30, processedItems: 1, totalItems: 1, logs: [{ message: '联系表已生成' }] })
  })

  it('管理员使用 Argon2id 登录且写请求需要 CSRF', async () => {
    const headers = new Map<string, string>()
    const response = { setHeader: (name: string, value: string) => headers.set(name, value) } as unknown as ServerResponse
    await expect(auth.login('wrong', 'test-ip', response)).rejects.toThrow('密码错误')
    const result = await auth.login('test-password', 'test-ip', response)
    const cookie = headers.get('set-cookie')!.split(';')[0]
    const request = { headers: { cookie } } as IncomingMessage
    expect(auth.session(request)?.csrf_token).toBe(result.csrfToken)
    expect(() => auth.require(request, true)).toThrow('CSRF')
    request.headers['x-csrf-token'] = result.csrfToken
    expect(auth.require(request, true)).toBeTruthy()
  })

  it('活动发布批次不能被删除', () => {
    const asset = db.assets()[0], now = new Date().toISOString()
    db.createPublishBatch({ id: 'batch-active', dispatchMode: 'platform', status: 'queued', createdAt: now, updatedAt: now, jobs: [{ id: 'batch-active-001', batchId: 'batch-active', assetId: asset.id, title: 'Directions', topics: ['English'], aigc: true, status: 'queued' }] })
    expect(db.deletePublishBatch('batch-active')).toBe(false)
    db.updatePublishJob('batch-active-001', 'published'); db.updatePublishBatch('batch-active', 'completed')
    expect(db.deletePublishBatch('batch-active')).toBe(true)
  })
})
