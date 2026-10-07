import { describe, expect, it } from 'vitest'
import { presignR2 } from '../cloudflare/r2-presign'

describe('R2 SigV4 presigned URLs', () => {
  it('signs direct object PUT/GET URLs with a bounded expiration and encoded object path', async () => {
    const credentials = { accountId: 'account123', accessKeyId: 'access-key', secretAccessKey: 'secret-key' }
    const now = new Date('2026-10-07T12:34:56.000Z')
    const key = 'instances/container-id/media/assets/video 1.mp4'
    const upload = new URL(await presignR2(credentials, 'PUT', key, now))
    const download = new URL(await presignR2(credentials, 'GET', key, now))

    expect(upload.host).toBe('account123.r2.cloudflarestorage.com')
    expect(upload.pathname).toBe('/svw-workbench-media/instances/container-id/media/assets/video%201.mp4')
    expect(upload.searchParams.get('X-Amz-Date')).toBe('20261007T123456Z')
    expect(upload.searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(upload.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(upload.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(upload.searchParams.get('X-Amz-Signature')).not.toBe(download.searchParams.get('X-Amz-Signature'))
  })
})
