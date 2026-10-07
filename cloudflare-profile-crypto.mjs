import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const [mode, input, output] = process.argv.slice(2)
const encodedKey = process.env.SVD_DATA_ENCRYPTION_KEY || ''
if (!/^[0-9a-f]{64}$/i.test(encodedKey)) throw new Error('SVD_DATA_ENCRYPTION_KEY must be 32-byte hex')
const key = Buffer.from(encodedKey, 'hex')
const source = await readFile(input)

if (mode === 'encrypt') {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(source), cipher.final()])
  await writeFile(output, Buffer.concat([Buffer.from('SVW1'), iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600 })
} else if (mode === 'decrypt') {
  if (source.length < 32 || source.subarray(0, 4).toString() !== 'SVW1') throw new Error('Invalid encrypted browser profile')
  const decipher = createDecipheriv('aes-256-gcm', key, source.subarray(4, 16))
  decipher.setAuthTag(source.subarray(16, 32))
  await writeFile(output, Buffer.concat([decipher.update(source.subarray(32)), decipher.final()]), { mode: 0o600 })
} else {
  throw new Error('Usage: cloudflare-profile-crypto.mjs encrypt|decrypt input output')
}
