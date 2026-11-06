/**
 * Liquidity Health Score (0–100) and rating (docs/METRICS.md, "Liquidity Health Score").
 *
 * - depth (35):         35 · clamp((log10(2 · thinner) − 3) / 3, 0, 1)   thinner $500 → 0, $500k → 35
 *                       thinner = min(±2 % up USD, ±2 % down USD): a one-sided pool scores 0
 * - spread (25):        25 · clamp((log10 300 − log10 spread10kBps) / (log10 300 − log10 10), 0, 1)
 * - concentration (20): owners known and covering ≥ OWNER_COVERAGE_MIN of the in-band liquidity →
 *                       20 · (1 − top1Share); else a concentrated pool's 20 · (1 − rangeHhi);
 *                       else 10 (`concentrationBasis` owners / ranges / neutral)
 * - persistence (20):   20 · (0.5 · stability + 0.5 · uptime), else 10 (unknown)
 * Rated: not a hooked pool, not a stock pool whose stock's transfers are paused, both sides known
 * and the thinner at least HEALTH_RATING_MIN_SIDE_USD.
 * Grade (rated pools only): A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F.
 */

import { clamp } from '../math.js'
import {
  type ConcentrationBasis,
  HEALTH_MAX,
  type HealthGrade,
  type HealthInputs,
  type HealthScore,
  type OwnerConcentration,
  type PoolMeta,
  type UnratedReason,
} from '../types.js'

export const NOTE_DEPTH_UNKNOWN = 'depth unknown: scored 0'
export const NOTE_SPREAD_INFEASIBLE = 'spread infeasible at $10k: scored 0'
export const NOTE_CONCENTRATION_NEUTRAL = 'concentration neutral: no position or range data'
export const NOTE_CONCENTRATION_RESERVES = 'concentration neutral: LP owners not indexed'
export const NOTE_PERSISTENCE_NEUTRAL = 'persistence neutral: fewer than 3 samples'
export const NOTE_PERSISTENCE_SHORT = 'persistence neutral: samples cover under 25 % of the window'

/**
 * A pool is rated only when the thinner side of its ±2 % depth holds at least this many USD.
 * Half of the $10,000 spread notional; 50 of the 492 pools of the first live database.
 */
export const HEALTH_RATING_MIN_SIDE_USD = 5_000

/**
 * Owner shares are scored only when the indexed owners account for at least this share of the
 * pool's in-band liquidity (`OwnerConcentration.coverage`); below it the shares describe a part of
 * the pool, and the range HHI is used instead.
 */
export const OWNER_COVERAGE_MIN = 0.9

/**
 * Whether owner shares describe the pool (docs/METRICS.md, "Owner concentration"): owners hold
 * liquidity in the band (`count > 0`) and cover at least OWNER_COVERAGE_MIN of it. Otherwise
 * `top1Share` is a share of the indexed part only: of nothing when `count` is 0, and possibly
 * 100 % for a lone unstaked LP beside a gauge that holds most of the pool.
 */
export function ownersCoverPool(
  owners: OwnerConcentration | null | undefined,
): owners is OwnerConcentration & { coverage: number } {
  if (owners == null || !(owners.count > 0)) return false
  const { coverage } = owners
  return coverage !== null && Number.isFinite(coverage) && coverage >= OWNER_COVERAGE_MIN
}

/**
 * The largest owner's share of the pool's in-band liquidity where the owners describe the pool
 * (`ownersCoverPool`), else null: the value the snapshot stores and lists as `ownerTop1Share`.
 */
export function poolOwnerTop1Share(owners: OwnerConcentration | null | undefined): number | null {
  return ownersCoverPool(owners) ? owners.top1Share : null
}

/** "owner data covers 40 % of in-band liquidity" (rounded down, so 89.9 % never reads as 90 %). */
export function ownerCoverageNote(coverage: number | null): string {
  if (coverage === null || !Number.isFinite(coverage))
    return 'owner data covers an unknown share of in-band liquidity'
  return `owner data covers ${Math.floor(clamp(coverage, 0, 1) * 100)} % of in-band liquidity`
}

const LOG_300 = Math.log10(300)
const LOG_10 = Math.log10(10)

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

function known(x: number | null): x is number {
  return x !== null && Number.isFinite(x)
}

/** The thinner of the two ±2 % sides in USD; null when either side is unknown. */
export function thinnerSideUsd(upUsd: number | null, downUsd: number | null): number | null {
  if (!known(upUsd) || !known(downUsd)) return null
  return Math.min(upUsd, downUsd)
}

export interface DepthRating {
  rated: boolean
  /** Null when rated. */
  unratedReason: UnratedReason | null
}

/**
 * A pool with a hook (a non-zero `hooks` address): a Uniswap v4 pool with a hook, or an Aero
 * Slipstream pool whose swap hook is not the reviewed one or charges each block's first swap an
 * initial fee. Its swaps run code the pool's state does not describe, so it is not modelled
 * (docs/METRICS.md, `hooked`).
 */
export function isHookedPool(pool: Pick<PoolMeta, 'hooks'>): boolean {
  return typeof pool.hooks === 'string' && !/^0x0{40}$/i.test(pool.hooks)
}

export interface RateDepthOptions {
  /** The pool is hooked (`isHookedPool`): unrated whatever its sides. */
  hooked?: boolean
  /**
   * A stock pool whose stock's transfers are paused at the snapshot's block, so that every swap in
   * it reverts (docs/METRICS.md, "Stock tradability"): unrated whatever its sides, after `hooked`.
   */
  transfersPaused?: boolean
}

/** Rated or not, from the two ±2 % sides in USD (docs/METRICS.md, "Rated and unrated pools"). */
export function rateDepth(
  upUsd: number | null,
  downUsd: number | null,
  opts: RateDepthOptions = {},
): DepthRating {
  if (opts.hooked === true) return { rated: false, unratedReason: 'hooked' }
  if (opts.transfersPaused === true) return { rated: false, unratedReason: 'transfers-paused' }
  if (!known(upUsd) || !known(downUsd)) return { rated: false, unratedReason: 'unpriced' }
  const thinner = Math.min(upUsd, downUsd)
  if (thinner >= HEALTH_RATING_MIN_SIDE_USD) return { rated: true, unratedReason: null }
  const deeper = Math.max(upUsd, downUsd)
  return {
    rated: false,
    unratedReason: deeper >= HEALTH_RATING_MIN_SIDE_USD ? 'one-sided' : 'thin',
  }
}

function depthScore(thinnerUsd: number | null): number {
  if (thinnerUsd === null || thinnerUsd <= 0) return 0
  return HEALTH_MAX.depth * clamp((Math.log10(2 * thinnerUsd) - 3) / 3, 0, 1)
}

function spreadScore(spreadBps: number): number {
  if (spreadBps <= 0) return HEALTH_MAX.spread
  return HEALTH_MAX.spread * clamp((LOG_300 - Math.log10(spreadBps)) / (LOG_300 - LOG_10), 0, 1)
}

export function healthGrade(total: number): HealthGrade {
  if (total >= 80) return 'A'
  if (total >= 65) return 'B'
  if (total >= 50) return 'C'
  if (total >= 35) return 'D'
  return 'F'
}

export function computeHealthScore(inputs: HealthInputs): HealthScore {
  const notes: string[] = []

  const thinner = thinnerSideUsd(inputs.depth2UpUsd, inputs.depth2DownUsd)
  const depth = depthScore(thinner)
  if (thinner === null) notes.push(NOTE_DEPTH_UNKNOWN)

  let spread = 0
  if (inputs.spread10kBps === null || !Number.isFinite(inputs.spread10kBps)) {
    notes.push(NOTE_SPREAD_INFEASIBLE)
  } else {
    spread = spreadScore(inputs.spread10kBps)
  }

  const { concentration, concentrationBasis } = concentrationScore(inputs, notes)

  let persistence: number
  const p = inputs.persistence
  if (p === null || p.stability === null || p.uptime === null) {
    persistence = HEALTH_MAX.persistence / 2
    // With 3 or more samples the only way persistence is unknown is the coverage rule.
    notes.push(p !== null && p.samples >= 3 ? NOTE_PERSISTENCE_SHORT : NOTE_PERSISTENCE_NEUTRAL)
  } else {
    persistence =
      HEALTH_MAX.persistence * (0.5 * clamp(p.stability, 0, 1) + 0.5 * clamp(p.uptime, 0, 1))
  }

  const components = {
    depth: round2(depth),
    spread: round2(spread),
    concentration: round2(concentration),
    persistence: round2(persistence),
  }
  const total = round2(
    components.depth + components.spread + components.concentration + components.persistence,
  )
  const { rated, unratedReason } = rateDepth(inputs.depth2UpUsd, inputs.depth2DownUsd, {
    hooked: inputs.hooked,
    transfersPaused: inputs.transfersPaused,
  })
  return {
    total,
    grade: rated ? healthGrade(total) : null,
    rated,
    unratedReason,
    concentrationBasis,
    components,
    notes,
  }
}

/** The concentration component and its basis (docs/METRICS.md, "Concentration (max 20)"). */
function concentrationScore(
  inputs: HealthInputs,
  notes: string[],
): { concentration: number; concentrationBasis: ConcentrationBasis } {
  const top1 = inputs.ownerTop1Share
  const coverage = inputs.ownerCoverage
  const rangeHhi = inputs.rangeHhi
  const ownersKnown = known(top1) && top1 > 0
  if (ownersKnown && known(coverage) && coverage >= OWNER_COVERAGE_MIN)
    return {
      concentration: HEALTH_MAX.concentration * (1 - clamp(top1, 0, 1)),
      concentrationBasis: 'owners',
    }
  // Owners known but covering too little of the pool: say so, whatever is used instead.
  if (ownersKnown) notes.push(ownerCoverageNote(coverage))
  if (inputs.poolKind === 'concentrated' && known(rangeHhi))
    return {
      concentration: HEALTH_MAX.concentration * (1 - clamp(rangeHhi, 0, 1)),
      concentrationBasis: 'ranges',
    }
  if (!ownersKnown)
    notes.push(
      inputs.poolKind === 'concentrated' ? NOTE_CONCENTRATION_NEUTRAL : NOTE_CONCENTRATION_RESERVES,
    )
  return { concentration: HEALTH_MAX.concentration / 2, concentrationBasis: 'neutral' }
}
