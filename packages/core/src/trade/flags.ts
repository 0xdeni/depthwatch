/**
 * The trade switch (docs/DEPLOY.md, "Trade switch"). `depthwatch export` writes the same block into
 * the static bundle as `features.trade` and next to it as `data/flags.json` (`{ "trade": … }`),
 * from DEPTHWATCH_TRADE. The dashboard reads the bundle's block at load and the file again, with
 * `cache: 'no-store'`, when the swap panel connects and immediately before every signature request,
 * and swaps in a pool only when both are on for its venue. The shapes (`TradeFlags`,
 * `FeatureFlags`) are shared types (`../types.ts`). Every reader here fails closed: a block that is
 * missing or not exactly well-formed reads as off. Pure: the caller fetches the files.
 */

import { DEXES, type Dex, type TradeFlags } from '../types.js'
import { TRADE_LAUNCH_MAX_USD, TRADE_MAX_SLIPPAGE_BPS, TRADE_MIN_SLIPPAGE_BPS } from './limits.js'

const TRADE_FLAG_KEYS = ['enabled', 'venues', 'maxUsd', 'maxSlippageBps'] as const

/** The switch off, with the launch limits: what a missing or malformed block reads as. */
export function tradeOff(): TradeFlags {
  return {
    enabled: false,
    venues: [],
    maxUsd: TRADE_LAUNCH_MAX_USD,
    maxSlippageBps: TRADE_MAX_SLIPPAGE_BPS,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isDex(value: unknown): value is Dex {
  return typeof value === 'string' && (DEXES as readonly string[]).includes(value)
}

/**
 * A trade block exactly as the export writes it, as a fresh copy, or null. Null for anything else:
 * a missing or extra key; `enabled` not a boolean; `venues` not an array of distinct DEX ids;
 * `maxUsd` not a finite number above 0; `maxSlippageBps` not an integer of at least
 * TRADE_MIN_SLIPPAGE_BPS (a value above TRADE_MAX_SLIPPAGE_BPS is held to it by
 * `validateSlippageBps`).
 */
export function parseTradeFlags(value: unknown): TradeFlags | null {
  if (!isPlainObject(value) || !hasExactKeys(value, TRADE_FLAG_KEYS)) return null
  const { enabled, venues, maxUsd, maxSlippageBps } = value
  if (typeof enabled !== 'boolean') return null
  if (!Array.isArray(venues) || !venues.every(isDex)) return null
  if (new Set(venues).size !== venues.length) return null
  if (typeof maxUsd !== 'number' || !Number.isFinite(maxUsd) || maxUsd <= 0) return null
  if (!Number.isSafeInteger(maxSlippageBps)) return null
  if ((maxSlippageBps as number) < TRADE_MIN_SLIPPAGE_BPS) return null
  return { enabled, venues: [...venues], maxUsd, maxSlippageBps: maxSlippageBps as number }
}

/** `data/flags.json` read as the trade block it carries: exactly `{ "trade": … }`, else null. */
export function parseFlagsFile(value: unknown): TradeFlags | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ['trade'])) return null
  return parseTradeFlags(value.trade)
}

/**
 * What both reads allow together: on only when both blocks parsed and are on, for the venues both
 * list (in the order of `atLoad`), with the lower of each limit. A null block (missing,
 * unreadable or malformed) gives the switch off.
 */
export function combineTradeFlags(atLoad: TradeFlags | null, live: TradeFlags | null): TradeFlags {
  if (atLoad === null || live === null || !atLoad.enabled || !live.enabled) return tradeOff()
  const venues = atLoad.venues.filter((venue) => live.venues.includes(venue))
  if (venues.length === 0) return tradeOff()
  return {
    enabled: true,
    venues,
    maxUsd: Math.min(atLoad.maxUsd, live.maxUsd),
    maxSlippageBps: Math.min(atLoad.maxSlippageBps, live.maxSlippageBps),
  }
}

/** True when `flags` has the swap on for `venue`. */
export function tradeOnFor(flags: TradeFlags, venue: Dex): boolean {
  return flags.enabled && flags.venues.includes(venue)
}
