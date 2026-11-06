/**
 * Retention over an in-memory database with rows on both sides of every cutoff: what goes, what
 * stays (the stock readings, whatever their age), the cursors of untracked pools, the coverage
 * start of tracked ones, the batches, the daily gate and the stop signal.
 */
import { createChainReader, createFixture, createFixtureTransport } from '@depthwatch/chain'
import { evaluateStockReading, makeStock, stockRawRead } from '@depthwatch/core'
import {
  type Database,
  fixtureAddress,
  fixtureBucket,
  fixtureMandate,
  fixtureMmAlert,
  fixtureMmSample,
  fixturePool,
  fixtureSnapshot,
  openDatabase,
} from '@depthwatch/db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createLogger } from '../log.js'
import { createPipelineContext, DAY_SECONDS, type PipelineContext, syncKeys } from './context.js'
import {
  MM_ALERTS_DAYS,
  MM_SAMPLES_DAYS,
  PRUNE_EVERY_SECONDS,
  pruneDue,
  pruneStep,
  SNAPSHOT_FLOOR_DAYS,
  volumeCursorPool,
} from './prune.js'
import { hourStartOf } from './volume.js'

const NOW = 1_800_000_000
const DAY = DAY_SECONDS
const TRACKED = fixturePool({ address: fixtureAddress(0xa) })
const UNTRACKED = fixturePool({ address: fixtureAddress(0xb) })

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

function context(signal?: AbortSignal): { db: Database; ctx: PipelineContext; lines: string[] } {
  const db = openDatabase(':memory:')
  dbs.push(db)
  const chain = createChainReader({ transport: createFixtureTransport(createFixture()) })
  const lines: string[] = []
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const ctx = createPipelineContext({
    db,
    chain,
    config: loadConfig({}),
    log,
    now: () => NOW,
    signal,
  })
  db.pools.upsertMany([TRACKED, UNTRACKED])
  db.pools.setTracked([TRACKED.id], true)
  return { db, ctx, lines }
}

/** A block number for a time: one snapshot or sample per pool (or mandate) and block. */
const blockAt = (ts: number) => BigInt(ts)

/** One snapshot per pool at each of `daysAgo`. */
function snapshotsAt(db: Database, daysAgo: readonly number[]): void {
  db.snapshots.insertMany(
    daysAgo.flatMap((days) =>
      [TRACKED, UNTRACKED].map((pool) =>
        fixtureSnapshot({
          poolId: pool.id,
          timestamp: NOW - days * DAY,
          blockNumber: blockAt(NOW - days * DAY),
        }),
      ),
    ),
  )
}

const snapshotDays = (db: Database, poolId: string) =>
  db.snapshots.seriesForPool(poolId, 0).map((s) => (NOW - s.timestamp) / DAY)

describe('pruneStep', () => {
  it('deletes past each window, keeps the rest, and tends the volume cursors', async () => {
    const { db, ctx } = context()
    const keepDays = 10
    snapshotsAt(db, [11, 9])
    db.volume.upsertBuckets(
      [11, 9].map((days) =>
        fixtureBucket({ poolId: TRACKED.id, hourStart: hourStartOf(NOW - days * DAY) }),
      ),
    )
    const mandate = fixtureMandate({ poolId: TRACKED.id })
    db.mandates.upsert(mandate)
    for (const days of [MM_SAMPLES_DAYS + 1, MM_SAMPLES_DAYS - 1])
      db.mmSamples.insert(
        fixtureMmSample({
          mandateId: mandate.id,
          timestamp: NOW - days * DAY,
          blockNumber: blockAt(NOW - days * DAY),
        }),
      )
    for (const days of [MM_ALERTS_DAYS + 1, MM_ALERTS_DAYS - 1])
      db.mmAlerts.insert(fixtureMmAlert({ mandateId: mandate.id, timestamp: NOW - days * DAY }))
    db.syncState.setBigInt(syncKeys.volumeLastBlock(TRACKED.id), 500n)
    db.syncState.set(syncKeys.volumeFromTs(TRACKED.id), String(NOW - 20 * DAY))
    db.syncState.setBigInt(syncKeys.volumeLastBlock(UNTRACKED.id), 400n)
    db.syncState.set(syncKeys.volumeFromTs(UNTRACKED.id), String(NOW - 20 * DAY))
    db.syncState.setBigInt(syncKeys.volume(), 500n)
    db.syncState.set(syncKeys.volumeHeadTs(), String(NOW))
    db.syncState.setBigInt(syncKeys.positions(UNTRACKED.id), 300n)

    const result = await pruneStep(ctx, { keepDays })
    expect(result).toEqual({
      keepDays,
      snapshots: 2,
      batches: 1,
      volume: 1,
      mmSamples: 1,
      mmAlerts: 1,
      cursors: 2,
      coverage: 1,
    })
    expect(snapshotDays(db, TRACKED.id)).toEqual([9])
    expect(snapshotDays(db, UNTRACKED.id)).toEqual([9])
    expect(db.volume.series(TRACKED.id, 0).map((b) => b.hourStart)).toEqual([
      hourStartOf(NOW - 9 * DAY),
    ])
    expect(db.mmSamples.countFor(mandate.id)).toBe(1)
    expect(db.mmAlerts.countFor(mandate.id)).toBe(1)
    // The tracked pool keeps its cursor and claims coverage from the cutoff on, not before.
    expect(db.syncState.getBigInt(syncKeys.volumeLastBlock(TRACKED.id))).toBe(500n)
    expect(db.syncState.get(syncKeys.volumeFromTs(TRACKED.id))).toBe(
      String(hourStartOf(NOW - keepDays * DAY)),
    )
    // The untracked pool's volume cursors are gone; its positions cursor and the pass-wide keys stay.
    expect(db.syncState.get(syncKeys.volumeLastBlock(UNTRACKED.id))).toBeUndefined()
    expect(db.syncState.get(syncKeys.volumeFromTs(UNTRACKED.id))).toBeUndefined()
    expect(db.syncState.getBigInt(syncKeys.positions(UNTRACKED.id))).toBe(300n)
    expect(db.syncState.getBigInt(syncKeys.volume())).toBe(500n)
    expect(db.syncState.get(syncKeys.volumeHeadTs())).toBe(String(NOW))
    expect(db.syncState.get(syncKeys.pruneLastRun())).toBe(String(NOW))
    // A second run a moment later finds nothing and leaves the coverage alone.
    expect(await pruneStep(ctx, { keepDays })).toMatchObject({ snapshots: 0, coverage: 0 })
  })

  it('keeps at least the floor of snapshots whatever --keep-days says', async () => {
    const { db, ctx } = context()
    snapshotsAt(db, [SNAPSHOT_FLOOR_DAYS + 1, SNAPSHOT_FLOOR_DAYS - 1])
    db.volume.upsertBuckets([
      fixtureBucket({ poolId: TRACKED.id, hourStart: hourStartOf(NOW - 3 * DAY) }),
      fixtureBucket({ poolId: TRACKED.id, hourStart: hourStartOf(NOW - DAY) }),
    ])
    const result = await pruneStep(ctx, { keepDays: 2 })
    expect(result).toMatchObject({ snapshots: 2, volume: 1 })
    expect(snapshotDays(db, TRACKED.id)).toEqual([SNAPSHOT_FLOOR_DAYS - 1])
    expect(db.volume.count()).toBe(1)
  })

  it('reads keepDays from the config and deletes snapshots in batches', async () => {
    const { db, ctx } = context()
    snapshotsAt(db, [40, 39, 38, 37, 36])
    const result = await pruneStep(
      { ...ctx, config: loadConfig({ DEPTHWATCH_KEEP_DAYS: '35' }) },
      {
        batch: 4,
      },
    )
    expect(result).toMatchObject({ keepDays: 35, snapshots: 10, batches: 3 })
    expect(db.snapshots.count()).toBe(0)
  })

  it('never prunes the stock readings or the stock list', async () => {
    const { db, ctx } = context()
    const stock = makeStock('NVDAc')
    db.stocks.replaceAll([stock], NOW - 400 * DAY)
    const ages = [400, 40, 1]
    db.stockReadings.insertMany(
      ages.map((days) => {
        const timestamp = NOW - days * DAY
        const raw = stockRawRead(stock, 19_950_000_000n, timestamp - 1_800)
        return {
          reading: evaluateStockReading(stock, raw, { blockNumber: blockAt(timestamp), timestamp }),
          passDepth: null,
        }
      }),
    )
    snapshotsAt(db, [40])
    const result = await pruneStep(ctx, { keepDays: 1 })
    expect(result.snapshots).toBe(2)
    expect(db.stockReadings.count()).toBe(ages.length)
    expect(
      db.stockReadings
        .seriesFor(stock.token.address, 0)
        .map((r) => (NOW - r.reading.timestamp) / DAY),
    ).toEqual(ages)
    expect(db.stocks.list().map((s) => s.ticker)).toEqual(['NVDA'])
  })

  it('stores nothing more once the stop signal has aborted', async () => {
    const controller = new AbortController()
    const { db, ctx } = context(controller.signal)
    snapshotsAt(db, [40, 39])
    controller.abort(new Error('stop'))
    await expect(pruneStep(ctx, { batch: 1 })).rejects.toThrow('stop')
    expect(db.snapshots.count()).toBe(4)
    expect(db.syncState.get(syncKeys.pruneLastRun())).toBeUndefined()
  })

  it('yields between batches, so a stop that arrives while it runs ends the loop', async () => {
    const controller = new AbortController()
    const { db, ctx } = context(controller.signal)
    snapshotsAt(db, [40, 39])
    // Queued before the prune starts: it can only run when the loop yields after its first batch.
    let ticks = 0
    setImmediate(() => {
      ticks++
      controller.abort(new Error('stop'))
    })
    await expect(pruneStep(ctx, { batch: 1 })).rejects.toThrow('stop')
    expect(ticks).toBe(1)
    expect(db.snapshots.count()).toBe(3)
    expect(db.syncState.get(syncKeys.pruneLastRun())).toBeUndefined()
  })
})

describe('pruneDue', () => {
  it('is due before any prune, then once a day', async () => {
    const { db, ctx } = context()
    expect(pruneDue(db, NOW)).toBe(true)
    await pruneStep(ctx)
    expect(pruneDue(db, NOW)).toBe(false)
    expect(pruneDue(db, NOW + PRUNE_EVERY_SECONDS - 1)).toBe(false)
    expect(pruneDue(db, NOW + PRUNE_EVERY_SECONDS)).toBe(true)
    db.syncState.set(syncKeys.pruneLastRun(), 'soon')
    expect(pruneDue(db, NOW)).toBe(true)
  })
})

describe('volumeCursorPool', () => {
  it('names the pool of a per-pool cursor and nothing for the pass-wide keys', () => {
    expect(volumeCursorPool('volume:uniswap-v3:0xab:lastBlock')).toBe('uniswap-v3:0xab')
    expect(volumeCursorPool('volume:uniswap-v4:0xcd:fromTs')).toBe('uniswap-v4:0xcd')
    expect(volumeCursorPool('volume:lastBlock')).toBeUndefined()
    expect(volumeCursorPool('volume:lastTs')).toBeUndefined()
    expect(volumeCursorPool('volume::lastBlock')).toBeUndefined()
    expect(volumeCursorPool('positions:uniswap-v3:0xab:lastBlock')).toBeUndefined()
  })
})
