/**
 * Why a pool has no grade, in plain words (docs/METRICS.md, "Rated and unrated pools"): the short
 * reason a chip's tooltip starts with, and the full line the pool page and the tooltips give. And
 * why a grade carries the concentration mark ("Concentration (max 20)"). Formatting only: the
 * reason, the basis and the floors come from the API and core.
 */
import {
  type ConcentrationBasis,
  HEALTH_RATING_MIN_SIDE_USD,
  OWNER_COVERAGE_MIN,
  type UnratedReason,
} from '@depthwatch/core'
import { NB, usd } from './format.js'

/** What the chip says in place of a letter. */
export const NOT_RATED = 'Not rated'

const SHORT: Readonly<Record<UnratedReason, string>> = {
  thin: 'Too thin to rate',
  'one-sided': 'Too thin on one side',
  unpriced: 'No USD price',
  hooked: 'Hooked pool',
  'transfers-paused': 'Transfers paused',
}

/** "Too thin to rate"; a score stored before ratings existed has no reason yet. */
export function unratedShort(reason: UnratedReason | null): string {
  return reason === null ? 'Not rated yet' : SHORT[reason]
}

/** The short reason with its one-line why: "Too thin to rate: neither side holds $5K within 2 %." */
export function unratedDetail(reason: UnratedReason | null): string {
  const floor = usd(HEALTH_RATING_MIN_SIDE_USD)
  const within = `within 2${NB}%`
  switch (reason) {
    case 'thin':
      return `${SHORT.thin}: neither side holds ${floor} ${within}.`
    case 'one-sided':
      return `${SHORT['one-sided']}: the thinner side holds under ${floor} ${within}.`
    case 'unpriced':
      return `${SHORT.unpriced}: a token in this pool has no price in dollars.`
    case 'hooked':
      return `${SHORT.hooked}: it runs a swap hook Depthwatch does not model; depth is not computed.`
    case 'transfers-paused':
      return `${SHORT['transfers-paused']}: the stock’s transfers are paused, so this pool’s depth cannot be used.`
    case null:
      return 'Not rated yet: the score is being refreshed.'
  }
}

/** The mark beside a grade whose concentration points do not rest on LP owners. */
export const BASIS_MARK = '*'

/** The mark's accessible name. */
export const BASIS_MARK_LABEL = 'Concentration not from LP owners'

/**
 * The tooltip of the concentration mark: what the grade's 20 concentration points rest on when it
 * is not the LP owners; null for an owner-based grade and for a score stored before the basis was
 * recorded (nothing to say).
 */
export function concentrationBasisDetail(basis: ConcentrationBasis | null): string | null {
  const share = `${Math.round(OWNER_COVERAGE_MIN * 100)}${NB}%`
  switch (basis) {
    case 'ranges':
      return `Concentration is scored from how the liquidity spreads over price ranges: LP owners are not indexed for this pool, or cover under ${share} of it.`
    case 'neutral':
      return 'Concentration is scored neutral, 10 of 20: LP owners are not indexed for this pool.'
    default:
      return null
  }
}
