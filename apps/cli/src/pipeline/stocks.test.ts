/**
 * A stock pool's reference and the pass depth from built Uniswap v4 pools, no chain: a stock S
 * (NVDAc, $200) in pools against USDC and WETH, where WETH has no route but through pools of S. A
 * deep S/USDC pool is set against the feed (+25.06 bps, docs/METRICS.md's example); a thin one
 * reads `thin`; an S/WETH pool whose quote is priced through an untracked S/WETH pool reads
 * `quote-unpriced` (every overview of the pass is an edge of the price graph); a hooked one
 * `hooked`; a pool without a stock has no reference. The pass depth sums the pass's pools of S
 * and takes the deepest one's deviation.
 */
import {
  type Address,
  evaluateStockReading,
  makeStock,
  type PoolMeta,
  type PoolSnapshot,
  type StockEntry,
  stockRawRead,
} from '@depthwatch/core'
import { snapshotDepthSides } from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { HOOK, USDC, v4Pool, v4PoolAt, WETH } from '../testing/v4Pools.js'
import { computePrices } from './prices.js'
import { buildSnapshot } from './snapshot.js'
import { stockPoolsOf, stockReadingRecords, withReference } from './stocks.js'

const T = 1_792_713_600
const S = makeStock('NVDAc')
const READING = evaluateStockReading(S, stockRawRead(S, 19_950_000_000n, T - 1_800), {
  blockNumber: 1n,
  timestamp: T,
})
const STOCKS = new Map<Address, StockEntry>([[S.token.address, { info: S, reading: READING }]])

// S at $200: 0.005 S per USDC, 12.5 S per WETH (WETH at $2,500, priced through S alone).
const deep = v4PoolAt(v4Pool('deep', USDC, S.token), 0.005, 7n * 10n ** 13n)
const route = v4PoolAt(v4Pool('route', WETH, S.token), 12.5, 7n * 10n ** 17n)
const viaWeth = v4PoolAt(v4Pool('via-weth', WETH, S.token), 12.5, 7n * 10n ** 16n)
const thin = v4PoolAt(v4Pool('thin', USDC, S.token), 0.005, 7n * 10n ** 10n)
const hooked = v4PoolAt(v4Pool('hooked', USDC, S.token, HOOK), 0.005, 7n * 10n ** 13n)
const plain = v4PoolAt(v4Pool('plain', WETH, USDC), 2_500, 10n ** 17n)
const VIEWS = [deep, route, viaWeth, thin, hooked, plain].map((p) => p.view)
const PRICES = computePrices(VIEWS, { [USDC.address]: 1 })
const INPUTS = { stocks: STOCKS, prices: PRICES, stockPools: stockPoolsOf(VIEWS, STOCKS) }

/** The pass's snapshot of `entry`, its reference set (`route` is not tracked: never snapshotted). */
function snapshotOf(entry: typeof deep): PoolSnapshot {
  const { view, state } = entry
  return withReference(buildSnapshot(view.pool, view, state, PRICES, null, 5), view.pool, INPUTS)
}

describe('withReference', () => {
  it('sets a deep stock pool against the live feed', () => {
    const snapshot = snapshotOf(deep)
    expect(snapshot.reference?.poolUsd).toBeCloseTo(200, 6)
    expect(snapshot.reference?.deviationBps).toBeCloseTo(25.06, 2)
    expect(snapshot.reference).toMatchObject({
      stock: S.token.address,
      referenceUsd: 199.5,
      referenceStatus: 'live',
      feedAgeSeconds: 1_800,
      toleranceBps: 50 + 500 / 100,
      deviationThresholdBps: 50,
      feeBps: 5,
      withinTolerance: true,
      deviationNull: null,
      transfersPaused: false,
    })
  })

  it('gives no deviation to a thin, a hooked or a quote-unpriced pool', () => {
    expect(snapshotDepthSides(snapshotOf(thin)).depth2UpUsd).toBeLessThan(5_000)
    expect(snapshotOf(thin).reference).toMatchObject({ deviationNull: 'thin', deviationBps: null })
    expect(snapshotOf(hooked).reference).toMatchObject({ deviationNull: 'hooked', poolUsd: null })
    // WETH's price runs through the untracked S/WETH pool: it would price S with S itself.
    expect(PRICES.get(WETH.address)?.via).toEqual(['uniswap-v4:deep', 'uniswap-v4:route'])
    const unpriced = snapshotOf(viaWeth)
    expect(Math.min(...Object.values(snapshotDepthSides(unpriced)).map(Number))).toBeGreaterThan(
      5_000,
    )
    expect(unpriced.reference).toMatchObject({
      poolUsd: null,
      referenceUsd: 199.5,
      deviationBps: null,
      deviationNull: 'quote-unpriced',
    })
  })

  it('leaves a pool without a stock without a reference', () => {
    expect(snapshotOf(plain).reference).toBeNull()
    expect([...(INPUTS.stockPools.get(S.token.address) ?? [])].sort()).toEqual([
      'uniswap-v4:deep',
      'uniswap-v4:hooked',
      'uniswap-v4:route',
      'uniswap-v4:thin',
      'uniswap-v4:via-weth',
    ])
  })
})

describe('stockReadingRecords', () => {
  const tracked = [deep, viaWeth, thin, hooked, plain]
  const pools = new Map<string, PoolMeta>(tracked.map((p) => [p.view.pool.id, p.view.pool]))

  it("sums the stock's pools of the pass and takes the deepest one's deviation", () => {
    const snapshots = tracked.map(snapshotOf)
    const [record] = stockReadingRecords([READING], snapshots, pools)
    const deepSnapshot = snapshots[0] as PoolSnapshot
    const sides = tracked.slice(0, 3).map((p) => snapshotDepthSides(snapshotOf(p)))
    // S is token1 everywhere: its buy side is the down level. The hooked pool has no sides.
    const sum = (key: 'depth2UpUsd' | 'depth2DownUsd') =>
      sides.reduce((total, s) => total + (s[key] ?? 0), 0)
    expect(record?.reading).toBe(READING)
    expect(record?.passDepth).toMatchObject({
      sidesKnownPools: 3,
      deepestPoolId: 'uniswap-v4:deep',
      deviationBps: deepSnapshot.reference?.deviationBps,
      withinTolerance: true,
      deviationNull: null,
    })
    expect(record?.passDepth?.depth2BuyUsd).toBeCloseTo(sum('depth2DownUsd'), 6)
    expect(record?.passDepth?.depth2SellUsd).toBeCloseTo(sum('depth2UpUsd'), 6)
  })

  it('stores the aggregate of no pool for a stock the pass did not snapshot', () => {
    const [record] = stockReadingRecords([READING], [snapshotOf(plain)], pools)
    expect(record?.passDepth).toMatchObject({
      sidesKnownPools: 0,
      deepestPoolId: null,
      deviationNull: 'no-pool',
    })
  })
})
