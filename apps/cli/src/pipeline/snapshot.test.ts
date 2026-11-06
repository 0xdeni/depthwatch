/**
 * `buildSnapshot` on one pool's state: a hooked Uniswap v4 pool keeps its price but gets no depth,
 * spread or concentration (docs/METRICS.md, `hooked`), and every snapshot records how far its
 * price is from its tokens' USD cross (`priceDeviationBps`, "Stale quotes"). The tracked set
 * (`rankPools`, `selectTracked`) is tested in tracking.test.ts, a stock pool's reference in
 * snapshot.stocks.test.ts.
 */
import type { PoolMeta } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { HOOK, USDC, v4Pool, v4PoolAt, WETH } from '../testing/v4Pools.js'
import { computePrices } from './prices.js'
import { buildSnapshot } from './snapshot.js'

const LIQUIDITY = 10n ** 17n
const wethUsdc = (hooks: PoolMeta['hooks']) => v4Pool('cd', WETH, USDC, hooks)

// WETH = $2,500 through a plain (unhooked) WETH/USDC pool.
const ROUTE = v4PoolAt(v4Pool('route', WETH, USDC), 2500, LIQUIDITY)
const PRICES = computePrices([ROUTE.view], { [USDC.address]: 1 })

describe('buildSnapshot', () => {
  it('measures a plain v4 pool and records a deviation of about 0 at the market price', () => {
    const { view, state } = v4PoolAt(wethUsdc(null), 2500, LIQUIDITY)
    const snapshot = buildSnapshot(view.pool, view, state, PRICES, null, 5)
    expect(snapshot.depth).toHaveLength(3)
    expect(snapshot.depthUsd.find((level) => level.pct === 2)?.upUsd).toBeGreaterThan(0)
    expect(snapshot.spreads.length).toBeGreaterThan(0)
    expect(snapshot.concentration).not.toBeNull()
    expect(snapshot.priceDeviationBps).toBeLessThan(1)
    expect(snapshot.reference).toBeNull()
  })

  it('stores a hooked v4 pool with its price and no depth, spread or concentration', () => {
    const { view, state } = v4PoolAt(wethUsdc(HOOK), 2500, LIQUIDITY)
    const snapshot = buildSnapshot(view.pool, view, state, PRICES, null, 5)
    expect(snapshot.price).toBeCloseTo(2500, 6)
    expect(snapshot.token0Usd).toBeCloseTo(2500, 6)
    expect(snapshot).toMatchObject({ depth: [], depthUsd: [], spreads: [], concentration: null })
    expect(snapshot.priceDeviationBps).toBeLessThan(1)
  })

  it('records the deviation of a pool quoting 10 % above the market', () => {
    const { view, state } = v4PoolAt(wethUsdc(null), 2750, LIQUIDITY)
    const snapshot = buildSnapshot(view.pool, view, state, PRICES, null, 5)
    expect(snapshot.priceDeviationBps).toBeGreaterThan(999)
    expect(snapshot.priceDeviationBps).toBeLessThan(1_001)
    const unpriced = buildSnapshot(view.pool, view, state, new Map(), null, 5)
    expect(unpriced.priceDeviationBps).toBeNull()
  })
})
