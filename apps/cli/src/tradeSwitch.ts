/**
 * The trade switch of the static site (docs/DEPLOY.md, "Trade switch"). `export` alone reads
 * DEPTHWATCH_TRADE and writes it twice, as the bundle's `features.trade` and as `flags.json` next
 * to the bundle (exactly `{ "trade": … }`), which the static build serves as `data/flags.json`.
 *
 * Unset, empty or `off` (any case) is off. Anything else must be a comma-separated list of trade
 * venues, each with a route in TRADE_ROUTES that is not on hold; an unknown or held venue is a
 * ConfigError naming it, so a typo never turns a venue on. It fails closed and loudly: `export`
 * then writes everything with the switch off and throws TradeSwitchRefusedError (exit code 3),
 * so a workflow publishes the switch off and then fails. The limits are the launch values of
 * `@depthwatch/core`, not settings.
 */
import { writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { TRADE_ROUTES, type TradeVenue } from '@depthwatch/chain'
import {
  TRADE_LAUNCH_MAX_USD,
  TRADE_MAX_SLIPPAGE_BPS,
  type TradeFlags,
  tradeOff,
} from '@depthwatch/core'
import { ConfigError } from './configValues.js'

/**
 * DEPTHWATCH_TRADE was refused, after `export` wrote the bundle and `flags.json` with the switch
 * off: the site fails closed, and the run still fails (exit code 3).
 */
export class TradeSwitchRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TradeSwitchRefusedError'
  }
}

/** The variable `export` reads the switch from (environment only). */
export const TRADE_SWITCH_VARIABLE = 'DEPTHWATCH_TRADE'

/** The file `export` writes next to the bundle, served by the static site as `data/flags.json`. */
export const FLAGS_FILE_NAME = 'flags.json'

/** Every venue with a route, held or not, in TRADE_ROUTES order. */
export const TRADE_SWITCH_VENUES: readonly TradeVenue[] = [
  ...new Set(TRADE_ROUTES.map((route) => route.venue)),
]

/** Why `venue` cannot be switched on: the hold of its routes when every one is held, else null. */
export function venueHold(venue: TradeVenue): string | null {
  const routes = TRADE_ROUTES.filter((route) => route.venue === venue)
  if (routes.some((route) => route.hold === null)) return null
  return routes[0]?.hold ?? 'no route'
}

/** The venues the switch can turn on, in TRADE_ROUTES order. */
export function switchableVenues(): TradeVenue[] {
  return TRADE_SWITCH_VENUES.filter((venue) => venueHold(venue) === null)
}

function isTradeVenue(id: string): id is TradeVenue {
  return (TRADE_SWITCH_VENUES as readonly string[]).includes(id)
}

/**
 * DEPTHWATCH_TRADE as the trade block: off for unset, empty or `off`; otherwise on for the listed
 * venues (case and spaces ignored, repeats and empty entries dropped, TRADE_ROUTES order) with
 * the launch limits. Throws ConfigError for an unknown or held venue and for a list with none.
 */
export function parseTradeSwitch(raw: string | undefined): TradeFlags {
  const text = (raw ?? '').trim()
  if (text === '' || text.toLowerCase() === 'off') return tradeOff()
  const expected = `expected off, or a comma-separated list of ${switchableVenues().join(', ')}`
  const listed = new Set<TradeVenue>()
  for (const entry of text.split(',')) {
    const id = entry.trim().toLowerCase()
    if (id === '') continue
    if (!isTradeVenue(id))
      throw new ConfigError(
        `${TRADE_SWITCH_VARIABLE}: unknown trade venue "${entry.trim()}" (${expected})`,
      )
    const hold = venueHold(id)
    if (hold !== null)
      throw new ConfigError(
        `${TRADE_SWITCH_VARIABLE}: trade venue "${id}" is on hold in the code (${hold}), so ` +
          `the switch cannot turn it on (${expected})`,
      )
    listed.add(id)
  }
  if (listed.size === 0)
    throw new ConfigError(`${TRADE_SWITCH_VARIABLE}: no trade venue in "${text}" (${expected})`)
  return {
    enabled: true,
    venues: TRADE_SWITCH_VENUES.filter((venue) => listed.has(venue)),
    maxUsd: TRADE_LAUNCH_MAX_USD,
    maxSlippageBps: TRADE_MAX_SLIPPAGE_BPS,
  }
}

/**
 * The switch `export` writes: DEPTHWATCH_TRADE parsed, or off with the refusal to report once the
 * files are written.
 */
export function exportedTradeSwitch(raw: string | undefined): {
  trade: TradeFlags
  refused: string | null
} {
  try {
    return { trade: parseTradeSwitch(raw), refused: null }
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    return { trade: tradeOff(), refused: error.message }
  }
}

/** One line for the export summary: `trade off`, or the venues and limits it is on with. */
export function describeTrade(trade: TradeFlags): string {
  if (!trade.enabled || trade.venues.length === 0) return 'trade off'
  return (
    `trade on for ${trade.venues.join(', ')} ` +
    `(at most $${trade.maxUsd} and ${trade.maxSlippageBps} bps of slippage a swap)`
  )
}

/** Where `flags.json` goes for a bundle written to `bundlePath`: the same directory. */
export function flagsPathOf(bundlePath: string): string {
  return join(dirname(bundlePath), FLAGS_FILE_NAME)
}

/** Refuses a bundle path that `flags.json` would overwrite. */
export function checkBundlePath(bundlePath: string): void {
  if (basename(bundlePath) === FLAGS_FILE_NAME)
    throw new ConfigError(
      `--out cannot be named ${FLAGS_FILE_NAME}: export writes that file next to the bundle`,
    )
}

/** Writes `{ "trade": … }` next to the bundle; returns its path. */
export function writeFlagsFile(bundlePath: string, trade: TradeFlags): string {
  const path = flagsPathOf(bundlePath)
  writeFileSync(path, JSON.stringify({ trade }))
  return path
}
