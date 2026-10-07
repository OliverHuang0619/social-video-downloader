export interface R2Credentials {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
}

function hex(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  return [...view].map(value => value.toString(16).padStart(2, '0')).join('')
}

function arrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', arrayBuffer(new TextEncoder().encode(value))))
}

async function hmac(key: Uint8Array, value: string) {
  const imported = await crypto.subtle.importKey('raw', arrayBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, arrayBuffer(new TextEncoder().encode(value))))
}

export async function presignR2(credentials: R2Credentials, method: 'GET' | 'PUT', key: string, now = new Date()) {
  const host = `${credentials.accountId}.r2.cloudflarestorage.com`
  const canonicalUri = `/${awsEncode('svw-workbench-media')}/${key.split('/').map(awsEncode).join('/')}`
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = date.slice(0, 8)
  const scope = `${day}/auto/s3/aws4_request`
  const values: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${credentials.accessKeyId}/${scope}`],
    ['X-Amz-Date', date],
    ['X-Amz-Expires', '3600'],
    ['X-Amz-SignedHeaders', 'host'],
  ]
  const canonicalQuery = values.map(([name, value]) => [awsEncode(name), awsEncode(value)] as const).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${name}=${value}`).join('&')
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`
  const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${await sha256(canonicalRequest)}`
  const dateKey = await hmac(new TextEncoder().encode(`AWS4${credentials.secretAccessKey}`), day)
  const regionKey = await hmac(dateKey, 'auto')
  const serviceKey = await hmac(regionKey, 's3')
  const signingKey = await hmac(serviceKey, 'aws4_request')
  const signature = hex(await hmac(signingKey, stringToSign))
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}
