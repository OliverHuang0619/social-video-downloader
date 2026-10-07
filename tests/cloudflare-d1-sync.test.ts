import { describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { CloudflareD1SyncDatabase } from '../src/server/cloudflare-d1-sync'

describe('Cloudflare D1 SQLite compatibility adapter', () => {
  it('maps first/all/run results to the existing synchronous statement API', () => {
    const query = vi.fn(({ mode }: { mode: string }) => mode === 'first'
      ? { result: { id: 'asset-1' } }
      : mode === 'all'
        ? { result: [{ id: 'asset-1' }] }
        : { result: { meta: { changes: 2, last_row_id: 8 } } })
    const db = new CloudflareD1SyncDatabase(query)

    expect(db.prepare('SELECT * FROM media_assets WHERE id=?').get('asset-1')).toEqual({ id: 'asset-1' })
    expect(db.prepare('SELECT * FROM media_assets').all()).toEqual([{ id: 'asset-1' }])
    expect(db.prepare('DELETE FROM media_assets WHERE id=?').run('asset-1')).toEqual({ changes: 2, lastInsertRowid: 8 })
    expect(query.mock.calls.map(([value]) => value.mode)).toEqual(['first', 'all', 'run'])
  })

  it('commits buffered statements atomically as one D1 batch and discards rollback', () => {
    const query = vi.fn((_input: unknown) => ({ result: [] }))
    const db = new CloudflareD1SyncDatabase(query)
    db.exec('BEGIN')
    db.prepare('INSERT INTO publish_batches(id) VALUES(?)').run('batch-1')
    db.prepare('INSERT INTO publish_jobs(id) VALUES(?)').run('job-1')
    expect(query).not.toHaveBeenCalled()
    db.exec('COMMIT')
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toMatchObject({ mode: 'batch', statements: [
      { sql: 'INSERT INTO publish_batches(id) VALUES(?)', values: ['batch-1'] },
      { sql: 'INSERT INTO publish_jobs(id) VALUES(?)', values: ['job-1'] },
    ] })

    db.exec('BEGIN')
    db.prepare('INSERT INTO publish_batches(id) VALUES(?)').run('rolled-back')
    db.exec('ROLLBACK')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('runs the same SQL against SQLite semantics, including foreign-key atomic batches', () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys=ON')
    const query = (input: { sql?: string; values?: unknown[]; mode: 'first' | 'all' | 'run' | 'batch'; statements?: Array<{ sql: string; values: unknown[] }> }) => {
      try {
        if (input.mode === 'batch') {
          sqlite.exec('BEGIN')
          try {
            const result = input.statements!.map(statement => {
              const run = sqlite.prepare(statement.sql).run(...statement.values as (string | number | null | bigint | Uint8Array)[])
              return { meta: { changes: run.changes, last_row_id: Number(run.lastInsertRowid) } }
            })
            sqlite.exec('COMMIT')
            return { result }
          } catch (error) { sqlite.exec('ROLLBACK'); throw error }
        }
        const statement = sqlite.prepare(input.sql!)
        if (input.mode === 'first') return { result: statement.get(...input.values as (string | number | null | bigint | Uint8Array)[]) }
        if (input.mode === 'all') return { result: statement.all(...input.values as (string | number | null | bigint | Uint8Array)[]) }
        const result = statement.run(...input.values as (string | number | null | bigint | Uint8Array)[])
        return { result: { changes: result.changes, lastRowId: Number(result.lastInsertRowid) } }
      } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    }
    const db = new CloudflareD1SyncDatabase(query)
    db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id));')
    db.exec('BEGIN')
    db.prepare('INSERT INTO parent(id) VALUES(?)').run('p1')
    db.prepare('INSERT INTO child(id,parent_id) VALUES(?,?)').run('c1', 'p1')
    db.exec('COMMIT')
    expect(db.prepare('SELECT parent_id FROM child WHERE id=?').get('c1')).toEqual({ parent_id: 'p1' })

    db.exec('BEGIN')
    db.prepare('INSERT INTO child(id,parent_id) VALUES(?,?)').run('bad', 'missing')
    expect(() => db.exec('COMMIT')).toThrow()
    expect(db.prepare('SELECT id FROM child').all()).toEqual([{ id: 'c1' }])
    sqlite.close()
  })
})
