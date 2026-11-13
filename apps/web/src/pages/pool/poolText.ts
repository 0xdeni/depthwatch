/**
 * The Pool page's sentences (ia-v3 §4.3, docs/design/visual-v4.md §6.4): the answer beside the
 * title, the facts' comparisons, each section's finding and the over-time caption. They only word
 * the stored values (P3, P8); nothing here is a metric, and every number goes through
 * `lib/format.ts`.
 */
import {
  HEALTH_MAX,
  type HealthComponents,
  type HealthScore,
  isHookedPool,
  ownersCoverPool,
} from '@depthwatch/core'
import type {
  ConcentrationMetrics,
  PersistenceMetrics,
  PoolDetail,
  SpreadPoint,
} from '../../api/types.js'
import { weakestPart } from '../../components/charts/HealthBar.js'
import {
  bps,
  cantAbsorb,
  clockTime,
  NB,
  type RoundTripCost,
  ratio,
  roundTripCost,
  SPREAD_UNABSORBED_BPS,
  score,
  scoreExact,
  shareOf,
  tokenText,
  uptime,
  usd,
} from '../../lib/format.js'
import { unratedDetail } from '../../lib/rating.js'

const PART_NAME: Readonly<Record<keyof HealthComponents, string>> = {
  depth: 'Depth',
  spread: 'Spread',
  concentration: 'Concentration',
  persistence: 'Persistence',
}

/**
 * "It takes $6.08M of buying to lift WETH 2 % and $5.10M of selling to push it down." It names the
 * pool's first token, whose price the stored sides move (AGENTS.md rule 6): USDC / AERO reads "to
 * lift USDC", the same sides Home and the scorecards show. With an unpriced side it says which
 * token has no USD price; with a side that runs out before 2 % it says how much empties it (CH3).
 * When both sides hold $0 within 2 % it says that no liquidity sits there.
 */
export function poolAnswer(detail: Pick<PoolDetail, 'pool' | 'latest'>): string {
  const { pool } = detail
  if (!detail.latest) return 'No snapshot yet. Depth appears after the first snapshot.'
  if (isHookedPool(pool))
    return 'This pool has a swap hook Depthwatch does not model: its depth is not computed.'
  const latest = detail.latest
  const t0 = tokenText(pool.token0)
  const t1 = tokenText(pool.token1)
  const usdRow = latest.depthUsd.find((d) => d.pct === 2)
  const raw = latest.depth.find((d) => d.pct === 2)
  const up = usdRow?.upUsd ?? null
  const down = usdRow?.downUsd ?? null
  const upOut = raw?.up.reached === false
  const downOut = raw?.down.reached === false
  if (up === null && down === null)
    return `Depth is unknown in dollars: neither ${t0} nor ${t1} has a USD price.`
  if (up === 0 && down === 0) return `No liquidity sits within 2${NB}% of the price.`
  if (upOut || downOut) {
    const side = upOut ? 'buy' : 'sell'
    const v = upOut ? up : down
    const lead = `Liquidity runs out before a 2${NB}% move: ${usd(v)} empties the ${side} side`
    if (upOut && downOut) return `${lead}, and ${usd(down)} empties the sell side.`
    const other = upOut ? down : up
    if (other === null) return `${lead}.`
    return upOut
      ? `${lead}, and ${usd(other)} of selling pushes ${t0} down 2${NB}%.`
      : `${lead}, and ${usd(other)} of buying lifts ${t0} 2${NB}%.`
  }
  if (up === null)
    return `It takes ${usd(down)} of selling to push ${t0} down 2${NB}%. The buy side is unknown: ${t1} has no USD price.`
  if (down === null)
    return `It takes ${usd(up)} of buying to lift ${t0} 2${NB}%. The sell side is unknown: ${t0} has no USD price.`
  return `It takes ${usd(up)} of buying to lift ${t0} 2${NB}% and ${usd(down)} of selling to push it down.`
}

/**
 * The Health finding names the component furthest below its weight. When core scored it neutral,
 * its note says why ("samples cover under 25 % of the window"); otherwise the points it holds, to
 * one decimal like the health bar and Details. For a pool with no grade it says why there is none.
 */
export function healthTakeaway(
  health: HealthScore,
  concentration: ConcentrationMetrics | null,
  kind: string,
): string {
  if (!health.rated) return unratedDetail(health.unratedReason)
  const weakest = weakestPart(health.components)
  const why = neutralReason(health.notes, weakest)
  if (why) return `${PART_NAME[weakest]} is the weak part: ${why}.`
  if (weakest === 'concentration' && concentration) {
    // Owners the score did not use (they cover too little of the pool) are not the reason.
    if (ownersCoverPool(concentration.owners) && health.concentrationBasis !== 'ranges')
      return `Concentration is the weak part: one LP holds ${shareOf(concentration.owners.top1Share)}.`
    if (kind !== 'concentrated')
      return 'Concentration is the weak part: all liquidity is one full range.'
    return `Concentration is the weak part: ${shareOf(concentration.activeRangeShare)} sits in one range.`
  }
  return `${PART_NAME[weakest]} is the weak part: ${scoreExact(health.components[weakest])} of ${HEALTH_MAX[weakest]} points.`
}

/** The reason of core's "persistence neutral: …" note for `part`, with a no-break space before %. */
export function neutralReason(
  notes: readonly string[],
  part: keyof HealthComponents,
): string | null {
  const prefix = `${part} neutral: `
  const note = notes.find((n) => n.startsWith(prefix))
  return note ? note.slice(prefix.length).replace(/ %/g, `${NB}%`) : null
}

/** A spread a trade can pay: feasible, and under the 10,000 bps a stored spread can never reach. */
function costs(s: SpreadPoint): s is SpreadPoint & { spreadBps: number } {
  return (
    s.feasible && s.spreadBps !== null && Math.round(Math.abs(s.spreadBps)) < SPREAD_UNABSORBED_BPS
  )
}

/**
 * "A $100K round trip costs 0.14 %, about $138 (13.8 bps), fees included." for the largest
 * notional the pool absorbs: percent and dollars first, bps second (`roundTripCost`).
 */
export function costTakeaway(spreads: readonly SpreadPoint[]): string {
  const sorted = [...spreads].sort((a, b) => b.notionalUsd - a.notionalUsd)
  const largest = sorted[0]
  const fillable = sorted.find(costs)
  if (!largest) return 'No round trip was measured in the latest snapshot.'
  if (!fillable) return `The pool can’t absorb a ${usd(sorted.at(-1)?.notionalUsd)} round trip.`
  const cost = costWords(fillable)
  if (fillable === largest)
    return `A ${usd(fillable.notionalUsd)} round trip costs ${cost}, fees included.`
  return `The pool can’t absorb ${usd(largest.notionalUsd)}; a ${usd(fillable.notionalUsd)} round trip costs ${cost}.`
}

/** A fillable round trip's cost in words: "0.14 %, about $138 (13.8 bps)". */
function costWords(s: SpreadPoint & { spreadBps: number }): string {
  return roundTripCost(s.spreadBps, s.notionalUsd)?.text ?? cantAbsorb(s.notionalUsd)
}

/**
 * One notional's cost in the Details table: its parts, which the cell lays out as the percent
 * over the dollars and bps ("0.14 %" over "$14 (13.8 bps)"), as the spread fact and the cost
 * chart do; or the words "Can’t absorb $10K".
 */
export function spreadCell(s: SpreadPoint): RoundTripCost | string {
  return (costs(s) ? roundTripCost(s.spreadBps, s.notionalUsd) : null) ?? cantAbsorb(s.notionalUsd)
}

/**
 * The over-time spread at $10K, in the multiple's head: percent first, bps second, as the facts
 * row reads it ("0.18 % (17.8 bps)"); "—" where `bps` prints no number.
 */
export function spreadHeadText(spreadBps: number | null): string {
  const cost = roundTripCost(spreadBps, 10_000)
  return cost ? `${cost.percent} (${cost.bps})` : bps(spreadBps)
}

/**
 * "One LP holds 53 % of the liquidity near the price." when the indexed owners cover the pool
 * (core's `ownersCoverPool`). Owners that cover less are a part of the pool: it says how much they
 * hold and the largest one's share of that. With no owner in the band, or none indexed, it reads
 * the active range instead; a full-range pool has one range by construction. `ownersRead` is
 * false where the data never carries LP owners (the static site): a pool without owner data then
 * reads the active range alone, without saying that owners are not indexed.
 */
export function whoTakeaway(
  concentration: ConcentrationMetrics | null,
  kind: string,
  ownersRead = true,
): string {
  if (!concentration) return 'No concentration data in the latest snapshot.'
  const { owners } = concentration
  if (ownersCoverPool(owners))
    return `One LP holds ${shareOf(owners.top1Share)} of the liquidity near the price.`
  if (owners && owners.count > 0)
    return `Indexed LPs hold ${coverageWords(owners.coverage)} of the liquidity near the price; the largest holds ${shareOf(owners.top1Share)} of that.`
  if (kind !== 'concentrated') return 'A full-range pool: every LP shares one range.'
  const range = `The active range holds ${shareOf(concentration.activeRangeShare)} of the liquidity within ±${concentration.bandPct}${NB}%.`
  if (owners) return `No indexed LP owner holds liquidity near the price. ${range}`
  return ownersRead ? `LP owners are not indexed for this pool. ${range}` : range
}

/**
 * The section's heading: "who provides it" where owners can be read; where they cannot (the
 * static site) and the pool has no owner data, the section shows how concentrated the liquidity
 * is, and says that instead.
 */
export function whoTitle(owners: ConcentrationMetrics['owners'], ownersRead: boolean): string {
  return owners === null && !ownersRead ? 'how concentrated the liquidity is' : 'who provides it'
}

/**
 * The note under the who-provides-it details when the owner shares do not describe the pool, and
 * so are not what health reads; null when they do, and where owners are never read and this pool
 * has none (the heading already says what the section shows).
 */
export function ownersNote(
  owners: ConcentrationMetrics['owners'],
  ownersRead = true,
): string | null {
  if (ownersCoverPool(owners)) return null
  if (!owners)
    return ownersRead ? 'Owners are not indexed for this pool, so health uses the range HHI.' : null
  if (owners.count === 0)
    return 'No indexed owner holds liquidity in the band, so health uses the range HHI.'
  return `Indexed owners cover ${coverageWords(owners.coverage)} of the liquidity in the band, so health uses the range HHI; the LP shares above are of that part.`
}

/** The indexed owners' coverage in words: "1 %", or "an unknown share" for a snapshot without it. */
export function coverageWords(coverage: number | null): string {
  return coverage === null ? 'an unknown share' : shareOf(coverage)
}

/** The persistence takeaway's two values for a window (they change with the window control). */
export function persistenceParts(p: PersistenceMetrics | null): {
  uptime: string
  samples: string
} | null {
  if (!p || p.uptime === null) return null
  return { uptime: uptime(p.uptime), samples: String(p.samples) }
}

/** The stored spread of one notional ($10K for the facts); null when the pool cannot absorb it. */
export function spreadAt(spreads: readonly SpreadPoint[], notional: number): number | null {
  const s = spreads.find((x) => x.notionalUsd === notional)
  return s !== undefined && costs(s) ? s.spreadBps : null
}

/**
 * The facts' comparisons (§6.4): each label carries what to read its value against (P4). A number
 * that ends a label is joined to the word before it with a no-break space, so it never sits alone
 * on the label's last line.
 */
export function healthFactSuffix(median: number | null | undefined): string {
  return median == null ? '' : `; the median rated pool scores${NB}${score(median)}`
}

/** "traded in 24 h, 14× the depth within 2 %": core's turnover, as the gap metrics store it. */
export function volumeFactLabel(turnover: number | null | undefined): string {
  const base = `traded in 24${NB}h`
  return turnover == null ? base : `${base}, ${ratio(turnover)} the depth within${NB}2${NB}%`
}

/**
 * "TVL, of which 10 % sits within 2 %": the stored ±2 % depth over the stored TVL, both from the
 * latest snapshot. Without either it is the plain label.
 */
export function tvlFactLabel(depth2: number | null | undefined, tvl: number | null): string {
  if (depth2 == null || tvl === null || !(tvl > 0)) return 'TVL'
  return `TVL, of which ${shareOf(depth2 / tvl)} sits within${NB}2${NB}%`
}

/**
 * The gap callout under the facts: "Liquidity gap: one of 48 pools that trade 3× their depth or
 * more a day." when the gaps feed lists the pool, else its own turnover.
 */
export function gapCallout(turnover: number, listed: number | null, floor: number): string {
  if (listed !== null && listed > 1)
    return `Liquidity gap: one of ${listed} pools that trade ${floor}× their depth or more a day.`
  return `Liquidity gap: it trades ${ratio(turnover)} its depth a day.`
}

/** "51 minutes", "6 hours", "3 days": how long the snapshots of a window span. */
export function spanWords(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60))
  if (min < 120) return `${min} ${min === 1 ? 'minute' : 'minutes'}`
  const h = Math.round(seconds / 3600)
  if (h < 48) return `${h} hours`
  return `${Math.round(seconds / 86_400)} days`
}

/**
 * The over-time finding when persistence cannot be measured yet: "5 snapshots from 10:39 to 11:30
 * UTC cover too little of the window to measure persistence."
 */
export function tooFewTakeaway(samples: number, times: readonly number[]): string {
  const first = times[0]
  const last = times[times.length - 1]
  const when =
    first !== undefined && last !== undefined && last > first
      ? ` from ${clockTime(first)} to ${clockTime(last)}${NB}UTC`
      : ''
  if (samples < 3) {
    const n = samples === 1 ? '1 snapshot' : `${samples} snapshots`
    return `${n}${when}: too few to measure persistence yet.`
  }
  return `${samples} snapshots${when} cover too little of the window to measure persistence.`
}

/**
 * The caption under the multiples (§5.9.6): the span the axis covers, and, when switching the
 * window changes nothing, that both windows hold the same snapshots.
 */
export function overTimeCaption(shown: readonly number[], other: number): string {
  const first = shown[0]
  const last = shown[shown.length - 1]
  const span =
    first !== undefined && last !== undefined && last > first
      ? ` The axis spans the ${spanWords(last - first)} the snapshots cover; each range is labelled at its right.`
      : ''
  const same = other === shown.length ? ` Both windows hold the same ${other} snapshots.` : ''
  return `Times in UTC.${span}${same}`
}
