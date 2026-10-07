import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../src/server/db'
import type { LibraryService as LibraryServiceType } from '../src/server/library'

const root = mkdtempSync(path.join(tmpdir(), 'svw-r2-library-'))
const originalFetch = globalThis.fetch
const objects = new Map<string, Uint8Array>()
process.env.SVD_CONFIG_DIR = path.join(root, 'config')
process.env.SVD_OUTPUT_DIR = path.join(root, 'downloads')
process.env.SVD_IMPORT_DIR = path.join(root, 'imports')
process.env.SVD_CF_BRIDGE_TOKEN = 'test-bridge-token'
process.env.SVD_CF_CONTAINER_ID = 'test-container'

let db: AppDatabaseType
let library: LibraryServiceType
beforeAll(async () => {
  mkdirSync(process.env.SVD_OUTPUT_DIR!, { recursive: true })
  mkdirSync(process.env.SVD_IMPORT_DIR!, { recursive: true })
  const [{ AppDatabase }, { LibraryService }] = await Promise.all([import('../src/server/db'), import('../src/server/library')])
  db = new AppDatabase()
  process.env.SVD_CLOUDFLARE_RUNTIME = '1'
  library = new LibraryService(db)
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/presign') {
      const value = JSON.parse(String(init?.body)) as { key: string }
      return Response.json({ url: `https://r2.test/instances/${process.env.SVD_CF_CONTAINER_ID}/${value.key}?signed=yes` })
    }
    const key = url.host === 'r2.test'
      ? decodeURIComponent(url.pathname.slice(1))
      : `instances/${process.env.SVD_CF_CONTAINER_ID}/${decodeURIComponent(url.pathname.slice(1))}`
    if (init?.method === 'PUT') {
      const body = new Response(init.body).arrayBuffer()
      objects.set(key, new Uint8Array(await body))
      return Response.json({ key })
    }
    if (init?.method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }) }
    const stored = objects.get(key)
    if (init?.method === 'HEAD') return stored ? new Response(null, { headers: { 'content-length': String(stored.byteLength) } }) : new Response(null, { status: 404 })
    return stored ? new Response(Buffer.from(stored)) : new Response('Not Found', { status: 404 })
  }) as typeof fetch
})
afterAll(() => {
  db?.sqlite.close()
  globalThis.fetch = originalFetch
  for (const file of [...objects.keys()]) objects.delete(file)
  rmSync(root, { recursive: true, force: true })
  void rm(path.join('/tmp', 'svw-media-cache'), { recursive: true, force: true })
})

describe('Cloudflare R2 media library', () => {
  it('stores registered media in R2, materializes it for tools, and keeps a durable object key in D1 records', async () => {
    const source = path.join(process.env.SVD_OUTPUT_DIR!, 'upload.mp4')
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 255])
    writeFileSync(source, bytes)

    const asset = await library.registerFile(source, { uploader: 'test' })
    expect(asset.file).toBe(`r2://media/assets/${asset.id}.mp4`)
    expect(objects.get(`instances/${process.env.SVD_CF_CONTAINER_ID}/${asset.file.slice(5)}`)).toEqual(bytes)
    const materialized = await library.resolvedFile(asset.id)
    expect(new Uint8Array(await readFile(materialized))).toEqual(bytes)
  })

  it('creates a scoped direct upload URL and registers only after R2 confirms the object', async () => {
    const ticket = await library.createUploadTicket('browser upload.mp4')
    expect(ticket.uploadUrl).toMatch(/^https:\/\/r2\.test\/instances\/test-container\/media\/assets\//)
    expect(db.asset(ticket.id)).toBeUndefined()
    const bytes = new Uint8Array([8, 7, 6, 5])
    await fetch(ticket.uploadUrl, { method: 'PUT', body: new Blob([bytes]) })

    const asset = await library.completeUpload(ticket.id)
    expect(asset.file).toBe(`r2://media/assets/${ticket.id}.mp4`)
    expect(objects.get(`instances/test-container/${asset.file.slice(5)}`)).toEqual(bytes)
    expect(db.mediaUploadTicket(ticket.id)).toBeUndefined()
  })
})
