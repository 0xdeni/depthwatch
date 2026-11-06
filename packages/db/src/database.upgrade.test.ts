/**
 * Opening a file written by an older build: every pending migration runs once, the rows stored
 * before it are kept, and the upgraded file holds the schema objects of a new database. A file
 * written by a newer build is refused.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jsonStringify, type OwnerConcentration } from '@depthwatch/core'
import { afterEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from './database.js'
import {
  fixtureMandate,
  fixtureMmAlert,
  fixtureMmSample,
  fixturePool,
  fixturePoolReference,
  fixtureSnapshot,
  fixtureToken,
} from './fixtures.js'
import { currentVersion, SCHEMA_VERSION } from './schema.js'

const NOW = 1_700_000_000

function names(db: Database, type: 'table' | 'index'): string[] {
  return db.raw
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all(type)
    .map((row) => String(row.name))
}

/** Undoes version 8 (the stock tables, `snapshots.reference_json`) as a version-7 build left it. */
const UNDO_V8 =
  'DROP TABLE stock_readings; DROP TABLE stocks; ALTER TABLE snapshots DROP COLUMN reference_json'

describe('openDatabase on a file of an older schema', () => {
  const open: Database[] = []
  const tempDirs: string[] = []
  afterEach(() => {
    for (const db of open.splice(0)) db.close()
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A new database: the schema objects an upgraded file must end up with. */
  function newDatabase(): Database {
    const db = openDatabase(':memory:', { now: () => NOW })
    open.push(db)
    return db
  }

  it('upgrades a version-1 database to the scorecard schema and keeps its rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'v1.sqlite')

    // Roll a fresh database back to version 1 (layer 1 tables only) the way a pre-layer-2
    // build would have left it, then reopen with the current build.
    const fresh = openDatabase(path, { now: () => NOW })
    fresh.tokens.upsertMany([fixtureToken()])
    fresh.raw.exec('DROP TABLE mm_alerts; DROP TABLE mm_samples; DROP TABLE mandates')
    fresh.raw.exec('DROP INDEX snapshots_pool_block')
    fresh.raw.exec('ALTER TABLE snapshots DROP COLUMN price_deviation_bps')
    fresh.raw.exec('ALTER TABLE snapshots DROP COLUMN fee_pips')
    fresh.raw.exec(UNDO_V8)
    fresh.raw.prepare('DELETE FROM schema_version WHERE version > 1').run()
    expect(currentVersion(fresh.raw)).toBe(1)
    expect(names(fresh, 'table')).not.toContain('mandates')
    fresh.close()

    const upgraded = openDatabase(path, { now: () => NOW + 5 })
    open.push(upgraded)
    expect(upgraded.migration).toEqual({ from: 1, to: SCHEMA_VERSION })
    expect(names(upgraded, 'table')).toEqual(names(newDatabase(), 'table'))
    expect(names(upgraded, 'index')).toEqual(names(newDatabase(), 'index'))
    expect(
      upgraded.raw.prepare('SELECT version, applied_at FROM schema_version ORDER BY version').all(),
    ).toEqual([
      { version: 1, applied_at: NOW },
      { version: 2, applied_at: NOW + 5 },
      { version: 3, applied_at: NOW + 5 },
      { version: 4, applied_at: NOW + 5 },
      { version: 5, applied_at: NOW + 5 },
      { version: 6, applied_at: NOW + 5 },
      { version: 7, applied_at: NOW + 5 },
      { version: 8, applied_at: NOW + 5 },
    ])
    expect(upgraded.tokens.get(fixtureToken().address)).toEqual(fixtureToken())
    upgraded.mandates.upsert(fixtureMandate())
    expect(upgraded.mandates.count()).toBe(1)
    upgraded.close()

    const again = openDatabase(path, { now: () => NOW + 9 })
    open.push(again)
    expect(again.migration).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
    expect(again.mandates.get(fixtureMandate().id)).toEqual(fixtureMandate())
  })

  it('upgrades a version-2 database to one row per block, keeping the first copy stored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'v2.sqlite')

    // Version 2 had no unique indexes, so a second writer's copies at the same block were stored.
    const v2 = openDatabase(path, { now: () => NOW })
    v2.raw.exec('DROP INDEX snapshots_pool_block; DROP INDEX mm_samples_mandate_block')
    v2.raw.prepare('DELETE FROM schema_version WHERE version > 2').run()
    v2.snapshots.insertMany([
      fixtureSnapshot({ blockNumber: 7n, timestamp: NOW, price: 1 }),
      fixtureSnapshot({ blockNumber: 7n, timestamp: NOW + 1, price: 2 }),
      fixtureSnapshot({ blockNumber: 8n, timestamp: NOW + 2, price: 3 }),
    ])
    v2.mmSamples.insertMany([
      fixtureMmSample({ blockNumber: 7n, timestamp: NOW }),
      fixtureMmSample({ blockNumber: 7n, timestamp: NOW + 1, withinKpi: false }),
      fixtureMmSample({ blockNumber: 8n, timestamp: NOW + 2 }),
    ])
    expect(v2.snapshots.count()).toBe(3)
    expect(v2.mmSamples.count()).toBe(3)
    v2.raw.exec('DROP INDEX mm_samples_timestamp; DROP INDEX mm_alerts_timestamp')
    v2.raw.exec('ALTER TABLE snapshots DROP COLUMN price_deviation_bps')
    v2.raw.exec('ALTER TABLE snapshots DROP COLUMN fee_pips')
    v2.raw.exec(UNDO_V8)
    v2.close()

    const upgraded = openDatabase(path, { now: () => NOW + 5 })
    open.push(upgraded)
    expect(upgraded.migration).toEqual({ from: 2, to: SCHEMA_VERSION })
    expect(names(upgraded, 'index')).toEqual(names(newDatabase(), 'index'))
    const pool = fixturePool().id
    expect(upgraded.snapshots.seriesForPool(pool, 0).map((s) => [s.blockNumber, s.price])).toEqual([
      [7n, 1],
      [8n, 3],
    ])
    const mandate = fixtureMmSample().mandateId
    expect(
      upgraded.mmSamples.seriesFor(mandate, 0).map((s) => [s.blockNumber, s.withinKpi]),
    ).toEqual([
      [7n, true],
      [8n, true],
    ])

    // From now on a copy at a stored block is skipped; insertMany counts the rows it stored.
    expect(upgraded.snapshots.insert(fixtureSnapshot({ blockNumber: 8n, price: 4 }))).toBeNull()
    expect(upgraded.mmSamples.insert(fixtureMmSample({ blockNumber: 8n }))).toBeNull()
    expect(
      upgraded.snapshots.insertMany([
        fixtureSnapshot({ blockNumber: 8n, timestamp: NOW + 3 }),
        fixtureSnapshot({ blockNumber: 9n, timestamp: NOW + 3 }),
      ]),
    ).toBe(1)
    expect(
      upgraded.mmSamples.insertMany([
        fixtureMmSample({ blockNumber: 8n, timestamp: NOW + 3 }),
        fixtureMmSample({ blockNumber: 9n, timestamp: NOW + 3 }),
      ]),
    ).toBe(1)
    expect(upgraded.snapshots.count()).toBe(3)
    expect(upgraded.mmSamples.count()).toBe(3)
    expect(upgraded.snapshots.latestForPool(pool)?.price).toBe(fixtureSnapshot().price)
  })

  it('upgrades a version-2 database with the timestamp indexes and keeps its rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'v2.sqlite')

    // A version-2 file: the scorecard tables without the timestamp indexes.
    const fresh = openDatabase(path, { now: () => NOW })
    fresh.mandates.upsert(fixtureMandate())
    fresh.mmSamples.insert(fixtureMmSample())
    fresh.mmAlerts.insert(fixtureMmAlert())
    fresh.raw.exec('DROP INDEX snapshots_pool_block; DROP INDEX mm_samples_mandate_block')
    fresh.raw.exec('DROP INDEX mm_samples_timestamp; DROP INDEX mm_alerts_timestamp')
    fresh.raw.exec('ALTER TABLE snapshots DROP COLUMN price_deviation_bps')
    fresh.raw.exec('ALTER TABLE snapshots DROP COLUMN fee_pips')
    fresh.raw.exec(UNDO_V8)
    fresh.raw.prepare('DELETE FROM schema_version WHERE version > 2').run()
    expect(currentVersion(fresh.raw)).toBe(2)
    fresh.close()

    const upgraded = openDatabase(path, { now: () => NOW + 7 })
    open.push(upgraded)
    expect(upgraded.migration).toEqual({ from: 2, to: SCHEMA_VERSION })
    expect(names(upgraded, 'index')).toEqual(names(newDatabase(), 'index'))
    expect(upgraded.mmSamples.latestFor(fixtureMandate().id)).toEqual(fixtureMmSample())
    expect(upgraded.mmAlerts.latestFor(fixtureMandate().id)).toEqual(fixtureMmAlert())
    // The retention deletes seek on the new indexes instead of scanning the tables.
    for (const table of ['mm_samples', 'mm_alerts']) {
      const plan = upgraded.raw
        .prepare(`EXPLAIN QUERY PLAN DELETE FROM ${table} WHERE timestamp < ?`)
        .all(NOW)
        .map((row) => String(row.detail))
        .join(' ')
      expect(plan).toContain(`SEARCH ${table} USING INDEX ${table}_timestamp`)
    }
  })

  it('upgrades a version-4 database: its snapshots read an unknown price deviation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'v4.sqlite')

    // A version-4 file: a snapshot stored before `price_deviation_bps` existed.
    const fresh = openDatabase(path, { now: () => NOW })
    const snapshot = fixtureSnapshot()
    fresh.raw.exec('ALTER TABLE snapshots DROP COLUMN price_deviation_bps')
    fresh.raw.exec('ALTER TABLE snapshots DROP COLUMN fee_pips')
    fresh.raw.exec(UNDO_V8)
    fresh.raw.prepare('DELETE FROM schema_version WHERE version > 4').run()
    fresh.raw
      .prepare(
        `INSERT INTO snapshots (pool_id, block_number, timestamp, price, token0_usd, token1_usd,
          tvl_usd, active_liquidity, depth_json, depth_usd_json, spreads_json, concentration_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.poolId,
        String(snapshot.blockNumber),
        snapshot.timestamp,
        snapshot.price,
        snapshot.token0Usd,
        snapshot.token1Usd,
        snapshot.tvlUsd,
        String(snapshot.activeLiquidity),
        jsonStringify(snapshot.depth),
        JSON.stringify(snapshot.depthUsd),
        JSON.stringify(snapshot.spreads),
        JSON.stringify(snapshot.concentration),
      )
    fresh.close()

    const upgraded = openDatabase(path, { now: () => NOW + 3 })
    open.push(upgraded)
    expect(upgraded.migration).toEqual({ from: 4, to: SCHEMA_VERSION })
    expect(snapshot.priceDeviationBps).toBe(0)
    expect(upgraded.snapshots.latestForPool(snapshot.poolId)).toEqual({
      ...snapshot,
      priceDeviationBps: null,
      feePips: null,
    })
    upgraded.snapshots.insert({
      ...snapshot,
      blockNumber: snapshot.blockNumber + 1n,
      timestamp: snapshot.timestamp + 1,
    })
    expect(upgraded.snapshots.latestForPool(snapshot.poolId)?.priceDeviationBps).toBe(0)
  })

  it('upgrades a version-5 database: owner shares that do not describe the pool are cleared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'v5.sqlite')

    const fresh = openDatabase(path, { now: () => NOW })
    const base = fixtureSnapshot({ ownerTop1Share: 0.4 })
    const at = (n: number, owners: OwnerConcentration | null) => ({
      ...base,
      blockNumber: base.blockNumber + BigInt(n),
      timestamp: base.timestamp + n,
      concentration: base.concentration && { ...base.concentration, owners },
    })
    const covering = base.concentration?.owners ?? null
    fresh.snapshots.insertMany([
      at(0, covering),
      // One unstaked LP beside a gauge holding 97 % of the band.
      at(1, { count: 1, top1Share: 1, top3Share: 1, hhi: 1, coverage: 0.0102 }),
      // Only the gauge's positions in the band.
      at(2, { count: 0, top1Share: 0, top3Share: 0, hhi: 0, coverage: 0 }),
      at(3, null),
    ])
    // As a version-5 build stored them: the share of the indexed owners, whatever their coverage.
    fresh.raw.exec(
      `UPDATE snapshots SET owner_top1_share = json_extract(concentration_json, '$.owners.top1Share')`,
    )
    fresh.raw.exec('ALTER TABLE snapshots DROP COLUMN fee_pips')
    fresh.raw.exec(UNDO_V8)
    fresh.raw.prepare('DELETE FROM schema_version WHERE version > 5').run()
    fresh.close()

    const upgraded = openDatabase(path, { now: () => NOW + 4 })
    open.push(upgraded)
    expect(upgraded.migration).toEqual({ from: 5, to: SCHEMA_VERSION })
    const stored = upgraded.raw
      .prepare('SELECT owner_top1_share AS top FROM snapshots ORDER BY timestamp')
      .all()
      .map((row) => row.top)
    expect(stored).toEqual([0.4, null, null, null])
  })

  it('upgrades a version-6 database: its snapshots read an unknown fee, new ones store theirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'v6.sqlite')

    // A version-6 file: Aerodrome pools only, a snapshot stored before `fee_pips` existed.
    const fresh = openDatabase(path, { now: () => NOW })
    const pool = fixturePool({ dex: 'aerodrome-slipstream', feePips: 400 })
    const snapshot = fixtureSnapshot({ poolId: pool.id, feePips: 400 })
    fresh.pools.upsertMany([pool])
    fresh.snapshots.insert(snapshot)
    fresh.raw.exec('ALTER TABLE snapshots DROP COLUMN fee_pips')
    fresh.raw.exec(UNDO_V8)
    fresh.raw.prepare('DELETE FROM schema_version WHERE version > 6').run()
    expect(currentVersion(fresh.raw)).toBe(6)
    fresh.close()

    const upgraded = openDatabase(path, { now: () => NOW + 6 })
    open.push(upgraded)
    expect(upgraded.migration).toEqual({ from: 6, to: SCHEMA_VERSION })
    expect(upgraded.pools.get(pool.id)).toEqual(pool)
    expect(upgraded.snapshots.latestForPool(pool.id)).toEqual({ ...snapshot, feePips: null })
    upgraded.snapshots.insert({
      ...snapshot,
      blockNumber: snapshot.blockNumber + 1n,
      timestamp: snapshot.timestamp + 1,
      feePips: 2055,
    })
    expect(upgraded.snapshots.latestForPool(pool.id)?.feePips).toBe(2055)
  })

  it('upgrades a version-7 database: its snapshots read no reference, the stock tables are new', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'v7.sqlite')

    // A version-7 file: a snapshot stored before `reference_json` and the stock tables existed.
    const fresh = openDatabase(path, { now: () => NOW })
    const snapshot = fixtureSnapshot()
    fresh.snapshots.insert(snapshot)
    fresh.raw.exec(UNDO_V8)
    fresh.raw.prepare('DELETE FROM schema_version WHERE version > 7').run()
    expect(currentVersion(fresh.raw)).toBe(7)
    expect(names(fresh, 'table')).not.toContain('stock_readings')
    fresh.close()

    const upgraded = openDatabase(path, { now: () => NOW + 7 })
    open.push(upgraded)
    expect(upgraded.migration).toEqual({ from: 7, to: SCHEMA_VERSION })
    expect(names(upgraded, 'table')).toEqual(names(newDatabase(), 'table'))
    expect(names(upgraded, 'index')).toEqual(names(newDatabase(), 'index'))
    expect(upgraded.snapshots.latestForPool(snapshot.poolId)).toEqual({
      ...snapshot,
      reference: null,
    })
    expect(upgraded.snapshots.latestReferences([snapshot.poolId])).toEqual(
      new Map([[snapshot.poolId, null]]),
    )
    expect([upgraded.stocks.count(), upgraded.stockReadings.count()]).toEqual([0, 0])
    const reference = fixturePoolReference()
    upgraded.snapshots.insert({
      ...snapshot,
      blockNumber: snapshot.blockNumber + 1n,
      timestamp: snapshot.timestamp + 1,
      reference,
    })
    expect(upgraded.snapshots.latestForPool(snapshot.poolId)?.reference).toEqual(reference)
  })

  it('refuses a database written by a newer schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'newer.sqlite')
    const db = openDatabase(path, { now: () => NOW })
    db.raw
      .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION + 1, NOW)
    db.close()
    expect(() => openDatabase(path)).toThrow(/newer than this build/)
  })
})
