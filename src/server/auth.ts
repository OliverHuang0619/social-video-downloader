import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { hash, verify, Algorithm } from '@node-rs/argon2'
import type { AppDatabase } from './db'

const COOKIE = 'svw_session'
const attempts = new Map<string, number[]>()

async function secret(name: string, fallback?: string) {
  const file = process.env[`${name}_FILE`]
  if (file) return (await readFile(file, 'utf8')).trim()
  return process.env[name] || fallback || ''
}
export class AuthService {
  private sessionSecret = ''
  constructor(private db: AppDatabase) {}
  async initialize() {
    this.sessionSecret = await secret('SESSION_SECRET', process.env.NODE_ENV === 'production' ? '' : 'development-session-secret-change-me')
    if (!this.sessionSecret) throw new Error('生产环境必须配置 SESSION_SECRET_FILE 或 SESSION_SECRET')
    const existing = this.db.sqlite.prepare('SELECT password_hash FROM admin WHERE id=1').get() as { password_hash: string } | undefined
    if (!existing) {
      const password = await secret('ADMIN_PASSWORD', process.env.NODE_ENV === 'production' ? '' : 'admin')
      if (!password) throw new Error('首次启动必须配置 ADMIN_PASSWORD_FILE 或 ADMIN_PASSWORD')
      const passwordHash = await hash(password, { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 })
      this.db.sqlite.prepare('INSERT INTO admin(id,password_hash) VALUES(1,?)').run(passwordHash)
    }
  }
  private sign(value: string) { return createHmac('sha256', this.sessionSecret).update(value).digest('hex') }
  private cookie(request: IncomingMessage) { return request.headers.cookie?.split(';').map(value => value.trim().split('=')).find(([key]) => key === COOKIE)?.[1] }
  session(request: IncomingMessage) {
    const token = this.cookie(request); if (!token) return undefined
    return this.db.sqlite.prepare("SELECT csrf_token,expires_at FROM sessions WHERE token_hash=? AND expires_at > datetime('now')").get(this.sign(token)) as { csrf_token: string; expires_at: string } | undefined
  }
  require(request: IncomingMessage, csrf = false) {
    const session = this.session(request)
    if (!session) throw Object.assign(new Error('请先登录'), { statusCode: 401 })
    const supplied = Array.isArray(request.headers['x-csrf-token']) ? request.headers['x-csrf-token'][0] : request.headers['x-csrf-token'] || ''
    if (csrf && (supplied.length !== session.csrf_token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrf_token)))) throw Object.assign(new Error('CSRF 校验失败'), { statusCode: 403 })
    return session
  }
  async login(password: string, ip: string, response: ServerResponse) {
    const now = Date.now(), recent = (attempts.get(ip) || []).filter(value => value > now - 10 * 60_000)
    if (recent.length >= 5) throw Object.assign(new Error('登录尝试过多，请稍后再试'), { statusCode: 429 })
    const row = this.db.sqlite.prepare('SELECT password_hash FROM admin WHERE id=1').get() as { password_hash: string }
    if (!await verify(row.password_hash, password)) { attempts.set(ip, [...recent, now]); throw Object.assign(new Error('密码错误'), { statusCode: 401 }) }
    attempts.delete(ip)
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url')
    const expires = new Date(now + 7 * 24 * 3600_000).toISOString()
    this.db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(this.sign(token), csrf, expires, new Date(now).toISOString())
    response.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${process.env.SVD_SECURE_COOKIE === 'true' ? '; Secure' : ''}`)
    return { authenticated: true, csrfToken: csrf }
  }
  logout(request: IncomingMessage, response: ServerResponse) { const token = this.cookie(request); if (token) this.db.sqlite.prepare('DELETE FROM sessions WHERE token_hash=?').run(this.sign(token)); response.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`) }
}
