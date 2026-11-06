/**
 * `score` over an in-memory database: scores follow the tracked set, so a pool that drops out of
 * it (top-N re-selection or a removed `--pool`) leaves `/api/pools`, `/api/gaps` and `/api/stats`
 * on the next run instead of being served with weeks-old numbers. A stock pool whose stock's
 * transfers are paused at its newest snapshot is unrated `transfers-paused`.
 */
import {
  createApp,
  type GapsResponse,
  type PoolsResponse,
  type StatsResponse,
} from '@depthwatch/api'
import { createChainReader, createFixture, createFixtureTransport } from '@depthwatch/chain'
import {
  type Database,
  fixtureAddress,
  fixtureBucket,
  fixturePool,
  fixturePoolReference,
  fixtureSnapshot,
  IN_MEMORY,
  openDatabase,
} from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createPipelineContext, DAY_SECONDS, type PipelineContext, syncKeys } from './context.js'
import { scorePool, scoreStep } from './score.js'

const NOW = 1_700_000_000
const HOUR = 3_600
const HOUR_START = NOW - (NOW % HOUR)
const A = fixturePool({ address: fixtureAddress(1) })
const B = fixturePool({ address: fixtureAddress(2) })
const PASS = 100n

/** What a `volume` pass at `headTs` records: its head and each pool's coverage from `fromTs`. */
function recordVolumePass(db: Database, poolIds: string[], headTs: number, fromTs: number): void {
  db.syncState.setBigInt(syncKeys.volume(), PASS)
  db.syncState.set(syncKeys.volumeHeadTs(), String(headTs))
  for (const id of poolIds) {
    db.syncState.setBigInt(syncKeys.volumeLastBlock(id), PASS)
    db.syncState.set(syncKeys.volumeFromTs(id), String(fromTs))
  }
}

async function json<T>(ctx: { db: Database }, path: string): Promise<T> {
  const app = createApp(ctx.db, { now: () => NOW })
  const response = await app.request(path)
  expect(response.status).toBe(200)
  return (await response.json()) as T
}

describe('scoreStep', () => {
  let db: Database
  let ctx: PipelineContext

  beforeEach(() => {
    db = openDatabase(IN_MEMORY, { now: () => NOW })
    const chain = createChainReader({ transport: createFixtureTransport(createFixture()) })
    ctx = createPipelineContext({ db, chain, config: loadConfig({}), now: () => NOW })
    db.pools.upsertMany([A, B])
    db.pools.setTracked([A.id, B.id], true)
    db.snapshots.insertMany([
      fixtureSnapshot({ poolId: A.id, timestamp: NOW, blockNumber: 1n }),
      fixtureSnapshot({ poolId: B.id, timestamp: NOW, blockNumber: 1n, depth2Usd: 5_000 }),
    ])
    db.volume.upsertBuckets([
      fixtureBucket({ poolId: A.id, hourStart: HOUR_START - HOUR, volumeUsd: 100_000 }),
      fixtureBucket({ poolId: B.id, hourStart: HOUR_START - HOUR, volumeUsd: 100_000 }),
    ])
    recordVolumePass(db, [A.id, B.id], NOW, HOUR_START - DAY_SECONDS)
  })

  afterEach(() => db.close())

  it('deletes the scores of pools that left the tracked set', async () => {
    const first = await scoreStep(ctx)
    expect(first).toMatchObject({ pools: 2, scored: 2, unsnapshotted: 0, gaps: 2, pruned: 0 })
    expect(db.scores.count()).toBe(2)
    expect((await json<PoolsResponse>(ctx, '/api/pools?limit=200')).total).toBe(2)

    // snapshot re-selected the top N without B (or B was dropped from --pool)
    db.pools.setTracked([B.id], false)
    const later = NOW + 3 * 7 * DAY_SECONDS
    const second = await scoreStep({ ...ctx, now: () => later })
    expect(second).toMatchObject({ pools: 1, scored: 1, pruned: 1 })
    expect(db.scores.count()).toBe(1)
    expect(db.scores.get(B.id)).toBeUndefined()
    expect(db.scores.get(A.id)?.timestamp).toBe(later)

    const pools = await json<PoolsResponse>(ctx, '/api/pools?limit=200')
    expect(pools.total).toBe(1)
    expect(pools.items.map((item) => item.pool.id)).toEqual([A.id])
    const gaps = await json<GapsResponse>(ctx, '/api/gaps')
    expect(gaps.items.map((item) => item.pool.pool.id)).not.toContain(B.id)
    const stats = await json<StatsResponse>(ctx, '/api/stats')
    expect(stats.totals).toMatchObject({ pools: 2, tracked: 1, scored: 1 })
  })

  it('prunes stale scores even when nothing is tracked any more', async () => {
    await scoreStep(ctx)
    db.pools.setTracked([A.id, B.id], false)
    const result = await scoreStep(ctx)
    expect(result).toMatchObject({ pools: 0, scored: 0, pruned: 2 })
    expect(db.scores.count()).toBe(0)
    expect((await json<PoolsResponse>(ctx, '/api/pools')).total).toBe(0)
  })

  describe('rating', () => {
    it('grades the pool with real depth and leaves the thin one without a letter', async () => {
      const result = await scoreStep(ctx)
      expect(result).toMatchObject({ scored: 2, rated: 1 })
      const a = db.scores.get(A.id)?.health
      const b = db.scores.get(B.id)?.health
      // A: $125,000 on each side; B: $2,500 on each side, under the $5,000 floor
      expect(a).toMatchObject({ rated: true, unratedReason: null })
      expect(a?.grade).not.toBeNull()
      expect(b).toMatchObject({ rated: false, unratedReason: 'thin', grade: null })
      expect(b?.total).toBeGreaterThan(0) // the numbers are kept
      const stats = await json<StatsResponse>(ctx, '/api/stats')
      expect(stats.totals).toMatchObject({ scored: 2, rated: 1, medianHealth: a?.total })
    })

    it('scores a one-sided pool unrated, whatever its deeper side holds', async () => {
      db.snapshots.insertMany([
        fixtureSnapshot({
          poolId: A.id,
          timestamp: NOW + 1,
          blockNumber: 2n,
          depthUsd: [
            { pct: 1, upUsd: 400_000, downUsd: 0, totalUsd: 400_000 },
            { pct: 2, upUsd: 1_000_000, downUsd: 0, totalUsd: 1_000_000 },
            { pct: 5, upUsd: 2_000_000, downUsd: 0, totalUsd: 2_000_000 },
          ],
        }),
      ])
      await scoreStep({ ...ctx, now: () => NOW + 1 })
      expect(db.scores.get(A.id)?.health).toMatchObject({
        rated: false,
        unratedReason: 'one-sided',
        grade: null,
      })
      expect(db.scores.get(A.id)?.health.components.depth).toBe(0)
    })

    it('scores a hooked Uniswap v4 pool unrated with reason hooked, its metrics null', async () => {
      const H = fixturePool({
        dex: 'uniswap-v4',
        address: null,
        poolId: `0x${'cd'.repeat(32)}`,
        hooks: fixtureAddress(0xc0),
      })
      db.pools.upsertMany([H])
      db.pools.setTracked([H.id], true)
      // What `snapshot` stores for a hooked pool: its price, no depth, spread or concentration.
      db.snapshots.insert(
        fixtureSnapshot({
          poolId: H.id,
          depth: [],
          depthUsd: [],
          spreads: [],
          concentration: null,
        }),
      )
      await scoreStep(ctx)
      expect(db.scores.get(H.id)?.health).toMatchObject({
        rated: false,
        unratedReason: 'hooked',
        grade: null,
      })
      expect(db.scores.get(A.id)?.health.rated).toBe(true)
      const pools = await json<PoolsResponse>(ctx, '/api/pools?rated=false&limit=200')
      const hooked = pools.items.find((item) => item.pool.id === H.id)
      expect(hooked).toMatchObject({ depth2Usd: null, depth2UpUsd: null, spread10kBps: null })
      expect(hooked?.health.unratedReason).toBe('hooked')
    })

    it('leaves 24 h persistence unknown while the snapshots cover under 6 h', async () => {
      // five snapshots over 51 minutes, as on the first live run
      db.snapshots.insertMany(
        [0, 332, 668, 2730, 3082].map((offset, i) =>
          fixtureSnapshot({
            poolId: A.id,
            timestamp: NOW - 3082 + offset,
            blockNumber: BigInt(10 + i),
          }),
        ),
      )
      await scoreStep(ctx)
      const score = db.scores.get(A.id)
      expect(score?.persistence24h).toMatchObject({ samples: 6, stability: null, uptime: null })
      expect(score?.health.components.persistence).toBe(10)
      expect(score?.health.notes).toContain(
        'persistence neutral: samples cover under 25 % of the window',
      )
    })
  })

  describe('24 h volume', () => {
    const volumeOf = async (now = NOW) => {
      await scoreStep({ ...ctx, now: () => now })
      return db.scores.get(A.id)?.volume24hUsd
    }

    it('sums exactly the 24 whole hours before the hour of the last volume read', async () => {
      db.volume.upsertBuckets([
        fixtureBucket({ poolId: A.id, hourStart: HOUR_START - DAY_SECONDS - HOUR, volumeUsd: 1e9 }),
        fixtureBucket({ poolId: A.id, hourStart: HOUR_START - DAY_SECONDS, volumeUsd: 20_000 }),
        fixtureBucket({ poolId: A.id, hourStart: HOUR_START, volumeUsd: 9_000 }), // still filling
      ])
      const result = await scoreStep(ctx)
      expect(result.volumeWindow).toEqual({ fromTs: HOUR_START - DAY_SECONDS, toTs: HOUR_START })
      expect(db.scores.get(A.id)?.volume24hUsd).toBe(120_000)
    })

    it('keeps the window when scoring runs after the volume pass, until the pass is a day old', async () => {
      expect(await volumeOf(NOW + 36 * 60)).toBe(100_000) // a snapshot ran in between
      expect(await volumeOf(NOW + 2 * HOUR)).toBe(100_000) // not cut to the clock's last 24 h
      expect(await volumeOf(NOW + DAY_SECONDS + 1)).toBeNull()
    })

    it('is null without coverage of the window and 0 for a covered pool that did not trade', async () => {
      recordVolumePass(db, [A.id], NOW, HOUR_START - DAY_SECONDS + HOUR) // e.g. --hours 23
      expect(await volumeOf()).toBeNull()
      db.syncState.setBigInt(syncKeys.volumeLastBlock(A.id), PASS - 1n) // not in the last pass
      db.syncState.set(syncKeys.volumeFromTs(A.id), String(HOUR_START - DAY_SECONDS))
      expect(await volumeOf()).toBeNull()
      recordVolumePass(db, [A.id], NOW + 2 * HOUR, HOUR_START - DAY_SECONDS)
      db.volume.pruneBefore(HOUR_START + 2 * HOUR)
      expect(await volumeOf(NOW + 2 * HOUR)).toBe(0)
    })

    it('is null for every pool before any volume pass', async () => {
      db.syncState.delete(syncKeys.volumeHeadTs())
      const result = await scoreStep(ctx)
      expect(result.volumeWindow).toBeNull()
      expect(db.scores.get(A.id)?.volume24hUsd).toBeNull()
    })
  })

  describe('concentration basis', () => {
    it('trusts owners covering the pool, falls back below 90 % and keeps a reserve pool neutral', async () => {
      const partial = fixturePool({ address: fixtureAddress(3) })
      const v2 = fixturePool({
        dex: 'aerodrome-v2',
        kind: 'constant-product',
        address: fixtureAddress(4),
        tickSpacing: null,
      })
      db.pools.upsertMany([partial, v2])
      db.pools.setTracked([partial.id, v2.id], true)
      const covered = fixtureSnapshot({ poolId: partial.id, timestamp: NOW, blockNumber: 1n })
      const concentration = covered.concentration
      if (!concentration?.owners) throw new Error('the fixture snapshot has owners')
      const halfOwners = { ...concentration.owners, coverage: 0.5 }
      db.snapshots.insertMany([
        { ...covered, concentration: { ...concentration, owners: halfOwners } },
        fixtureSnapshot({
          poolId: v2.id,
          timestamp: NOW,
          blockNumber: 1n,
          ownerTop1Share: null,
          concentration: { bandPct: 5, rangeHhi: 1, activeRangeShare: 1, owners: null },
        }),
      ])
      await scoreStep(ctx)
      // A: owners cover 95 % of the band → 20 × (1 − 0.4)
      expect(db.scores.get(A.id)?.health).toMatchObject({
        concentrationBasis: 'owners',
        components: { concentration: 12 },
      })
      // the same owners covering half the band: 20 × (1 − rangeHhi 0.25), with the reason
      const half = db.scores.get(partial.id)?.health
      expect(half).toMatchObject({
        concentrationBasis: 'ranges',
        components: { concentration: 15 },
      })
      expect(half?.notes).toContain('owner data covers 50 % of in-band liquidity')
      // an Aerodrome v2 pool: neutral 10, not 20 × (1 − 1) = 0
      const reserve = db.scores.get(v2.id)?.health
      expect(reserve).toMatchObject({
        concentrationBasis: 'neutral',
        components: { concentration: 10 },
      })
      expect(reserve?.notes).toContain('concentration neutral: LP owners not indexed')
    })
  })
})

describe('scorePool on a stock pool', () => {
  const pool = fixturePool({ address: fixtureAddress(5) })
  const at = (transfersPaused: boolean | null) =>
    fixtureSnapshot({
      poolId: pool.id,
      timestamp: NOW,
      blockNumber: 1n,
      reference: fixturePoolReference({ transfersPaused }),
    })

  it("unrates the pool while its stock's transfers are paused, and only then", () => {
    const paused = at(true)
    expect(scorePool(pool.id, pool, [paused], paused, null, NOW).health).toMatchObject({
      rated: false,
      unratedReason: 'transfers-paused',
      grade: null,
    })
    // Not paused, or unknown (a failed `pausedFeatures()`): unknown is not a pause.
    for (const transfersPaused of [false, null]) {
      const open = at(transfersPaused)
      expect(scorePool(pool.id, pool, [open], open, null, NOW).health.rated).toBe(true)
    }
  })
})
