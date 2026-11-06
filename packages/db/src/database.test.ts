import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUSY_TIMEOUT_MS, type Database, openDatabase, retryWhileBusy } from './database.js'
import {
  fixtureMandate,
  fixtureMmAlert,
  fixtureMmSample,
  fixturePool,
  fixtureToken,
} from './fixtures.js'
import { currentVersion, MIGRATIONS, SCHEMA_VERSION } from './schema.js'

const NOW = 1_700_000_000

const EXPECTED_TABLES = [
  'mandates',
  'mm_alerts',
  'mm_samples',
  'pools',
  'positions',
  'prices',
  'schema_version',
  'scores',
  'snapshots',
  'stock_readings',
  'stocks',
  'sync_state',
  'tokens',
  'volume_hourly',
]

const EXPECTED_INDEXES = [
  'mandates_pool_id',
  'mm_alerts_mandate_timestamp',
  'mm_alerts_timestamp',
  'mm_samples_mandate_block',
  'mm_samples_mandate_timestamp',
  'mm_samples_timestamp',
  'pools_dex',
  'pools_token0',
  'pools_token1',
  'pools_tracked',
  'scores_depth2_usd',
  'scores_gap_score',
  'scores_health_total',
  'scores_volume_24h_usd',
  'snapshots_pool_block',
  'snapshots_pool_timestamp',
  'snapshots_timestamp',
  'stock_readings_timestamp',
  'stock_readings_token_timestamp',
  'volume_hourly_hour_start',
]

function names(db: Database, type: 'table' | 'index'): string[] {
  return db.raw
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all(type)
    .map((row) => String(row.name))
}

describe('openDatabase', () => {
  const open: Database[] = []
  const tempDirs: string[] = []
  afterEach(() => {
    for (const db of open.splice(0)) db.close()
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function memory(): Database {
    const db = openDatabase(':memory:', { now: () => NOW })
    open.push(db)
    return db
  }

  it('creates the schema and records every migration once', () => {
    const db = memory()
    expect(db.migration).toEqual({ from: 0, to: SCHEMA_VERSION })
    expect(MIGRATIONS.length).toBe(8)
    expect(SCHEMA_VERSION).toBe(8)
    expect(names(db, 'table')).toEqual(EXPECTED_TABLES)
    expect(names(db, 'index')).toEqual(EXPECTED_INDEXES)
    const versions = db.raw
      .prepare('SELECT version, applied_at FROM schema_version ORDER BY version')
      .all()
    expect(versions).toEqual(
      MIGRATIONS.map((_, index) => ({ version: index + 1, applied_at: NOW })),
    )
    expect(currentVersion(db.raw)).toBe(SCHEMA_VERSION)
    expect(db.path).toBe(':memory:')
    expect(db.isOpen).toBe(true)
  })

  it('is idempotent on reopen of a file database and uses WAL journaling', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'test.sqlite')

    const first = openDatabase(path, { now: () => NOW })
    expect(first.migration).toEqual({ from: 0, to: SCHEMA_VERSION })
    expect(first.raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    first.tokens.upsertMany([fixtureToken()])
    first.mandates.upsert(fixtureMandate())
    first.mmSamples.insert(fixtureMmSample())
    first.mmAlerts.insert(fixtureMmAlert())
    first.close()
    expect(first.isOpen).toBe(false)

    const second = openDatabase(path, { now: () => NOW + 1 })
    open.push(second)
    expect(second.migration).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
    expect(second.raw.prepare('SELECT COUNT(*) AS n FROM schema_version').get()).toEqual({
      n: SCHEMA_VERSION,
    })
    expect(names(second, 'table')).toEqual(EXPECTED_TABLES)
    expect(names(second, 'index')).toEqual(EXPECTED_INDEXES)
    expect(second.tokens.get(fixtureToken().address)).toEqual(fixtureToken())
    expect(second.pools.upsertMany([fixturePool()])).toBe(1)
    expect(second.mandates.get(fixtureMandate().id)).toEqual(fixtureMandate())
    expect(second.mmSamples.latestFor(fixtureMandate().id)).toEqual(fixtureMmSample())
    expect(second.mmAlerts.latestFor(fixtureMandate().id)).toEqual(fixtureMmAlert())
    expect(readdirSync(dir)).toContain('test.sqlite')
  })

  it('checkpoint folds the WAL into the file and empties it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'wal.sqlite')
    const db = openDatabase(path, { now: () => NOW })
    open.push(db)
    db.tokens.upsertMany([fixtureToken()])
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0)
    db.checkpoint()
    expect(statSync(`${path}-wal`).size).toBe(0)
    expect(db.tokens.get(fixtureToken().address)).toEqual(fixtureToken())
    expect(() => memory().checkpoint()).not.toThrow()
  })

  it('commits transactions, rolls back on throw and lets nested calls join', () => {
    const db = memory()
    const result = db.transaction(() => {
      db.syncState.set('a', '1')
      return db.transaction(() => {
        db.syncState.set('b', '2')
        expect(db.inTransaction).toBe(true)
        return 'nested'
      })
    })
    expect(result).toBe('nested')
    expect(db.inTransaction).toBe(false)
    expect(db.syncState.entries()).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])

    expect(() =>
      db.transaction(() => {
        db.syncState.set('c', '3')
        db.transaction(() => {
          db.syncState.set('d', '4')
        })
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(db.inTransaction).toBe(false)
    expect(db.syncState.get('c')).toBeUndefined()
    expect(db.syncState.get('d')).toBeUndefined()
  })

  it('gathers planner statistics on analyze() with a bounded sample per index', () => {
    const db = memory()
    expect(db.raw.prepare('PRAGMA analysis_limit').get()).toEqual({ analysis_limit: 1000 })
    db.pools.upsertMany([fixturePool()])
    const stats = () =>
      db.raw
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1'`)
        .all()
    expect(stats()).toEqual([])
    db.analyze()
    expect(stats()).toEqual([{ name: 'sqlite_stat1' }])
    const analysed = db.raw
      .prepare('SELECT DISTINCT tbl FROM sqlite_stat1 ORDER BY tbl')
      .all()
      .map((row) => String(row.tbl))
    expect(analysed).toContain('pools')
    expect(analysed).toContain('tokens')
  })

  it('stamps first_seen_at from the injected clock and closes idempotently', () => {
    const db = memory()
    db.pools.upsertMany([fixturePool()])
    expect(db.pools.getRecord(fixturePool().id)?.firstSeenAt).toBe(NOW)
    db.close()
    expect(() => db.close()).not.toThrow()
    expect(db.isOpen).toBe(false)
  })
})

describe('retryWhileBusy', () => {
  const busy = () => Object.assign(new Error('database is locked'), { errcode: 5 })

  function fakeClock() {
    let now = 0
    const sleeps: number[] = []
    return {
      sleeps,
      nowMs: () => now,
      sleep: (ms: number) => {
        sleeps.push(ms)
        now += ms
      },
    }
  }

  it('retries SQLITE_BUSY and SQLITE_LOCKED (extended codes too) with a growing wait', () => {
    const clock = fakeClock()
    const errors = [busy(), Object.assign(new Error('locked'), { errcode: 6 }), busy()]
    errors.push(Object.assign(new Error('busy recovery'), { errcode: 5 | (1 << 8) }))
    let calls = 0
    const value = retryWhileBusy(() => {
      const error = errors[calls++]
      if (error !== undefined) throw error
      return 'wal'
    }, clock)
    expect(value).toBe('wal')
    expect(calls).toBe(5)
    expect(clock.sleeps).toEqual([10, 20, 40, 80])
  })

  it('throws the last busy error once the timeout has passed', () => {
    const clock = fakeClock()
    let calls = 0
    expect(() =>
      retryWhileBusy(() => {
        calls++
        throw busy()
      }, clock),
    ).toThrow('database is locked')
    expect(clock.nowMs()).toBeGreaterThanOrEqual(BUSY_TIMEOUT_MS)
    expect(clock.nowMs()).toBeLessThan(BUSY_TIMEOUT_MS + 100)
    expect(calls).toBe(clock.sleeps.length + 1)
  })

  it('throws any other error at once', () => {
    const clock = fakeClock()
    const corrupt = Object.assign(new Error('file is not a database'), { errcode: 26 })
    expect(() =>
      retryWhileBusy(() => {
        throw corrupt
      }, clock),
    ).toThrow(corrupt)
    expect(() =>
      retryWhileBusy(() => {
        throw new Error('plain')
      }, clock),
    ).toThrow('plain')
    expect(clock.sleeps).toEqual([])
  })
})
