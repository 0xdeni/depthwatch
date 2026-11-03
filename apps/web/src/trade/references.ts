/**
 * The reference pool of a swap: another pool of the same pair whose live price bounds this one's
 * (core's `live-deviation-above-max`). It is a guard only: never shown as a suggestion, and the
 * panel never names a better pool (one pool, the one the reader is viewing).
 */
import { TRADE_ROUTES } from '@depthwatch/chain/addresses'
import { type Address, isHookedPool } from '@depthwatch/core'
import type { PoolDetail, PoolSummary } from '../api/types.js'

/** Venues whose pools expose `slot0()` with `sqrtPriceX96` first. */
const SLOT0_VENUES = new Set<string>(TRADE_ROUTES.map((route) => route.venue))

/**
 * The deepest other rated, unhooked, fresh concentrated pool of the same two tokens on a venue
 * with `slot0()`, at most one; empty when there is none.
 */
export function referencePools(items: readonly PoolSummary[], detail: PoolDetail): Address[] {
  const { pool } = detail
  const candidates = items.filter(
    ({ pool: other, health, staleQuote }) =>
      other.id !== pool.id &&
      other.address !== null &&
      other.kind === 'concentrated' &&
      SLOT0_VENUES.has(other.dex) &&
      other.token0.address === pool.token0.address &&
      other.token1.address === pool.token1.address &&
      !isHookedPool(other) &&
      health.rated &&
      !staleQuote,
  )
  candidates.sort((a, b) => (b.depth2Usd ?? 0) - (a.depth2Usd ?? 0))
  const best = candidates[0]?.pool.address
  return best ? [best.toLowerCase() as Address] : []
}
