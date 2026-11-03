/**
 * Whether the pool page offers the swap at all, decided at load without any wallet code (the
 * panel itself is a lazy chunk, `trade/TradePanel.tsx`). It fails closed: the static bundle's
 * trade switch must be on for the pool's venue, which needs a route that is not on hold, and the
 * pool must be one the panel can check on chain: concentrated with an address, no hook, rated,
 * not a stale quote, both tokens on the allowlist. Demo, mock and connecting modes never show it,
 * and neither does the server build, which carries no switch.
 */
import { isTradeToken, TRADE_ROUTES, type TradeVenue } from '@depthwatch/chain/addresses'
import { isHookedPool, isStaleQuote, type TradeFlags, tradeOnFor } from '@depthwatch/core'
import type { PoolDetail } from '../../api/types.js'

export interface TradeGateEnv {
  mock: boolean
  demo?: boolean
  connecting?: boolean
  /** The static bundle's switch at load; null or undefined is off. */
  trade?: TradeFlags | null
}

/** The venue and the switch to trade this pool with, or null when the page shows no swap. */
export function tradeGate(
  detail: PoolDetail,
  env: TradeGateEnv,
): { venue: TradeVenue; flags: TradeFlags } | null {
  const flags = env.trade ?? null
  if (env.mock || env.demo || env.connecting || flags === null) return null
  const { pool, latest, score } = detail
  if (!tradeOnFor(flags, pool.dex)) return null
  const route = TRADE_ROUTES.find((r) => r.venue === pool.dex && r.hold === null)
  if (!route) return null
  if (pool.kind !== 'concentrated' || pool.address === null || isHookedPool(pool)) return null
  if (!score?.rated || !latest || isStaleQuote(latest.priceDeviationBps)) return null
  if (!isTradeToken(pool.token0.address) || !isTradeToken(pool.token1.address)) return null
  return { venue: route.venue, flags }
}
