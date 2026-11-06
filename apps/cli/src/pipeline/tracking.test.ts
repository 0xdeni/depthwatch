/**
 * The tracked set: `rankPools` never ranks a hooked pool, so it is tracked only when requested or
 * mandated; `mandatedPoolIds` keeps the mandates on known pools; `stockPoolIds` tracks a stock
 * pool whatever its rank from `STOCK_TRACK_MIN_RANK_USD` ($10,000) on, never below it, and never an
 * unranked one (docs/design/stocks.md §4).
 */
import { type Address, makeStock, type TokenInfo } from '@depthwatch/core'
import { fixtureMandate } from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../log.js'
import { HOOK, USDC, v4Pool, v4PoolAt, WETH } from '../testing/v4Pools.js'
import { computePrices, pricingFor } from './prices.js'
import {
  mandatedPoolIds,
  type RankedPool,
  rankPools,
  STOCK_TRACK_MIN_RANK_USD,
  selectTracked,
  stockPoolIds,
} from './tracking.js'

const LIQUIDITY = 10n ** 17n
const ROUTE = v4PoolAt(v4Pool('route', WETH, USDC), 2500, LIQUIDITY)
const PRICES = computePrices([ROUTE.view], { [USDC.address]: 1 })

describe('rankPools and selectTracked', () => {
  const plain = v4PoolAt(v4Pool('plain', WETH, USDC), 2500, LIQUIDITY)
  const hooked = v4PoolAt(v4Pool('hooked', WETH, USDC, HOOK), 2500, 100n * LIQUIDITY)

  it('ranks the deeper pool first when neither has a hook', () => {
    const unhooked = { ...hooked.view, pool: { ...hooked.view.pool, hooks: null } }
    const ranked = rankPools([plain.view, unhooked], PRICES)
    expect(ranked.map((r) => r.view.pool.id)).toEqual(['uniswap-v4:hooked', 'uniswap-v4:plain'])
  })

  it('never ranks a hooked pool: the modelled pool takes the slot', () => {
    const ranked = rankPools([hooked.view, plain.view], PRICES)
    expect(ranked.map((r) => [r.view.pool.id, r.rankUsd === null])).toEqual([
      ['uniswap-v4:plain', false],
      ['uniswap-v4:hooked', true],
    ])
    expect(ranked[0]?.rankUsd).toBeGreaterThan(0)
    expect(selectTracked(ranked, 1, [])).toEqual(['uniswap-v4:plain'])
    expect(selectTracked(ranked, 2, [])).toEqual(['uniswap-v4:plain'])
  })

  it('still tracks a hooked pool that is requested or mandated', () => {
    const ranked = rankPools([hooked.view, plain.view], PRICES)
    expect(selectTracked(ranked, 1, ['uniswap-v4:hooked'])).toEqual([
      'uniswap-v4:hooked',
      'uniswap-v4:plain',
    ])
  })

  it('refuses an explicit id the database does not know', () => {
    const ranked = rankPools([plain.view], PRICES)
    expect(() => selectTracked(ranked, 1, ['uniswap-v4:ghost'])).toThrow(
      'unknown pool id "uniswap-v4:ghost" (run discover first)',
    )
  })
})

describe('mandatedPoolIds', () => {
  it('keeps each known pool once and skips a mandate on an unknown pool with a warning', () => {
    const lines: string[] = []
    const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
    const mandates = [
      fixtureMandate({ id: 'a', poolId: 'uniswap-v4:plain' }),
      fixtureMandate({ id: 'b', poolId: 'uniswap-v4:ghost' }),
      fixtureMandate({ id: 'c', poolId: 'uniswap-v4:plain' }),
    ]
    expect(mandatedPoolIds(mandates, new Set(['uniswap-v4:plain']), log)).toEqual([
      'uniswap-v4:plain',
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('mandate pool not in the database; skipped (run discover)')
    expect(lines[0]).toContain('mandate=b pool=uniswap-v4:ghost')
  })
})

describe('stockPoolIds', () => {
  const STOCK = makeStock('NVDAc').token
  /** A pool of `token0`/`token1` ranked at `rankUsd` (null: unranked). */
  const ranked = (label: string, pair: [TokenInfo, TokenInfo], rankUsd: number | null) => {
    const { view } = v4PoolAt(v4Pool(label, ...pair), 1, LIQUIDITY)
    return { view, pricing: pricingFor(view), tvlUsd: null, rankUsd } satisfies RankedPool
  }
  const pools: RankedPool[] = [
    ranked('above', [USDC, STOCK], 2_000_000),
    ranked('at', [WETH, STOCK], STOCK_TRACK_MIN_RANK_USD),
    ranked('below', [USDC, STOCK], STOCK_TRACK_MIN_RANK_USD - 0.01),
    ranked('unranked', [WETH, STOCK], null),
    ranked('plain', [WETH, USDC], 5_000_000),
  ]

  it('is twice the side a rated pool needs: $10,000', () => {
    expect(STOCK_TRACK_MIN_RANK_USD).toBe(10_000)
  })

  it('takes the ranked stock pools from the floor on, whatever their place', () => {
    expect(stockPoolIds(pools, [STOCK.address])).toEqual(['uniswap-v4:above', 'uniswap-v4:at'])
    // Addresses in any case; no stock list, no stock pool.
    const upper = `0x${STOCK.address.slice(2).toUpperCase()}` as Address
    expect(stockPoolIds(pools, [upper])).toEqual(['uniswap-v4:above', 'uniswap-v4:at'])
    expect(stockPoolIds(pools, [])).toEqual([])
  })

  it('tracks them beside the top N, a smaller one only if it ranks in', () => {
    const order = [...pools].sort((a, b) => (b.rankUsd ?? -1) - (a.rankUsd ?? -1))
    const explicit = stockPoolIds(order, [STOCK.address])
    expect(selectTracked(order, 1, explicit)).toEqual([
      'uniswap-v4:above',
      'uniswap-v4:at',
      'uniswap-v4:plain',
    ])
    expect(selectTracked(order, 4, explicit)).toContain('uniswap-v4:below')
  })
})
