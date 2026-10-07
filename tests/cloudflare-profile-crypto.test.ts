import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const script = path.resolve('cloudflare-profile-crypto.mjs')
describe('encrypted Cloudflare browser profile archive', () => {
  it('round-trips with AES-GCM and rejects a modified archive', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'svw-profile-crypto-'))
    const input = path.join(directory, 'profile.tar.gz'), encrypted = path.join(directory, 'profile.enc'), output = path.join(directory, 'restored.tar.gz')
    const key = Buffer.alloc(32, 17).toString('hex'), contents = Buffer.from('browser profile data')
    writeFileSync(input, contents)
    const run = (mode: string, source: string, target: string, encryptionKey = key) => spawnSync(process.execPath, [script, mode, source, target], { encoding: 'utf8', env: { ...process.env, SVD_DATA_ENCRYPTION_KEY: encryptionKey } })
    try {
      expect(run('encrypt', input, encrypted).status).toBe(0)
      expect(Buffer.from(await readFile(encrypted)).includes(contents)).toBe(false)
      expect(run('decrypt', encrypted, output).status).toBe(0)
      expect(await readFile(output)).toEqual(contents)
      const modified = Buffer.from(await readFile(encrypted)); modified[modified.length - 1] ^= 0xff; writeFileSync(encrypted, modified)
      expect(run('decrypt', encrypted, output).status).not.toBe(0)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
