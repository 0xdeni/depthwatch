/**
 * Stale quotes (docs/METRICS.md, "Stale quotes"): a pool whose newest snapshot quotes a price 5 %
 * or more from its tokens' USD cross keeps its score, but its depth stays out of the per-DEX depth
 * sums and a depth sort puts it after the other pools in both directions. A pool unrated because
 * its stock's transfers are paused ("Stock tradability") leaves the same sums, and sorts in place.
 */
import { type PoolMeta, STALE_QUOTE_MIN_DEVIATION_BPS } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { fixturePool, fixturePoolReference, fixtureScore, fixtureSnapshot } from '../fixtures.js'

const ids = (rows: Array<{ pool: PoolMeta }>) => rows.map((row) => row.pool.id)

describe('stale quotes in the score queries', () => {
  let db: Database
  const DEEP = fixturePool({ id: 'uniswap-v3:0x00000000000000000000000000000000000000d1' })
  const STALE = fixturePool({ id: 'uniswap-v3:0x00000000000000000000000000000000000000d2' })
  const THIN = fixturePool({ id: 'uniswap-v3:0x00000000000000000000000000000000000000d3' })
  const OLD = fixturePool({ id: 'uniswap-v3:0x00000000000000000000000000000000000000d4' })

  beforeEach(() => {
    db = openDatabase(':memory:')
    db.tokens.upsertMany([DEEP.token0, DEEP.token1])
    db.pools.upsertMany([DEEP, STALE, THIN, OLD])
    db.pools.setTracked([DEEP.id, STALE.id, THIN.id, OLD.id], true)
    // The BRETT/USDC case of the live run: 17.962 USDC per BRETT at BRETT = $0.004652.
    const stale = { price: 17.962, token0Usd: 0.004652, token1Usd: 1 }
    db.snapshots.insertMany([
      fixtureSnapshot({ poolId: DEEP.id, depth2Usd: 1_000_000 }),
      // An older snapshot of the stale pool that was fine: only the newest one counts.
      fixtureSnapshot({
        poolId: STALE.id,
        blockNumber: 19_999_500n,
        timestamp: 1_699_999_000,
        depth2Usd: 40_000,
      }),
      fixtureSnapshot({ poolId: STALE.id, depth2Usd: 32_059, ...stale }),
      fixtureSnapshot({ poolId: THIN.id, depth2Usd: 2_000 }),
      // Stored before the deviation existed: unknown, so not stale.
      fixtureSnapshot({ poolId: OLD.id, depth2Usd: 5_000, ...stale, priceDeviationBps: null }),
    ])
    const scored = [
      [DEEP, 1_000_000],
      [STALE, 32_059],
      [THIN, 2_000],
      [OLD, 5_000],
    ] as const
    db.scores.upsertMany(
      scored.map(([pool, depth2Usd]) =>
        fixtureScore({ poolId: pool.id, depth2Usd, healthTotal: 50 }),
      ),
    )
  })
  afterEach(() => db.close())

  it('records the deviation of the newest snapshot on the summary', () => {
    const latest = db.scores.getRow(STALE.id)?.latest
    expect(latest?.priceDeviationBps).toBeGreaterThan(3.86e7)
    expect(latest?.priceDeviationBps).toBeGreaterThan(STALE_QUOTE_MIN_DEVIATION_BPS)
    expect(db.scores.getRow(DEEP.id)?.latest?.priceDeviationBps).toBeLessThan(1)
    expect(db.scores.getRow(OLD.id)?.latest?.priceDeviationBps).toBeNull()
  })

  it('leaves a stale quote out of the depth sum, not out of the counts', () => {
    const [row] = db.scores.statsByDex()
    expect(row).toMatchObject({ dex: 'uniswap-v3', scored: 4, rated: 4 })
    expect(row?.depth2UsdSum).toBe(1_000_000 + 2_000 + 5_000)
    // The pools that sum covers: every scored pool but the stale quote.
    expect(row?.depthKnownPools).toBe(3)
  })

  it('sorts a stale quote after the other pools on depth, in both directions', () => {
    expect(ids(db.scores.topBy('depth').items)).toEqual([DEEP.id, OLD.id, THIN.id, STALE.id])
    expect(ids(db.scores.topBy('depth', { dir: 'asc' }).items)).toEqual([
      THIN.id,
      OLD.id,
      DEEP.id,
      STALE.id,
    ])
    // Other sorts are unchanged: health ties are broken by pool id.
    expect(ids(db.scores.topBy('health').items)).toEqual([DEEP.id, STALE.id, THIN.id, OLD.id])
  })

  it("leaves a pool whose stock's transfers are paused out of the depth sums, as a stale quote", () => {
    const PAUSED = fixturePool({ id: 'uniswap-v3:0x00000000000000000000000000000000000000d5' })
    db.pools.upsertMany([PAUSED])
    const reference = fixturePoolReference({ transfersPaused: true })
    db.snapshots.insert(fixtureSnapshot({ poolId: PAUSED.id, depth2Usd: 80_000, reference }))
    const paused = { poolId: PAUSED.id, depth2Usd: 80_000, healthTotal: 50 }
    db.scores.upsert(fixtureScore({ ...paused, unratedReason: 'transfers-paused' }))

    const [row] = db.scores.statsByDex()
    expect(row).toMatchObject({ scored: 5, rated: 4, depth2UsdSum: 1_007_000, depthKnownPools: 3 })
    // A token's depth leaves it out too (every pool here is WETH / USDC).
    expect(db.scores.tokenDepth(DEEP.token0.address)).toEqual({
      depth2UsdTotal: 1_007_000,
      depthKnownPools: 3,
    })
    // Its quote is not stale: a depth sort keeps it in its place.
    expect(ids(db.scores.topBy('depth').items)).toEqual([
      DEEP.id,
      PAUSED.id,
      OLD.id,
      THIN.id,
      STALE.id,
    ])
    // Any other unrated reason stays in the sums.
    db.scores.upsert(fixtureScore({ ...paused, unratedReason: 'one-sided' }))
    expect(db.scores.statsByDex()[0]).toMatchObject({
      depth2UsdSum: 1_087_000,
      depthKnownPools: 4,
    })
    expect(db.scores.tokenDepth(DEEP.token1.address).depth2UsdTotal).toBe(1_087_000)
  })
})
