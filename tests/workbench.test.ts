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
    expect(db.analysisOutputDir('analysis-progress')).toBe(path.join(config, 'analysis-progress'))
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

  it('抖音发布成功时立即把媒体标记为已处理', async () => {
    const skill = path.join(root, 'publisher-skill'), scripts = path.join(skill, 'scripts')
    mkdirSync(scripts, { recursive: true })
    writeFileSync(path.join(scripts, 'douyin_publisher.mjs'), `process.stdout.write(JSON.stringify({event:'published'})+'\\n')`)
    process.env.SVD_SKILL_DIR = skill
    process.env.SVD_PUBLISH_COOLDOWN_MS = '0'
    const { PublisherService } = await import('../src/server/publisher')
    const asset = db.assets()[0]
    db.setAssetState(asset.id, 'unprocessed')
    let changes = 0
    const publisher = new PublisherService(db, () => { changes += 1 })
    await new Promise(resolve => setTimeout(resolve, 20))
    const batch = publisher.create([{ assetId: asset.id, title: 'Directions', topics: ['English'] }], 'platform')
    for (let index = 0; index < 50 && db.publishBatches().find(value => value.id === batch.id)?.status !== 'completed'; index += 1) await new Promise(resolve => setTimeout(resolve, 20))
    expect(db.publishBatches().find(value => value.id === batch.id)?.status).toBe('completed')
    expect(db.asset(asset.id)?.processingState).toBe('processed')
    expect(changes).toBeGreaterThan(1)
  })

  it('启动时对账已发布历史与媒体处理状态', async () => {
    const asset = db.assets()[0], now = new Date().toISOString()
    db.setAssetState(asset.id, 'unprocessed')
    db.createPublishBatch({ id: 'batch-reconcile', dispatchMode: 'platform', status: 'interrupted', createdAt: now, updatedAt: now, jobs: [{ id: 'batch-reconcile-001', batchId: 'batch-reconcile', assetId: asset.id, title: 'Directions', topics: ['English'], aigc: true, status: 'published' }] })
    const { AppDatabase } = await import('../src/server/db')
    const reopened = new AppDatabase()
    expect(reopened.asset(asset.id)?.processingState).toBe('processed')
    expect(reopened.publishBatches().find(value => value.id === 'batch-reconcile')?.status).toBe('completed')
  })

  it('分析历史可单个删除或全部清除，但保留运行中任务', () => {
    const now = new Date().toISOString(), asset = db.assets()[0]
    const create = (id: string, status: 'queued' | 'completed' | 'failed') => db.createAnalysis({ id, status, assetIds: [asset.id], progress: status === 'completed' ? 100 : 0, message: id, processedItems: 0, totalItems: 1, logs: [], createdAt: now, updatedAt: now }, path.join(config, id))
    create('analysis-delete-one', 'completed')
    create('analysis-keep-active', 'queued')
    expect(db.deleteAnalysis('analysis-keep-active')).toBe(false)
    expect(db.deleteAnalysis('analysis-delete-one')).toBe(true)
    expect(db.analysis('analysis-delete-one')).toBeUndefined()
    create('analysis-clear-failed', 'failed')
    const terminalCount = db.analyses().filter(job => !['queued', 'preparing', 'analyzing'].includes(job.status)).length
    expect(db.clearAnalysisHistory()).toBe(terminalCount)
    expect(db.analysis('analysis-keep-active')).toBeTruthy()
    expect(db.analyses().every(job => ['queued', 'preparing', 'analyzing'].includes(job.status))).toBe(true)
  })
})
