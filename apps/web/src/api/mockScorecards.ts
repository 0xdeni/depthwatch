/**
 * The two scorecards of the mock API, mirroring the API seed (`apps/api/src/testing/seedMandates.ts`)
 * and the demo mandates of docs/design/scorecards.md §5, with the same ids so a dashboard pointed
 * at a seeded API finds what its mock shows:
 *
 * - `demo-slipstream-weth-usdc` meets its KPIs on the mock's Slipstream WETH/AERO pool: status
 *   `ok`, with a three-sample `depthDown` breach five days ago and one unpriced sample six days
 *   ago, so the 7 d / 30 d uptime is below 100 % while the 24 h uptime is exactly 1. Two extra
 *   samples 31 days old sit outside the 30-day summary window.
 * - `demo-aero-usdc-aero` is an Aerodrome v2 LP share far below its `minDepthUsd` on the mock's
 *   USDC/AERO pool: `breached` since its seventh sample, six within-KPI samples before that.
 *
 * `withinKpi`, `breaches` and the summaries come from core (`evaluateKpis`, `summarizeScorecard`),
 * so the mock can never disagree with the rules the pipeline and the API apply.
 */
import {
  DEFAULT_ALERT_AFTER_SAMPLES,
  evaluateKpis,
  type Mandate,
  type MmAttribution,
  type MmSample,
  summarizeScorecard,
  toJsonSafe,
  toPublicMandate,
} from '@depthwatch/core'
import { LATEST_BLOCK } from './mockPools.js'
import type { ScorecardSummaryDto } from './types.js'

export const MOCK_MM_OK_ID = 'demo-slipstream-weth-usdc'
export const MOCK_MM_BREACHED_ID = 'demo-aero-usdc-aero'
/** The mock's Aerodrome Slipstream WETH/AERO pool (`mock/pools.json`). */
export const MOCK_MM_OK_POOL = 'aerodrome-slipstream:0x82321f3beb69f503380d6b233857d5c43562e2d0'
/** The mock's Aerodrome v2 USDC/AERO pool (`mock/pools.json`). */
export const MOCK_MM_BREACHED_POOL = 'aerodrome-v2:0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d'
/** The Slipstream mandate's depositor address (the seed's `fixtureAddress(0xb1)`). */
export const MOCK_MM_OWNER_SLIP = '0x00000000000000000000000000000000000000b1'
/** The Aerodrome v2 mandate's LP-holder addresses (`fixtureAddress(0xb2)`, `0xb3`). */
export const MOCK_MM_OWNERS_AERO = [
  '0x00000000000000000000000000000000000000b2',
  '0x00000000000000000000000000000000000000b3',
] as const

const DAY = 86_400
const HOUR = 3_600
/** How far back a summary reads samples (the longest uptime window), as the API does. */
export const SUMMARY_WINDOW_SECONDS = 30 * DAY

/** Index of the single unpriced (unevaluable) sample of the ok mandate. */
export const MOCK_MM_UNPRICED_INDEX = 24
/** Indices of the ok mandate's past `depthDown` breach (three consecutive samples). */
export const MOCK_MM_OK_BREACH_INDICES: readonly number[] = [36, 37, 38]
/** Number of leading within-KPI samples of the breached mandate. */
export const MOCK_MM_BREACHED_OK_PREFIX = 6

/** The two mandates at `now` (unix seconds). */
export function mockMandates(now: number): Mandate[] {
  return [
    {
      id: MOCK_MM_OK_ID,
      name: 'Demo Markets · Slipstream WETH/AERO',
      poolId: MOCK_MM_OK_POOL,
      marketMaker: 'Demo Markets',
      addresses: [MOCK_MM_OWNER_SLIP],
      kpis: {
        minDepthUsd: 50_000,
        bandPct: 2,
        maxSpreadBps: null,
        spreadNotionalUsd: 10_000,
        targetUptime: 0.95,
      },
      alertWebhookUrl: null,
      alertAfterSamples: DEFAULT_ALERT_AFTER_SAMPLES,
      active: true,
      createdAt: now - 40 * DAY,
      notes: 'Mock mirror of the demo Slipstream mandate: gauge-staked position, depth KPI only.',
    },
    {
      id: MOCK_MM_BREACHED_ID,
      name: 'Demo Markets · Aerodrome AERO/USDC',
      poolId: MOCK_MM_BREACHED_POOL,
      marketMaker: 'Demo Markets',
      addresses: [...MOCK_MM_OWNERS_AERO],
      kpis: {
        minDepthUsd: 25_000,
        bandPct: 2,
        maxSpreadBps: 40,
        spreadNotionalUsd: 10_000,
        targetUptime: 0.9,
      },
      alertWebhookUrl: null,
      alertAfterSamples: DEFAULT_ALERT_AFTER_SAMPLES,
      active: true,
      createdAt: now - 3 * DAY,
      notes: null,
    },
  ]
}

/** Ascending timestamps every `stepSeconds` over `spanSeconds`, ending at `now`. */
function series(now: number, spanSeconds: number, stepSeconds: number): number[] {
  const out: number[] = []
  for (let ts = now - spanSeconds; ts <= now; ts += stepSeconds) out.push(ts)
  return out
}

/** Small deterministic wobble so series are not flat: ±4 % around 1. */
function wobble(index: number): number {
  return 1 + 0.04 * Math.sin(index * 1.7)
}

/**
 * The block a timestamp is stamped with: the mock's latest block at `now`, one per 2 s before (the
 * spacing Base kept until Denim, five blocks a second since; the mock does not follow Base's
 * schedule).
 */
function blockAt(now: number, timestamp: number): bigint {
  return BigInt(LATEST_BLOCK) - BigInt(Math.floor((now - timestamp) / 2))
}

function sampleFor(mandate: Mandate, now: number, ts: number, attr: MmAttribution): MmSample {
  const { withinKpi, breaches } = evaluateKpis(attr, mandate.kpis)
  return {
    mandateId: mandate.id,
    poolId: mandate.poolId,
    blockNumber: blockAt(now, ts),
    timestamp: ts,
    attribution: attr,
    withinKpi,
    breaches,
  }
}

/** Slipstream positions: ~30 % of the pool's ±2 % weight, both sides well above $50k. */
function slipstreamAttribution(
  index: number,
  variant: 'ok' | 'breach' | 'unpriced',
): MmAttribution {
  const w = wobble(index)
  const poolDepth = 200_000 * w
  if (variant === 'unpriced') {
    return {
      method: 'positions',
      holdings: 2,
      shareOfPool: 0.3,
      depthUpUsd: null,
      depthDownUsd: null,
      poolDepthUpUsd: null,
      poolDepthDownUsd: null,
      spreadBps: null,
      poolSpreadBps: null,
    }
  }
  return {
    method: 'positions',
    holdings: 2,
    shareOfPool: 0.3,
    depthUpUsd: variant === 'breach' ? 60_000 : 60_000 * w,
    depthDownUsd: variant === 'breach' ? 42_000 : 58_000 * w,
    poolDepthUpUsd: poolDepth,
    poolDepthDownUsd: poolDepth,
    spreadBps: 22 * w,
    poolSpreadBps: 15 * w,
  }
}

/** Aerodrome v2 LP share: 12 % of the pool, which is far below the $25k KPI after the prefix. */
function aeroAttribution(index: number, ok: boolean): MmAttribution {
  const w = wobble(index)
  return {
    method: 'lp-share',
    holdings: 2,
    shareOfPool: ok ? 0.4 : 0.12,
    depthUpUsd: (ok ? 31_000 : 9_000) * w,
    depthDownUsd: (ok ? 30_000 : 8_800) * w,
    poolDepthUpUsd: 75_000 * w,
    poolDepthDownUsd: 75_000 * w,
    spreadBps: 36 * w,
    poolSpreadBps: 35 * w,
  }
}

/** Every sample of one mock mandate, ascending (unknown ids have none). */
export function mockMmSamples(now: number, mandate: Mandate): MmSample[] {
  if (mandate.id === MOCK_MM_OK_ID) {
    const out: MmSample[] = []
    for (const ts of series(now - 31 * DAY, 2 * HOUR, 2 * HOUR)) {
      out.push(sampleFor(mandate, now, ts, slipstreamAttribution(out.length, 'ok')))
    }
    series(now, 8 * DAY, 2 * HOUR).forEach((ts, index) => {
      const variant =
        index === MOCK_MM_UNPRICED_INDEX
          ? 'unpriced'
          : MOCK_MM_OK_BREACH_INDICES.includes(index)
            ? 'breach'
            : 'ok'
      out.push(sampleFor(mandate, now, ts, slipstreamAttribution(index, variant)))
    })
    return out
  }
  if (mandate.id === MOCK_MM_BREACHED_ID) {
    return series(now, 2 * DAY, 2 * HOUR).map((ts, index) =>
      sampleFor(mandate, now, ts, aeroAttribution(index, index < MOCK_MM_BREACHED_OK_PREFIX)),
    )
  }
  return []
}

/**
 * The scorecard DTO at `now`, like the API's `loadScorecard`: core's `summarizeScorecard` over
 * the samples of the last 30 days, bigints as decimal strings and the mandate in its public view.
 */
export function mockScorecard(
  mandate: Mandate,
  samples: readonly MmSample[],
  now: number,
): ScorecardSummaryDto {
  const from = now - SUMMARY_WINDOW_SECONDS
  const inWindow = samples.filter((s) => s.timestamp >= from && s.timestamp <= now)
  const summary = summarizeScorecard(mandate, inWindow, now)
  return toJsonSafe({ ...summary, mandate: toPublicMandate(summary.mandate) })
}
