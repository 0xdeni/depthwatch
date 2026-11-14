/**
 * The words of Home (ia-v3 §4.1, docs/design/visual-v4.md §6.2), kept pure so the sentences can be
 * tested without rendering. Every number is formatted here from stored values; nothing is derived.
 */
import { isMeaningfulGap as meaningfulTurnover } from '@depthwatch/core'
import type { GapItem, ScorecardSummaryDto } from '../../api/types.js'
import { dexShort } from '../../components/charts/butterflyModel.js'
import { count, NB, pairLabel, ratio, usd } from '../../lib/format.js'

/** The figure of the display answer: "$49.9M". */
export const homeFigure = (depth2Usd: number): string => usd(depth2Usd)

/**
 * The sentence after the figure, set beside it as one heading. It names the pools the figure sums
 * (`stats.totals.depthKnownPools`: scored, with a known depth and no stale quote), so the headline
 * never reads as every pool on Base nor counts a pool its sum leaves out.
 */
export function homeSay(summed: number): string {
  const pools = summed === 1 ? '1 pool' : `${count(summed)} pools`
  return `sits within 2${NB}% of the price across ${pools} on Base.`
}

/**
 * The display answer as one sentence (P3): "$49.8M sits within 2 % of the price across 327 pools
 * on Base."
 */
export function homeAnswer(depth2Usd: number, summed: number): string {
  return `${homeFigure(depth2Usd)} ${homeSay(summed)}`
}

/** The answer before the first score exists. */
export const EMPTY_ANSWER = 'No pools are scored yet.'

/** The heading when the totals cannot be read. */
export const ERROR_ANSWER = 'Liquidity on Base'

/**
 * The one-sentence lead under the answer (P8): what Depthwatch measures and which pools it grades.
 * It carries no number, so the first viewport keeps its five (§6.1); the counts are in the facts.
 */
export function homeLead(scored: number, rated: number): string {
  if (scored === 1) {
    const grading = rated > 0 ? 'and grades it A to F' : 'but it is too thin to grade'
    return `Depthwatch measures what it costs to move the one Uniswap, Aerodrome or Aero pool it scores on Base, ${grading}.`
  }
  let grading: string
  if (rated === 0) grading = 'but none is deep enough to grade yet'
  else if (rated === scored) grading = 'and grades each one A to F'
  else grading = 'and grades the ones deep enough to rate'
  return `Depthwatch measures what it costs to move each Uniswap, Aerodrome and Aero pool it scores on Base, ${grading}.`
}

/** The lead while nothing is scored: what was found, and when scores appear. */
export function emptyLead(discovered: number): string {
  const found = discovered === 1 ? '1 pool discovered.' : `${count(discovered)} pools discovered.`
  return `${found} Scores appear after the first snapshot.`
}

/** A pool trading 3× its ±2 % depth a day or more (the same threshold on every screen, TB9). */
export function isMeaningfulGap(item: GapItem): boolean {
  return meaningfulTurnover(item.gap)
}

/** The 24 h volume fact's label, with its comparison when the turnover is known. */
export function volumeLabel(turnover: number | null): string {
  if (turnover === null) return `traded in 24${NB}h`
  return `traded in 24${NB}h, ${ratio(turnover)} the depth within 2${NB}% of the price`
}

/** "median health of the 50 rated pools", or why there is no median. */
export function healthLabel(rated: number): string {
  if (rated === 0) return 'median health: no pool is deep enough to rate yet'
  if (rated === 1) return 'median health of the 1 rated pool'
  return `median health of the ${count(rated)} rated pools`
}

/** "WETH / USDT, Aerodrome CL: volume over depth" */
export function gapLabel(item: GapItem): string {
  const pool = item.pool.pool
  return `${pairLabel(pool.token0, pool.token1)}, ${dexShort(pool.dex)}: volume over depth`
}

/** "48 pools trade 3× their depth or more every day." / "No pool trades 3× its depth today." */
export function gapsTakeaway(meaningful: number): string {
  if (meaningful === 0) return 'No pool trades 3× its depth today.'
  if (meaningful === 1) return '1 pool trades 3× its depth or more every day.'
  return `${count(meaningful)} pools trade 3× their depth or more every day.`
}

/** The quiet line under fewer than 3 gap rows. */
export const GAPS_QUIET_LINE = 'Every other pool trades less than 3× its depth.'

/**
 * The scorecards takeaway around its glossary term: "1 of 2 mandates is within its [KPIs] right
 * now." Every registered mandate counts, as on the Scorecards list.
 */
export function mandatesTakeaway(items: readonly Pick<ScorecardSummaryDto, 'status'>[]): {
  before: string
  after: string
} {
  const ok = items.filter((s) => s.status === 'ok').length
  const n = items.length
  const noun = n === 1 ? 'mandate' : 'mandates'
  const verb = ok === 1 || (ok === 0 && n === 1) ? 'is' : 'are'
  const their = ok === 1 || n === 1 ? 'its' : 'their'
  return { before: `${ok} of ${n} ${noun} ${verb} within ${their} `, after: ' right now.' }
}

/** The definition behind the dotted "KPIs" in the scorecards takeaway (D8). */
export const KPIS_DEFINITION =
  'The depth a market maker promised to keep on each side, checked at every snapshot.'
