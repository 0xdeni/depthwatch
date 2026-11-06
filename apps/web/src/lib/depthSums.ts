/**
 * Which pools a depth sum counts, as the API's sums do (docs/METRICS.md, "Stale quotes" and "Stock
 * tradability"): a stale quote's depth is measured at a price nobody trades, and a pool whose
 * stock's transfers are paused (unrated `transfers-paused`) can trade at none. Both are drawn and
 * listed as measured but left out of every total. Formatting only: both flags come from the API.
 */
import type { UnratedReason } from '@depthwatch/core'
import { unratedShort } from './rating.js'

/** What a depth sum reads of a pool: its stale flag and its unrated reason. */
export interface DepthSumFlags {
  staleQuote: boolean
  health: { unratedReason: UnratedReason | null }
}

/** The pool's stock has its transfers paused: every swap in it reverts. */
export function transfersPaused(p: Pick<DepthSumFlags, 'health'>): boolean {
  return p.health.unratedReason === 'transfers-paused'
}

/** Whether the pool's ±2 % depth counts in a depth sum: no stale quote, transfers not paused. */
export function countsInDepthSums(p: DepthSumFlags): boolean {
  return !p.staleQuote && !transfersPaused(p)
}

/** "Transfers paused: every swap in this pool reverts, so its depth is left out of totals." */
export const TRANSFERS_PAUSED_DETAIL = `${unratedShort('transfers-paused')}: every swap in this pool reverts, so its depth is left out of totals.`
