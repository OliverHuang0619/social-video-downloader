import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

type StatementInput = { sql: string; values: unknown[] }
type D1Result = { results?: unknown[]; meta?: { changes?: number; last_row_id?: number } }
type QueryResponse = { result?: unknown; error?: string }
type Query = (input: { sql?: string; values?: unknown[]; mode: 'first' | 'all' | 'run' | 'batch'; statements?: StatementInput[] }) => QueryResponse

function splitSql(sql: string) {
  return sql.split(';').map(value => value.trim()).filter(Boolean)
}

/** Synchronous SQLite-shaped adapter for the existing Node service layer, backed by D1 over the Container outbound binding. */
export class CloudflareD1SyncDatabase {
  private transaction: StatementInput[] | undefined

  constructor(private query: Query = CloudflareD1SyncDatabase.request) {}

  private static request(input: Parameters<Query>[0]): QueryResponse {
    const token = process.env.SVD_CF_BRIDGE_TOKEN
    if (!token) throw new Error('Cloudflare D1 连接密钥未配置')
    const directory = mkdtempSync(path.join(tmpdir(), 'svw-d1-'))
    const payloadPath = path.join(directory, 'query.json')
    try {
      writeFileSync(payloadPath, JSON.stringify(input), { mode: 0o600 })
      const curlConfig = [
        'url = "http://svw.d1.internal/query"',
        'request = "POST"',
        'silent',
        'show-error',
        'fail-with-body',
        `header = "authorization: Bearer ${token}"`,
        'header = "content-type: application/json"',
        `data-binary = "@${payloadPath}"`,
        '',
      ].join('\n')
      const response = spawnSync('curl', ['--config', '-'], { input: curlConfig, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 })
      if (response.error) throw response.error
      if (response.status !== 0) throw new Error(`Cloudflare D1 请求失败: ${(response.stderr || response.stdout || `curl ${response.status}`).trim()}`)
      let result: QueryResponse
      try { result = JSON.parse(response.stdout) as QueryResponse }
      catch { throw new Error('Cloudflare D1 返回了无效响应') }
      if (result.error) throw new Error(result.error)
      return result
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }

  private execute(input: StatementInput, mode: 'first' | 'all' | 'run') {
    const response = this.query({ ...input, mode })
    if (response.error) throw new Error(response.error)
    return response.result as D1Result | unknown
  }

  exec(sql: string) {
    const normalized = sql.trim().toUpperCase()
    if (normalized === 'BEGIN' || normalized === 'BEGIN TRANSACTION') {
      if (this.transaction) throw new Error('Nested D1 transactions are not supported')
      this.transaction = []
      return
    }
    if (normalized === 'ROLLBACK' || normalized === 'ROLLBACK TRANSACTION') {
      this.transaction = undefined
      return
    }
    if (normalized === 'COMMIT' || normalized === 'COMMIT TRANSACTION') {
      const statements = this.transaction
      this.transaction = undefined
      if (statements?.length) {
        const response = this.query({ mode: 'batch', statements })
        if (response.error) throw new Error(response.error)
      }
      return
    }
    const statements = splitSql(sql).map(statement => ({ sql: statement, values: [] }))
    if (this.transaction) this.transaction.push(...statements)
    else if (statements.length === 1) this.execute(statements[0], 'run')
    else if (statements.length) {
      const response = this.query({ mode: 'batch', statements })
      if (response.error) throw new Error(response.error)
    }
  }

  prepare(sql: string) {
    const statement = (values: unknown[]): StatementInput => ({ sql, values })
    return {
      all: (...values: unknown[]) => {
        const input = statement(values)
        if (this.transaction) throw new Error('SELECT queries inside a D1 transaction are not supported')
        return this.execute(input, 'all') as unknown[]
      },
      get: (...values: unknown[]) => {
        const input = statement(values)
        if (this.transaction) throw new Error('SELECT queries inside a D1 transaction are not supported')
        return this.execute(input, 'first') ?? undefined
      },
      run: (...values: unknown[]) => {
        const input = statement(values)
        if (this.transaction) {
          this.transaction.push(input)
          return { changes: 0, lastInsertRowid: 0 }
        }
        const result = this.execute(input, 'run') as D1Result & { changes?: number; lastRowId?: number }
        return { changes: result.meta?.changes ?? result.changes ?? 0, lastInsertRowid: result.meta?.last_row_id ?? result.lastRowId ?? 0 }
      },
    }
  }

  batch(statements: StatementInput[]) {
    const response = this.query({ mode: 'batch', statements })
    if (response.error) throw new Error(response.error)
    return response.result as D1Result[]
  }

  close() { /* D1 connections are request scoped. */ }
}
