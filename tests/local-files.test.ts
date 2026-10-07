import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNativeRunner, hostFileRef, LocalFileActions } from '../src/server/local-files'
import { createServer, resolveAllowed } from '../scripts/local-file-actions.mjs'

const root = mkdtempSync(path.join(tmpdir(), 'svw-local-files-'))
const downloads = path.join(root, 'downloads')
const imports = path.join(root, 'imports')
mkdirSync(downloads)
mkdirSync(imports)
const video = path.join(downloads, 'lesson.mp4')
writeFileSync(video, 'video')
writeFileSync(path.join(imports, 'clip.mov'), 'clip')
const outsideDir = path.join(root, 'outside')
mkdirSync(outsideDir)
writeFileSync(path.join(outsideDir, 'secret.mp4'), 'secret')
symlinkSync(outsideDir, path.join(downloads, 'escape'))

const roots = { downloads, imports }

describe('本地文件操作', () => {
  it('只把允许目录内的文件映射成宿主相对路径', async () => {
    await expect(hostFileRef(video, roots)).resolves.toEqual({ root: 'downloads', relative: 'lesson.mp4' })
    await expect(hostFileRef(path.join(imports, 'clip.mov'), roots)).resolves.toEqual({ root: 'imports', relative: 'clip.mov' })
    await expect(hostFileRef(path.join(outsideDir, 'secret.mp4'), roots)).rejects.toThrow('可打开的目录')
  })

  it('宿主助手拒绝越界路径', () => {
    expect(resolveAllowed('downloads', 'lesson.mp4', roots)).toBe(realpathSync(video))
    expect(() => resolveAllowed('downloads', '../outside/secret.mp4', roots)).toThrow('路径无效')
    expect(() => resolveAllowed('downloads', 'escape/secret.mp4', roots)).toThrow('路径越界')
    expect(() => resolveAllowed('other', 'lesson.mp4', roots)).toThrow('目录无效')
  })

  it('Mac 本机进程用访达显示文件，并把多个文件交给 AirDrop', async () => {
    const calls: Array<{ command: string; args: string[]; detach: boolean }> = []
    const runner = createNativeRunner('darwin', async (command, args, detach) => { calls.push({ command, args, detach }) }, async () => '/usr/local/bin/airdrop-share')
    const actions = new LocalFileActions({ mode: 'native', platform: 'darwin', roots, runner })
    await expect(actions.capabilities()).resolves.toEqual({ reveal: true, airdrop: true, upload: false })
    await actions.reveal([video])
    await actions.airdrop([video, path.join(imports, 'clip.mov')])
    expect(calls).toEqual([
      { command: 'open', args: ['-R', video], detach: false },
      { command: '/usr/local/bin/airdrop-share', args: [video, path.join(imports, 'clip.mov')], detach: true },
    ])
  })

  it('容器部署把相对路径交给本机助手，助手不可用时隐藏操作', async () => {
    const posted: unknown[] = []
    const host = {
      endpoint: 'http://host.docker.internal:9333',
      token: 'secret',
      fetch: async (url: URL | string, init?: RequestInit) => {
        const href = String(url)
        if (href.endsWith('/capabilities')) return new Response(JSON.stringify({ reveal: true, airdrop: true }), { status: 200 })
        posted.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ count: 1 }), { status: 202 })
      },
    }
    const actions = new LocalFileActions({ mode: 'host', platform: 'linux', roots, host: host as never })
    await actions.airdrop([video])
    expect(posted).toEqual([{ action: 'airdrop', files: [{ root: 'downloads', relative: 'lesson.mp4' }] }])
    expect(host.fetch).toBeTypeOf('function')
    const unavailable = new LocalFileActions({ mode: 'host', platform: 'linux', roots })
    await expect(unavailable.capabilities()).resolves.toEqual({ reveal: false, airdrop: false, upload: false })
    await expect(unavailable.reveal([video])).rejects.toThrow('不能打开文件所在目录')
  })

  it('文件助手拒绝未授权请求，并且不会打开越界文件', async () => {
    const server = createServer('secret', roots)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/capabilities`)
      expect(denied.status).toBe(401)
      const escaped = await fetch(`http://127.0.0.1:${port}/actions`, { method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reveal', files: [{ root: 'downloads', relative: 'escape/secret.mp4' }] }) })
      expect(escaped.status).toBe(500)
      await expect(escaped.json()).resolves.toMatchObject({ error: '路径越界' })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('非 Mac 不能 AirDrop', async () => {
    const actions = new LocalFileActions({ mode: 'native', platform: 'linux', roots, runner: createNativeRunner('linux', async () => undefined) })
    await expect(actions.capabilities()).resolves.toEqual({ reveal: true, airdrop: false, upload: false })
    await expect(actions.airdrop([video])).rejects.toThrow('不能使用 AirDrop')
  })
})
