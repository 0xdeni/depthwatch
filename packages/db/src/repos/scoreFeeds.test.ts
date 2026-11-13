/**
 * The score feeds over the whole scored set: the spread and top-owner sorts (the values the rows
 * list, nulls last), the gaps feed's counts and a token's depth summed past any page, stale quotes
 * left out.
 */
import type { PoolMeta } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import {
  FIXTURE_AERO,
  FIXTURE_USDC,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
  fixtureScore,
  fixtureSnapshot,
} from '../fixtures.js'

const A = fixturePool({ address: fixtureAddress(1) }) // WETH/USDC
const B = fixturePool({ address: fixtureAddress(2), token0: FIXTURE_AERO }) // AERO/USDC
const C = fixturePool({ address: fixtureAddress(3), token1: FIXTURE_AERO }) // WETH/AERO
const D = fixturePool({ address: fixtureAddress(4) }) // WETH/USDC
const E = fixturePool({ address: fixtureAddress(5) }) // WETH/USDC, no snapshot

const ids = (rows: { pool: PoolMeta }[]) => rows.map((r) => r.pool.id)

describe('ScoresRepo feeds over the whole scored set', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
    db.pools.upsertMany([A, B, C, D, E])
    db.pools.setTracked([A.id, B.id, C.id, D.id, E.id], true)
    db.scores.upsertMany([
      // turnover 50×, 3× exactly, 2×, unknown depth (no gap), 0.5×
      fixtureScore({ poolId: A.id, gapScore: 85, volume24hUsd: 500_000, depth2Usd: 10_000 }),
      fixtureScore({ poolId: B.id, gapScore: 23.86, volume24hUsd: 60_000, depth2Usd: 20_000 }),
      fixtureScore({ poolId: C.id, gapScore: 15, volume24hUsd: 20_000, depth2Usd: 10_000 }),
      fixtureScore({ poolId: D.id, gapScore: null, volume24hUsd: 90_000, depth2Usd: null }),
      fixtureScore({ poolId: E.id, gapScore: 0, volume24hUsd: 5_000, depth2Usd: 10_000 }),
    ])
    db.snapshots.insertMany([
      fixtureSnapshot({ poolId: A.id, timestamp: 100, spread10kBps: 30, ownerTop1Share: 0.2 }),
      fixtureSnapshot({ poolId: B.id, timestamp: 100, spread10kBps: 5, ownerTop1Share: 0.9 }),
      fixtureSnapshot({ poolId: C.id, timestamp: 100, spread10kBps: null, ownerTop1Share: null }),
      fixtureSnapshot({ poolId: D.id, timestamp: 100, spread10kBps: 8, depth2Usd: 4_000 }),
    ])
  })
  afterEach(() => db.close())

  it('sorts by the $10k spread in both directions, nulls (no point, no snapshot) last', () => {
    expect(ids(db.scores.topBy('spread', { dir: 'asc' }).items)).toEqual([
      B.id,
      D.id,
      A.id,
      C.id,
      E.id,
    ])
    expect(ids(db.scores.topBy('spread').items)).toEqual([A.id, D.id, B.id, C.id, E.id])
    const page = db.scores.topBy('spread', { dir: 'asc', limit: 2, offset: 1 })
    expect(ids(page.items)).toEqual([D.id, A.id])
    expect(page.items.map((row) => row.latest?.spread10kBps)).toEqual([8, 30])
    expect(page.total).toBe(5)
  })

  it('orders a spread stored before the price impact cap as the null it reads as', () => {
    // The newest snapshot of A as written before the cap: 1.449e24 bps in the column and the point.
    const legacy = JSON.stringify([
      {
        notionalUsd: 10_000,
        spreadBps: 1.449e24,
        feasible: true,
        buyAvgPrice: 4.3e27,
        sellAvgPrice: 1.2e-21,
      },
    ])
    db.raw
      .prepare('UPDATE snapshots SET spreads_json = ?, spread10k_bps = ? WHERE pool_id = ?')
      .run(legacy, 1.449e24, A.id)
    const desc = db.scores.topBy('spread').items
    expect(ids(desc)).toEqual([D.id, B.id, A.id, C.id, E.id])
    expect(desc.map((row) => row.latest?.spread10kBps ?? null)).toEqual([8, 5, null, null, null])
  })

  it('sorts by the top owner share, nulls last, within the filters', () => {
    expect(ids(db.scores.topBy('top').items)).toEqual([B.id, D.id, A.id, C.id, E.id])
    expect(ids(db.scores.topBy('top', { dir: 'asc' }).items)).toEqual([
      A.id,
      D.id,
      B.id,
      C.id,
      E.id,
    ])
    const aero = db.scores.topBy('top', { token: FIXTURE_AERO.address })
    expect(ids(aero.items)).toEqual([B.id, C.id])
    expect(aero.total).toBe(2)
  })

  it('counts the whole gaps feed and its meaningful pools, whatever the page', () => {
    expect(ids(db.scores.gaps({ limit: 1 }))).toEqual([A.id])
    // A (50×) and B (exactly 3×) are meaningful; C (2×) is not; E is under the floor; D has no gap.
    expect(db.scores.gapCounts()).toEqual({ total: 3, meaningful: 2 })
    expect(db.scores.gapCounts(0)).toEqual({ total: 4, meaningful: 2 })
    expect(db.scores.gapCounts(100_000)).toEqual({ total: 1, meaningful: 1 })
    expect(db.scores.gapCounts(1_000_000)).toEqual({ total: 0, meaningful: 0 })
    expect(db.scores.gaps({ minVolumeUsd: 0, limit: 200 })).toHaveLength(4)
  })

  it("sums a token's depth over every scored pool with a known depth, past any page", () => {
    // WETH is in A, C, D (the snapshot's $4,000: its score has no depth) and E.
    expect(db.scores.topBy('depth', { token: FIXTURE_WETH.address, limit: 1 }).total).toBe(4)
    expect(db.scores.tokenDepth(FIXTURE_WETH.address)).toEqual({
      depth2UsdTotal: 34_000,
      depthKnownPools: 4,
    })
    // A pool counts in full for both of its tokens.
    expect(db.scores.tokenDepth(FIXTURE_AERO.address)).toEqual({
      depth2UsdTotal: 30_000,
      depthKnownPools: 2,
    })
    expect(db.scores.tokenDepth(FIXTURE_USDC.address).depthKnownPools).toBe(4)
    db.raw.exec(`UPDATE scores SET depth2_usd = NULL WHERE pool_id IN ('${B.id}', '${C.id}')`)
    db.raw.exec(`UPDATE snapshots SET depth2_usd = NULL WHERE pool_id IN ('${B.id}', '${C.id}')`)
    expect(db.scores.tokenDepth(FIXTURE_AERO.address)).toEqual({
      depth2UsdTotal: null,
      depthKnownPools: 0,
    })
    expect(db.scores.tokenDepth(fixtureAddress(0xbeef))).toEqual({
      depth2UsdTotal: null,
      depthKnownPools: 0,
    })
  })

  it("leaves a stale quote out of a token's depth, as the stats do", () => {
    // A ($10,000) quotes 6 % off its tokens' USD prices: stale from 5 %. A snapshot that predates
    // the measure (null) is not stale.
    db.snapshots.insert(
      fixtureSnapshot({ poolId: A.id, timestamp: 200, blockNumber: 2n, priceDeviationBps: 600 }),
    )
    db.snapshots.insert(
      fixtureSnapshot({
        poolId: D.id,
        timestamp: 200,
        blockNumber: 2n,
        depth2Usd: 4_000,
        priceDeviationBps: null,
      }),
    )
    expect(db.scores.tokenDepth(FIXTURE_WETH.address)).toEqual({
      depth2UsdTotal: 24_000,
      depthKnownPools: 3,
    })
    expect(db.scores.tokenDepth(FIXTURE_USDC.address).depthKnownPools).toBe(3)
    expect(db.scores.topBy('depth', { token: FIXTURE_WETH.address }).total).toBe(4)
  })
})

describe('ScoresRepo.gaps: equal gap scores', () => {
  let db: Database
  afterEach(() => db.close())

  it('orders a tie by turnover, highest first, then by pool id', () => {
    // Every pool trading 100× its depth or more scores 100: the feed's head must still lead with
    // the largest turnover (195×), not the smallest address (101×).
    const pools = [6, 7, 8, 9, 10].map((n) => fixturePool({ address: fixtureAddress(n) }))
    const [p6, p7, p8, p9, p10] = pools as [PoolMeta, PoolMeta, PoolMeta, PoolMeta, PoolMeta]
    db = openDatabase(':memory:')
    db.pools.upsertMany(pools)
    db.pools.setTracked(
      pools.map((p) => p.id),
      true,
    )
    db.scores.upsertMany([
      fixtureScore({ poolId: p6.id, gapScore: 100, volume24hUsd: 1_010_000, depth2Usd: 10_000 }),
      fixtureScore({ poolId: p7.id, gapScore: 100, volume24hUsd: 1_950_000, depth2Usd: 10_000 }),
      fixtureScore({ poolId: p8.id, gapScore: 100, volume24hUsd: 1_740_000, depth2Usd: 10_000 }),
      fixtureScore({ poolId: p9.id, gapScore: 99.9, volume24hUsd: 990_000, depth2Usd: 10_000 }),
      // The same turnover as p8: the pool id decides.
      fixtureScore({ poolId: p10.id, gapScore: 100, volume24hUsd: 3_480_000, depth2Usd: 20_000 }),
    ])
    const [first, second] = [p8.id, p10.id].sort()
    expect(ids(db.scores.gaps())).toEqual([p7.id, first, second, p6.id, p9.id])
    expect(ids(db.scores.gaps({ limit: 1 }))).toEqual([p7.id])
    expect(ids(db.scores.gaps({ limit: 2, offset: 3 }))).toEqual([p6.id, p9.id])
  })
})
