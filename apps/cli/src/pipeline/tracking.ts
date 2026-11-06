/**
 * The snapshot step's tracked set: every known pool ranked by TVL from one overview pass, the top
 * N taken, and the pools tracked whatever their rank added (`--pool`, the pools of active
 * market-maker mandates, and the stock pools of `stockPoolIds`).
 *
 * Uniswap v4 pools hold no reserves of their own (singleton PoolManager), so their TVL is unknown
 * (null) and they are ranked by the USD value of their ±2 % depth instead. A Uniswap v4 pool with a
 * hook is not modelled (docs/METRICS.md, `hooked`): it is not ranked, so it is tracked only when
 * requested or mandated.
 *
 * Stock pools (docs/design/stocks.md §4): a ranked pool holding a stock with `rankUsd` at or above
 * `STOCK_TRACK_MIN_RANK_USD` is tracked whatever its rank, so every stock's pools that could be
 * rated are measured; a smaller one is tracked only if it ranks into the top N.
 */
import type { PoolOverview } from '@depthwatch/chain'
import {
  type Address,
  HEALTH_RATING_MIN_SIDE_USD,
  isHookedPool,
  type Mandate,
  tvlUsd,
} from '@depthwatch/core'
import type { Logger } from '../log.js'
import { depthUsdFor, type PoolPricing, type PriceMap, pricingFor, usdOf } from './prices.js'

export interface RankedPool {
  view: PoolOverview
  pricing: PoolPricing
  tvlUsd: number | null
  /**
   * TVL when known, else the USD value of the ±2 % depth (Uniswap v4). Null for a hooked Uniswap
   * v4 pool: its depth is not modelled, so it is never ranked into the tracked set.
   */
  rankUsd: number | null
}

/**
 * The rank from which a stock pool is tracked whatever its place: twice the thinner side a pool
 * needs to be rated (`HEALTH_RATING_MIN_SIDE_USD`), $10,000, so a pool that could be rated is
 * measured and the dust pools a factory returns are not (docs/design/stocks.md §4).
 */
export const STOCK_TRACK_MIN_RANK_USD = 2 * HEALTH_RATING_MIN_SIDE_USD

function reservesKnown(view: PoolOverview): boolean {
  return view.pool.dex !== 'uniswap-v4'
}

export function poolTvlUsd(view: PoolOverview, prices: PriceMap): number | null {
  if (!reservesKnown(view)) return null
  const { token0, token1 } = view.pool
  return tvlUsd(
    view.reserve0,
    view.reserve1,
    token0,
    token1,
    usdOf(prices, token0.address),
    usdOf(prices, token1.address),
  )
}

/** Pools ordered by rank (desc), unranked (unpriced or hooked) pools last, ties by id. */
export function rankPools(views: readonly PoolOverview[], prices: PriceMap): RankedPool[] {
  const ranked = views.map((view): RankedPool => {
    const pricing = pricingFor(view)
    const tvl = poolTvlUsd(view, prices)
    // A hooked pool's depth would be the swap walk's guess (docs/METRICS.md, `hooked`): no rank.
    const rankUsd = isHookedPool(view.pool) ? null : (tvl ?? depthUsdFor(pricing, prices))
    return { view, pricing, tvlUsd: tvl, rankUsd }
  })
  return ranked.sort((a, b) => {
    const x = a.rankUsd ?? -1
    const y = b.rankUsd ?? -1
    if (x !== y) return y - x
    return a.view.pool.id < b.view.pool.id ? -1 : 1
  })
}

/**
 * Top `topPools` ranked ids (with a positive rank) plus the explicitly requested ones (`--pool`,
 * mandated pools and stock pools), which are tracked whatever their rank, a hooked pool included.
 */
export function selectTracked(
  ranked: readonly RankedPool[],
  topPools: number,
  explicit: readonly string[],
): string[] {
  const known = new Set(ranked.map((r) => r.view.pool.id))
  for (const id of explicit) {
    if (!known.has(id)) throw new Error(`unknown pool id "${id}" (run discover first)`)
  }
  const selected = new Set<string>(explicit)
  let taken = 0
  for (const entry of ranked) {
    if (taken >= topPools) break
    if (entry.rankUsd === null || entry.rankUsd <= 0) break
    selected.add(entry.view.pool.id)
    taken++
  }
  return [...selected].sort()
}

/**
 * Pool ids of the active mandates, restricted to pools the database knows; a mandate on an
 * unknown pool (not discovered yet) is logged and skipped.
 */
export function mandatedPoolIds(
  mandates: readonly Mandate[],
  known: ReadonlySet<string>,
  log: Logger,
): string[] {
  const out: string[] = []
  for (const mandate of mandates) {
    if (!known.has(mandate.poolId)) {
      log.warn('mandate pool not in the database; skipped (run discover)', {
        mandate: mandate.id,
        pool: mandate.poolId,
      })
      continue
    }
    if (!out.includes(mandate.poolId)) out.push(mandate.poolId)
  }
  return out
}

/**
 * Ids of the ranked pools holding a stock (`stocks`: the stock list's token addresses, any case)
 * whose `rankUsd` is at least `STOCK_TRACK_MIN_RANK_USD`, sorted: tracked whatever their rank. An
 * unranked pool (hooked, or unpriced) is not among them, so only `--pool` tracks a hooked one.
 */
export function stockPoolIds(ranked: readonly RankedPool[], stocks: Iterable<Address>): string[] {
  const listed = new Set([...stocks].map((address) => address.toLowerCase()))
  const holdsStock = ({ token0, token1 }: PoolOverview['pool']) =>
    listed.has(token0.address.toLowerCase()) || listed.has(token1.address.toLowerCase())
  return ranked
    .filter(
      (entry) =>
        entry.rankUsd !== null &&
        entry.rankUsd >= STOCK_TRACK_MIN_RANK_USD &&
        holdsStock(entry.view.pool),
    )
    .map((entry) => entry.view.pool.id)
    .sort()
}
