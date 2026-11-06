/**
 * Deterministic builders for domain objects, exported for other packages' tests (the API and CLI
 * seed in-memory databases with them). Defaults use 2^100-scale bigints so storage fidelity is
 * exercised by every round-trip.
 */
import {
  type Address,
  CONCENTRATION_BAND_PCT,
  type ConcentrationBasis,
  type ConcentrationMetrics,
  DEFAULT_ALERT_AFTER_SAMPLES,
  DEFAULT_MANDATE_KPIS,
  DEPTH_LEVELS_PCT,
  type DepthLevel,
  type DepthLevelUsd,
  type GapMetrics,
  type HealthGrade,
  type HealthScore,
  type Mandate,
  type MmAlert,
  type MmAttribution,
  type MmSample,
  type PersistenceMetrics,
  type PoolMeta,
  type PoolReference,
  type PoolSnapshot,
  type Position,
  priceDeviationBps,
  SPREAD_NOTIONALS_USD,
  type SpreadPoint,
  type TokenInfo,
  type UnratedReason,
  type VolumeBucket,
} from '@depthwatch/core'
import type { PoolScore } from './repos/scores.js'

export const FIXTURE_WETH: TokenInfo = {
  address: '0x4200000000000000000000000000000000000006',
  symbol: 'WETH',
  name: 'Wrapped Ether',
  decimals: 18,
}
export const FIXTURE_USDC: TokenInfo = {
  address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
}
export const FIXTURE_AERO: TokenInfo = {
  address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
  symbol: 'AERO',
  name: 'Aerodrome',
  decimals: 18,
}

export const FIXTURE_BIG = 2n ** 100n

export function fixtureToken(overrides: Partial<TokenInfo> = {}): TokenInfo {
  return { ...FIXTURE_WETH, ...overrides }
}

export function fixtureAddress(seed: number): Address {
  return `0x${seed.toString(16).padStart(40, '0')}`
}

export function fixturePool(overrides: Partial<PoolMeta> = {}): PoolMeta {
  const dex = overrides.dex ?? 'uniswap-v3'
  const address = overrides.address === undefined ? fixtureAddress(1) : overrides.address
  const poolId = overrides.poolId ?? null
  const id = overrides.id ?? `${dex}:${address ?? poolId ?? 'unknown'}`
  return {
    kind: 'concentrated',
    token0: FIXTURE_WETH,
    token1: FIXTURE_USDC,
    feePips: 500,
    tickSpacing: 10,
    stable: false,
    hooks: null,
    createdAtBlock: 10_000_000n,
    ...overrides,
    id,
    dex,
    address,
    poolId,
  }
}

export function fixtureDepth(scale: bigint = FIXTURE_BIG): DepthLevel[] {
  return DEPTH_LEVELS_PCT.map((pct) => {
    const unit = scale * BigInt(pct)
    return {
      pct,
      up: { amountIn: unit, amountOut: unit / 2n, reached: true },
      down: { amountIn: unit + 1n, amountOut: unit / 3n, reached: pct < 5 },
    }
  })
}

/** USD depth ladder centred on the ±2 % total; null yields an unpriced ladder. */
export function fixtureDepthUsd(depth2Usd: number | null): DepthLevelUsd[] {
  return DEPTH_LEVELS_PCT.map((pct) => {
    if (depth2Usd === null) return { pct, upUsd: null, downUsd: null, totalUsd: null }
    const total = (depth2Usd * pct) / 2
    return { pct, upUsd: total / 2, downUsd: total / 2, totalUsd: total }
  })
}

export function fixtureSpreads(spread10kBps: number | null): SpreadPoint[] {
  return SPREAD_NOTIONALS_USD.map((notionalUsd) => {
    if (spread10kBps === null) {
      return {
        notionalUsd,
        spreadBps: null,
        feasible: false,
        buyAvgPrice: null,
        sellAvgPrice: null,
      }
    }
    const spreadBps = (spread10kBps * notionalUsd) / 10_000
    return { notionalUsd, spreadBps, feasible: true, buyAvgPrice: 3000.5, sellAvgPrice: 2999.5 }
  })
}

export function fixtureConcentration(ownerTop1Share: number | null): ConcentrationMetrics {
  return {
    bandPct: CONCENTRATION_BAND_PCT,
    rangeHhi: 0.25,
    activeRangeShare: 0.6,
    owners:
      ownerTop1Share === null
        ? null
        : {
            count: 12,
            top1Share: ownerTop1Share,
            top3Share: Math.min(1, ownerTop1Share * 2),
            hhi: 0.2,
            coverage: 0.95,
          },
  }
}

export interface SnapshotFixtureOverrides extends Partial<PoolSnapshot> {
  depth2Usd?: number | null
  spread10kBps?: number | null
  ownerTop1Share?: number | null
}

export function fixtureSnapshot(overrides: SnapshotFixtureOverrides = {}): PoolSnapshot {
  const { depth2Usd = 250_000, spread10kBps = 12, ownerTop1Share = 0.4, ...rest } = overrides
  const snapshot: Omit<PoolSnapshot, 'priceDeviationBps'> = {
    poolId: fixturePool().id,
    blockNumber: 20_000_000n,
    timestamp: 1_700_000_000,
    price: 3000.25,
    token0Usd: 3000.25,
    token1Usd: 1,
    tvlUsd: 1_000_000,
    activeLiquidity: FIXTURE_BIG + 5n,
    depth: fixtureDepth(),
    depthUsd: fixtureDepthUsd(depth2Usd),
    spreads: fixtureSpreads(spread10kBps),
    concentration: fixtureConcentration(ownerTop1Share),
    // The fee of `fixturePool()`, which the snapshot's depth and spread would have used.
    feePips: 500,
    // `fixturePool()` holds no stock.
    reference: null,
    ...rest,
  }
  // Core's measure of the fixture's own price and USD prices unless the overrides name one.
  const deviation =
    rest.priceDeviationBps !== undefined
      ? rest.priceDeviationBps
      : priceDeviationBps(snapshot.price, snapshot.token0Usd, snapshot.token1Usd)
  return { ...snapshot, priceDeviationBps: deviation }
}

/**
 * A stock pool's reference: the worked example of docs/METRICS.md, "The pool's USD price and the
 * deviation" (a 0.05 % pool at $200.00 against a live $199.50 read 1,800 s ago: +25.06 bps, within
 * the 55 bps tolerance), transfers not paused.
 */
export function fixturePoolReference(overrides: Partial<PoolReference> = {}): PoolReference {
  return {
    stock: fixtureAddress(0xb20),
    poolUsd: 200,
    referenceUsd: 199.5,
    referenceStatus: 'live',
    feedAgeSeconds: 1_800,
    deviationBps: (200 / 199.5 - 1) * 10_000,
    toleranceBps: 55,
    deviationThresholdBps: 50,
    feeBps: 5,
    withinTolerance: true,
    deviationNull: null,
    transfersPaused: false,
    ...overrides,
  }
}

export function healthGrade(total: number): HealthGrade {
  if (total >= 80) return 'A'
  if (total >= 65) return 'B'
  if (total >= 50) return 'C'
  if (total >= 35) return 'D'
  return 'F'
}

/** A rated pool unless `unratedReason` names why not (then the grade is null, the total kept). */
export function fixtureHealth(
  total = 72,
  notes: string[] = [],
  unratedReason: UnratedReason | null = null,
  concentrationBasis: ConcentrationBasis = 'owners',
): HealthScore {
  return {
    total,
    grade: unratedReason === null ? healthGrade(total) : null,
    rated: unratedReason === null,
    unratedReason,
    concentrationBasis,
    components: {
      depth: total * 0.35,
      spread: total * 0.25,
      concentration: total * 0.2,
      persistence: total * 0.2,
    },
    notes,
  }
}

export function fixturePersistence(windowHours: number, samples = 5): PersistenceMetrics {
  if (samples < 3) {
    return {
      windowHours,
      samples,
      depthUsdMedian: null,
      depthUsdP10: null,
      depthUsdMin: null,
      stability: null,
      uptime: null,
    }
  }
  return {
    windowHours,
    samples,
    depthUsdMedian: 250_000,
    depthUsdP10: 200_000,
    depthUsdMin: 150_000,
    stability: 0.8,
    uptime: 1,
  }
}

export function fixtureGap(
  volume24hUsd: number | null,
  depth2Usd: number | null,
  gapScore: number | null = null,
): GapMetrics {
  const turnoverRatio =
    volume24hUsd !== null && depth2Usd !== null && depth2Usd > 0 ? volume24hUsd / depth2Usd : null
  return { volume24hUsd, depth2Usd, turnoverRatio, gapScore }
}

export interface ScoreFixtureOverrides extends Partial<PoolScore> {
  healthTotal?: number
  gapScore?: number | null
  /** Makes the pool unrated for this reason; rated when absent or null. */
  unratedReason?: UnratedReason | null
}

export function fixtureScore(overrides: ScoreFixtureOverrides = {}): PoolScore {
  const { healthTotal = 72, gapScore = null, unratedReason = null, ...rest } = overrides
  const volume24hUsd = rest.volume24hUsd === undefined ? 50_000 : rest.volume24hUsd
  const depth2Usd = rest.depth2Usd === undefined ? 250_000 : rest.depth2Usd
  return {
    poolId: fixturePool().id,
    timestamp: 1_700_000_000,
    health: fixtureHealth(healthTotal, [], unratedReason),
    gap: fixtureGap(volume24hUsd, depth2Usd, gapScore),
    persistence24h: fixturePersistence(24),
    persistence7d: fixturePersistence(168),
    ...rest,
    volume24hUsd,
    depth2Usd,
  }
}

export function fixtureBucket(overrides: Partial<VolumeBucket> = {}): VolumeBucket {
  return {
    poolId: fixturePool().id,
    hourStart: 1_700_000_000 - (1_700_000_000 % 3600),
    volumeToken0: FIXTURE_BIG,
    volumeToken1: FIXTURE_BIG * 3n,
    volumeUsd: 12_345.5,
    swapCount: 42,
    ...overrides,
  }
}

export function fixturePosition(overrides: Partial<Position> = {}): Position {
  return {
    owner: fixtureAddress(0xabc),
    tickLower: -887_220,
    tickUpper: 887_220,
    liquidity: FIXTURE_BIG,
    tokenId: 1n,
    ...overrides,
  }
}

/** Block number above 2^32 so block round-trips exercise the TEXT column path. */
export const FIXTURE_MM_BLOCK = 2n ** 40n

export const FIXTURE_MM_OWNER: Address = fixtureAddress(0x1111)

export function fixtureMandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    id: 'demo-weth-usdc',
    name: 'Demo WETH/USDC mandate',
    poolId: fixturePool().id,
    marketMaker: 'Demo Markets',
    addresses: [FIXTURE_MM_OWNER],
    kpis: { minDepthUsd: 50_000, ...DEFAULT_MANDATE_KPIS },
    alertWebhookUrl: null,
    alertAfterSamples: DEFAULT_ALERT_AFTER_SAMPLES,
    active: true,
    createdAt: 1_700_000_000,
    notes: null,
    ...overrides,
  }
}

export function fixtureAttribution(overrides: Partial<MmAttribution> = {}): MmAttribution {
  return {
    method: 'positions',
    holdings: 2,
    shareOfPool: 0.25,
    depthUpUsd: 80_000,
    depthDownUsd: 75_000,
    poolDepthUpUsd: 320_000,
    poolDepthDownUsd: 300_000,
    spreadBps: 8.5,
    poolSpreadBps: 4.25,
    ...overrides,
  }
}

export function fixtureMmSample(overrides: Partial<MmSample> = {}): MmSample {
  return {
    mandateId: fixtureMandate().id,
    poolId: fixturePool().id,
    blockNumber: FIXTURE_MM_BLOCK + 1n,
    timestamp: 1_700_000_000,
    attribution: fixtureAttribution(),
    withinKpi: true,
    breaches: [],
    ...overrides,
  }
}

export function fixtureMmAlert(overrides: Partial<MmAlert> = {}): MmAlert {
  return {
    mandateId: fixtureMandate().id,
    timestamp: 1_700_000_000,
    kind: 'breach',
    streakSamples: DEFAULT_ALERT_AFTER_SAMPLES,
    payload: {
      event: 'breach',
      mandateId: fixtureMandate().id,
      blockNumber: (FIXTURE_MM_BLOCK + 1n).toString(),
      breaches: ['depthUp'],
    },
    delivered: true,
    responseStatus: 200,
    error: null,
    ...overrides,
  }
}
