import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppDatabase as DatabaseType } from '../src/server/db'
import type { AuthService as AuthType } from '../src/server/auth'
import type { LibraryService as LibraryType } from '../src/server/library'
import type { RemakeJob } from '../src/shared/types'

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

  it('为媒体文件计算 SHA-256，并返回文件元数据', async () => {
    const asset = db.assets().find(value => value.filename === 'lesson.mp4')!
    await expect(library.fileHash(asset.id)).resolves.toMatchObject({ algorithm: 'sha256', hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', size: 0 })
    await expect(library.metadata(asset.id)).resolves.toMatchObject({ size: 0, duration: undefined })
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
    db.createPublishBatch({ id: 'batch-active', dispatchMode: 'platform', status: 'queued', createdAt: now, updatedAt: now, jobs: [{ id: 'batch-active-001', batchId: 'batch-active', assetId: asset.id, title: 'Directions', topics: ['English'], aigc: true, waitForCovers: false, status: 'queued' }] })
    expect(db.deletePublishBatch('batch-active')).toBe(false)
    db.updatePublishJob('batch-active-001', 'published'); db.updatePublishBatch('batch-active', 'completed')
    expect(db.deletePublishBatch('batch-active')).toBe(true)
  })

  it('抖音发布已结束历史可批量清除，运行中批次保留', () => {
    const asset = db.assets()[0], now = new Date().toISOString()
    db.createPublishBatch({ id: 'batch-running', dispatchMode: 'local', status: 'running', createdAt: now, updatedAt: now, jobs: [{ id: 'batch-running-001', batchId: 'batch-running', assetId: asset.id, title: 'Running', topics: ['English'], aigc: true, waitForCovers: false, status: 'uploading' }] })
    db.createPublishBatch({ id: 'batch-done', dispatchMode: 'platform', status: 'failed', createdAt: now, updatedAt: now, jobs: [{ id: 'batch-done-001', batchId: 'batch-done', assetId: asset.id, title: 'Failed', topics: ['English'], aigc: true, waitForCovers: false, status: 'failed', error: '验证码' }] })
    expect(db.clearPublishHistory()).toBe(1)
    expect(db.publishBatches().some(batch => batch.id === 'batch-running')).toBe(true)
    expect(db.publishBatches().some(batch => batch.id === 'batch-done')).toBe(false)
  })

  it('媒体库可批量删除所选视频，但保护正在分析或发布的视频', async () => {
    const keep = path.join(downloads, 'delete-keep.mp4'), gone = path.join(downloads, 'delete-gone.mp4'), busyFile = path.join(downloads, 'delete-busy.mp4')
    for (const file of [keep, gone, busyFile]) writeFileSync(file, 'x')
    const [kept, removed, busy] = await Promise.all([library.registerFile(keep), library.registerFile(gone), library.registerFile(busyFile)])
    const now = new Date().toISOString()
    db.createAnalysis({ id: 'analysis-busy', status: 'analyzing', assetIds: [busy.id], progress: 50, message: '分析中', processedItems: 0, totalItems: 1, logs: [], createdAt: now, updatedAt: now }, path.join(config, 'analysis-busy'))
    db.createPublishBatch({ id: 'batch-deleted', dispatchMode: 'platform', status: 'completed', createdAt: now, updatedAt: now, jobs: [{ id: 'batch-deleted-001', batchId: 'batch-deleted', assetId: removed.id, title: 'Gone', topics: [], aigc: true, waitForCovers: false, status: 'published' }] })
    await expect(library.deleteAssets([removed.id, busy.id], true)).rejects.toThrow('正在分析或发布')
    expect(db.asset(removed.id)).toBeTruthy()
    const result = await library.deleteAssets([removed.id], true)
    expect(result).toEqual({ count: 1, deletedFiles: 1, failed: [] })
    expect(db.asset(removed.id)).toBeUndefined()
    expect(existsSync(gone)).toBe(false)
    expect(db.publishBatches().some(batch => batch.id === 'batch-deleted')).toBe(false)
    expect(await library.deleteAssets([kept.id], false)).toEqual({ count: 1, deletedFiles: 0, failed: [] })
    expect(existsSync(keep)).toBe(true)
    expect(db.asset(busy.id)).toBeTruthy()
    db.updateAnalysis('analysis-busy', { status: 'cancelled' })
  })

  it('Hypit 重新制作任务可持久化，运行中记录不能删除', () => {
    const now = new Date().toISOString(), asset = db.assets()[0]
    const job: RemakeJob = { id: 'remake-persisted', status: 'directing', assetIds: [asset.id], mode: 'editable', direction: '重新设计脚本、画面与声音，制作原创版本', progress: 30, message: '导演中', projectDir: path.join(config, 'hypit-projects/remake-persisted'), outputs: [], logs: [], createdAt: now, updatedAt: now }
    db.saveRemake(job)
    expect(db.remake(job.id)).toMatchObject({ mode: 'editable', assetIds: [asset.id], progress: 30 })
    expect(db.deleteRemake(job.id)).toBe(false)
    db.saveRemake({ ...job, status: 'completed', progress: 100, updatedAt: new Date().toISOString() })
    expect(db.deleteRemake(job.id)).toBe(true)
  })

  it('Hypit 已结束历史可批量清除，运行中记录保留', () => {
    const now = new Date().toISOString(), asset = db.assets()[0]
    const active: RemakeJob = { id: 'remake-active', status: 'building', assetIds: [asset.id], mode: 'render', direction: '高度还原翻拍', progress: 60, message: '生成中', projectDir: path.join(config, 'hypit-projects/remake-active'), outputs: [], logs: [], createdAt: now, updatedAt: now }
    const done: RemakeJob = { id: 'remake-done', status: 'failed', assetIds: [asset.id], mode: 'editable', direction: '高度还原翻拍', progress: 40, message: '失败', projectDir: path.join(config, 'hypit-projects/remake-done'), outputs: [], logs: [], error: '429', createdAt: now, updatedAt: now }
    db.saveRemake(active)
    db.saveRemake(done)
    expect(db.clearRemakeHistory()).toBe(1)
    expect(db.remake('remake-active')).toBeTruthy()
    expect(db.remake('remake-done')).toBeUndefined()
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
    expect(batch.jobs[0].waitForCovers).toBe(false)
    for (let index = 0; index < 50 && db.publishBatches().find(value => value.id === batch.id)?.status !== 'completed'; index += 1) await new Promise(resolve => setTimeout(resolve, 20))
    expect(db.publishBatches().find(value => value.id === batch.id)?.status).toBe('completed')
    expect(db.asset(asset.id)?.processingState).toBe('processed')
    expect(changes).toBeGreaterThan(1)

    const coverBatch = publisher.create([{ assetId: asset.id, title: 'Directions', topics: ['English'], waitForCovers: true }], 'platform')
    expect(coverBatch.jobs[0].waitForCovers).toBe(true)
    for (let index = 0; index < 50 && db.publishBatches().find(value => value.id === coverBatch.id)?.status !== 'completed'; index += 1) await new Promise(resolve => setTimeout(resolve, 20))
  })

  it('平台批量发布允许首条立即发布，其余任务使用排期', async () => {
    const skill = path.join(root, 'publisher-auto-schedule-skill'), scripts = path.join(skill, 'scripts')
    mkdirSync(scripts, { recursive: true })
    writeFileSync(path.join(scripts, 'douyin_publisher.mjs'), `import fs from 'node:fs'; const job=JSON.parse(fs.readFileSync(process.argv[3],'utf8')); process.stdout.write(JSON.stringify({event:job.publishAt?'scheduled':'published'})+'\\n')`)
    process.env.SVD_SKILL_DIR = skill
    process.env.SVD_PUBLISH_COOLDOWN_MS = '120'
    const file = path.join(downloads, 'auto-schedule.mp4'); writeFileSync(file, '')
    const asset = await library.registerFile(file)
    const { PublisherService } = await import('../src/server/publisher')
    const publisher = new PublisherService(db, () => undefined)
    await new Promise(resolve => setTimeout(resolve, 20))
    const secondAt = new Date(Date.now() + 2 * 3600_000 + 2 * 60_000).toISOString()
    const thirdAt = new Date(new Date(secondAt).getTime() + 3600_000).toISOString()
    const batch = publisher.create([
      { assetId: asset.id, title: 'Publish Now', topics: ['English'] },
      { assetId: asset.id, title: 'Publish Later', topics: ['English'], publishAt: secondAt },
      { assetId: asset.id, title: 'Publish Shortly After', topics: ['English'], publishAt: thirdAt },
    ], 'platform')
    expect(batch.dispatchMode).toBe('platform')
    expect(batch.jobs[0].publishAt).toBeUndefined()
    expect(batch.jobs[1].publishAt).toBe(secondAt)
    expect(batch.jobs[2].publishAt).toBe(thirdAt)
    expect(batch.jobs.every(job => job.executeAt === undefined)).toBe(true)
    expect(batch.jobs.every(job => job.submitAt !== undefined)).toBe(true)
    expect(new Date(batch.jobs[1].submitAt!).getTime()).toBeGreaterThan(Date.now())
    for (let index = 0; index < 80 && db.publishBatches().find(value => value.id === batch.id)?.status !== 'completed'; index += 1) await new Promise(resolve => setTimeout(resolve, 50))
    const persisted = db.publishBatches().find(value => value.id === batch.id)!
    expect(persisted.jobs.map(job => job.status)).toEqual(['published', 'scheduled', 'scheduled'])
    expect(persisted.jobs.every(job => job.submitAt !== undefined)).toBe(true)
  })

  it('发布脚本报告成功但连接未退出时仍继续后续任务', async () => {
    const skill = path.join(root, 'publisher-hanging-cdp-skill'), scripts = path.join(skill, 'scripts')
    mkdirSync(scripts, { recursive: true })
    writeFileSync(path.join(scripts, 'douyin_publisher.mjs'), `import fs from 'node:fs'; const job=JSON.parse(fs.readFileSync(process.argv[3],'utf8')); process.stdout.write(JSON.stringify({event:job.publishAt?'scheduled':'published'})+'\\n'); setInterval(()=>{},1000)`)
    process.env.SVD_SKILL_DIR = skill
    process.env.SVD_PUBLISH_COOLDOWN_MS = '0'
    process.env.SVD_PUBLISH_TERMINAL_GRACE_MS = '50'
    const file = path.join(downloads, 'hanging-cdp.mp4'); writeFileSync(file, '')
    const asset = await library.registerFile(file)
    const { PublisherService } = await import('../src/server/publisher')
    const publisher = new PublisherService(db, () => undefined)
    const publishAt = new Date(Date.now() + 2 * 3600_000 + 60_000).toISOString()
    const batch = publisher.create([
      { assetId: asset.id, title: 'First Publish', topics: ['English'] },
      { assetId: asset.id, title: 'Second Publish', topics: ['English'], publishAt },
    ], 'platform')
    for (let index = 0; index < 50 && db.publishBatches().find(value => value.id === batch.id)?.status !== 'completed'; index += 1) await new Promise(resolve => setTimeout(resolve, 20))
    const persisted = db.publishBatches().find(value => value.id === batch.id)!
    expect(persisted.status).toBe('completed')
    expect(persisted.jobs.map(job => job.status)).toEqual(['published', 'scheduled'])
    delete process.env.SVD_PUBLISH_TERMINAL_GRACE_MS
  })

  it('重试失败任务时刷新过近排期并恢复被连带中断的后续任务', async () => {
    const skill = path.join(root, 'publisher-retry-skill'), scripts = path.join(skill, 'scripts')
    mkdirSync(scripts, { recursive: true })
    writeFileSync(path.join(scripts, 'douyin_publisher.mjs'), `import fs from 'node:fs'; const job=JSON.parse(fs.readFileSync(process.argv[3],'utf8')); process.stdout.write(JSON.stringify({event:job.publishAt?'scheduled':'published'})+'\\n')`)
    process.env.SVD_SKILL_DIR = skill
    process.env.SVD_PUBLISH_COOLDOWN_MS = '0'
    const file = path.join(downloads, 'retry-schedule.mp4'); writeFileSync(file, '')
    const asset = await library.registerFile(file)
    const now = new Date().toISOString(), stalePublishAt = new Date(Date.now() + 60_000).toISOString()
    db.createPublishBatch({
      id: 'batch-retry-schedule', dispatchMode: 'platform', status: 'failed', createdAt: now, updatedAt: now,
      jobs: [
        { id: 'batch-retry-schedule-001', batchId: 'batch-retry-schedule', assetId: asset.id, title: 'Retry', topics: ['English'], publishAt: stalePublishAt, aigc: true, waitForCovers: false, status: 'failed', error: '排期过近' },
        { id: 'batch-retry-schedule-002', batchId: 'batch-retry-schedule', assetId: asset.id, title: 'Continue', topics: ['English'], publishAt: new Date(Date.now() + 4 * 3600_000).toISOString(), aigc: true, waitForCovers: false, status: 'interrupted', error: '前一任务需要人工处理，批次已停止' },
      ],
    })
    const { PublisherService } = await import('../src/server/publisher')
    const publisher = new PublisherService(db, () => undefined)
    publisher.retry('batch-retry-schedule-001')
    for (let index = 0; index < 50 && db.publishBatches().find(value => value.id === 'batch-retry-schedule')?.status !== 'completed'; index += 1) await new Promise(resolve => setTimeout(resolve, 20))
    const persisted = db.publishBatches().find(value => value.id === 'batch-retry-schedule')!
    expect(persisted.status).toBe('completed')
    expect(persisted.jobs.map(value => value.status)).toEqual(['scheduled', 'scheduled'])
    expect(new Date(persisted.jobs[0].publishAt!).getTime()).toBeGreaterThan(Date.now() + 2 * 3600_000)
  })

  it('可取消等待中的抖音发布批次', async () => {
    const file = path.join(downloads, 'cancel-waiting.mp4'); writeFileSync(file, '')
    const asset = await library.registerFile(file)
    process.env.SVD_PUBLISH_COOLDOWN_MS = '0'
    const { PublisherService } = await import('../src/server/publisher')
    const publisher = new PublisherService(db, () => undefined)
    await new Promise(resolve => setTimeout(resolve, 20))
    const firstAt = new Date(Date.now() + 3600_000).toISOString()
    const secondAt = new Date(Date.now() + 7200_000).toISOString()
    const batch = publisher.create([
      { assetId: asset.id, title: 'First Waiting', topics: ['English'], publishAt: firstAt },
      { assetId: asset.id, title: 'Second Waiting', topics: ['English'], publishAt: secondAt },
    ], 'local')
    expect(['queued', 'waiting_local']).toContain(db.publishBatches().find(value => value.id === batch.id)?.status)
    publisher.cancelBatch(batch.id)
    const cancelled = db.publishBatches().find(value => value.id === batch.id)!
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.jobs.every(job => job.status === 'cancelled')).toBe(true)
    expect(cancelled.jobs.every(job => job.error?.includes('取消'))).toBe(true)
  })

  it('启动时对账已发布历史与媒体处理状态', async () => {
    const asset = db.assets()[0], now = new Date().toISOString()
    db.setAssetState(asset.id, 'unprocessed')
    db.createPublishBatch({ id: 'batch-reconcile', dispatchMode: 'platform', status: 'interrupted', createdAt: now, updatedAt: now, jobs: [{ id: 'batch-reconcile-001', batchId: 'batch-reconcile', assetId: asset.id, title: 'Directions', topics: ['English'], aigc: true, waitForCovers: false, status: 'published' }] })
    const { AppDatabase } = await import('../src/server/db')
    const reopened = new AppDatabase()
    expect(reopened.asset(asset.id)?.processingState).toBe('processed')
    expect(reopened.publishBatches().find(value => value.id === 'batch-reconcile')?.status).toBe('completed')
  })

  it('启动时恢复仍有待提交任务的中断批次', async () => {
    const asset = db.assets()[0], now = new Date().toISOString()
    const submitAt = new Date(Date.now() + 60_000).toISOString()
    db.createPublishBatch({
      id: 'batch-resume-pending',
      dispatchMode: 'platform',
      status: 'interrupted',
      createdAt: now,
      updatedAt: now,
      jobs: [
        { id: 'batch-resume-pending-001', batchId: 'batch-resume-pending', assetId: asset.id, title: 'Done', topics: ['English'], aigc: true, waitForCovers: false, status: 'published' },
        { id: 'batch-resume-pending-002', batchId: 'batch-resume-pending', assetId: asset.id, title: 'Pending', topics: ['English'], submitAt, aigc: true, waitForCovers: false, status: 'queued' },
      ],
    })
    const { AppDatabase } = await import('../src/server/db')
    const reopened = new AppDatabase()
    expect(reopened.publishBatches().find(value => value.id === 'batch-resume-pending')?.status).toBe('queued')
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
