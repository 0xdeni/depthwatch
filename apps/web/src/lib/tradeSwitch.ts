/**
 * The trade switch as a page read it at load (docs/DEPLOY.md, "Trade switch"), shared by the pool
 * page's gate (`pages/pool/tradeGate.ts`) and the footer's promise (`components/Layout.tsx`). It
 * fails closed: a missing switch, demo, mock and connecting modes are off, and so is a venue whose
 * route is on hold.
 */
import { TRADE_ROUTES, type TradeRoute } from '@depthwatch/chain/addresses'
import { type Dex, type TradeFlags, tradeOnFor } from '@depthwatch/core'

export interface TradeSwitchEnv {
  mock: boolean
  demo?: boolean
  connecting?: boolean
  /** The static bundle's switch at load; null or undefined is off. */
  trade?: TradeFlags | null
}

/** The route for a pool of `dex`, when the switch is on for `dex` and its route is not on hold. */
export function openRoute(flags: TradeFlags, dex: Dex): TradeRoute | null {
  if (!tradeOnFor(flags, dex)) return null
  return TRADE_ROUTES.find((r) => r.venue === dex && r.hold === null) ?? null
}

/**
 * The switch read at load when it is on for at least one venue whose route is not on hold, outside
 * demo, mock and connecting modes; else null. It does not ask whether any pool qualifies, and a
 * page already open keeps what it read until it reloads. The footer says the swap panel is on
 * exactly when this is not null.
 */
export function tradeSwitchOn(env: TradeSwitchEnv): TradeFlags | null {
  const flags = env.trade ?? null
  if (env.mock || env.demo || env.connecting || flags === null) return null
  return flags.venues.some((venue) => openRoute(flags, venue) !== null) ? flags : null
}
