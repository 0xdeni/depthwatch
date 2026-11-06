/**
 * The Token page's words (ia-v3 §4.7, docs/design/visual-v4.md §6.8): the answer, the price route
 * and the Pools takeaway, plus the one view change the butterfly needs. Values are read as stored
 * and only formatted; the token's total depth is the API's `depth2UsdTotal`, summed over every
 * scored pool of the token but the stale quotes and the pools whose stock's transfers are paused,
 * so it holds whatever page of the pools is loaded and in any order.
 */
import type { PoolMetaDto, PoolSummary, TokenDetail } from '../../api/types.js'
import { countsInDepthSums } from '../../lib/depthSums.js'
import {
  count,
  dexLabel,
  isPoolId,
  NB,
  pairLabel,
  shareOf,
  tokenText,
  usd,
} from '../../lib/format.js'
import { swapSides } from '../../lib/orient.js'

/** The non-pool edge a route can cross, in words (ia-v3 §4.7). */
export const SOURCE_WORDS: Readonly<Record<string, string>> = {
  'wrap:weth': 'ETH to WETH',
}

/**
 * The pools as seen from `address`: a pool's sell side is token0 being sold, so where the token is
 * token1, selling it is the pool's buy side. The two stored sides swap places; nothing is
 * recomputed. The butterfly then reads "sell side, price down" as this token's price.
 */
export function orientPools(pools: readonly PoolSummary[], address: string): PoolSummary[] {
  const a = address.toLowerCase()
  return pools.map((p) =>
    p.pool.token1.address.toLowerCase() === a && p.pool.token0.address.toLowerCase() !== a
      ? swapSides(p)
      : p,
  )
}

/** The token's totals the answer and the takeaway read: the API's, over every scored pool. */
export type TokenTotals = Pick<TokenDetail, 'total' | 'depth2UsdTotal'>

/**
 * "$16.5M sits within 2 % of the price across WETH’s 2 scored pools." The pools named are the
 * ones the total sums (`depthKnownPools`: a known depth, no stale quote); when that leaves some of
 * the token's scored pools out, it says so: "across 2 of WETH’s 3 scored pools".
 */
export function tokenAnswer(detail: TokenDetail): string {
  const sym = tokenText(detail.token)
  const n = detail.total
  if (n === 0) return `${sym} has no scored pools yet.`
  if (detail.usd === null)
    return `${sym} has no USD price yet, so depth is shown in pool terms only.`
  if (detail.depth2UsdTotal === null) return `Depth around ${sym}’s price is not known yet.`
  const summed = detail.depthKnownPools
  let where: string
  if (summed === n)
    where = n === 1 ? `in ${sym}’s one scored pool` : `across ${sym}’s ${count(n)} scored pools`
  else
    where =
      summed === 1
        ? `in 1 of ${sym}’s ${count(n)} scored pools`
        : `across ${count(summed)} of ${sym}’s ${count(n)} scored pools`
  return `${usd(detail.depth2UsdTotal)} sits within 2${NB}% of the price ${where}.`
}

export interface RouteStep {
  source: string
  /** The pool's metadata when the observatory knows it. */
  pool?: PoolMetaDto
  /** Words for a non-pool edge ("ETH to WETH"), or the raw source when unknown. */
  words?: string
}

export function routeSteps(
  via: readonly string[],
  metas: ReadonlyMap<string, PoolMetaDto>,
): RouteStep[] {
  return via.map((source) => {
    if (isPoolId(source)) return { source, pool: metas.get(source) }
    return { source, words: SOURCE_WORDS[source] ?? source }
  })
}

/** One step in words: "WETH / USDC on Aerodrome Slipstream", "ETH to WETH". */
export function stepWords(step: RouteStep): string {
  if (step.pool)
    return `${pairLabel(step.pool.token0, step.pool.token1)} on ${dexLabel(step.pool.dex)}`
  if (step.words) return step.words
  return 'a pool not tracked here'
}

/**
 * The Pools takeaway: the deepest loaded pool's share of the token's depth, over the API's total
 * for all of the token's scored pools. A stale quote and a pool whose stock's transfers are paused
 * are not part of that total, so neither is ever the deepest pool here.
 */
export function poolsTakeaway(
  pools: readonly PoolSummary[],
  symbol: string,
  totals: TokenTotals,
): string {
  if (totals.depth2UsdTotal === null) return `No ${symbol} pool has a priced depth yet.`
  const known = pools.filter((p) => p.depth2Usd !== null && countsInDepthSums(p))
  const deepest = [...known].sort((a, b) => (b.depth2Usd ?? 0) - (a.depth2Usd ?? 0))[0]
  if (!deepest) return ''
  const pair = `${pairLabel(deepest.pool.token0, deepest.pool.token1)} on ${dexLabel(deepest.pool.dex)}`
  if (totals.total === 1) return `${pair} is ${symbol}’s only scored pool.`
  const total = totals.depth2UsdTotal
  return `${pair} holds ${shareOf(total > 0 ? (deepest.depth2Usd ?? 0) / total : null)} of ${symbol}’s depth.`
}
