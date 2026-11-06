/**
 * Builders for realistic snapshot / score / volume fixtures used by `seed.ts`.
 *
 * Human inputs (USD figures, prices) are numbers; raw token amounts are derived once, at the edge,
 * with `humanToRaw` and kept as bigints from then on.
 */
import {
  type ConcentrationMetrics,
  DEPTH_LEVELS_PCT,
  type DepthLevel,
  type DepthLevelUsd,
  type GapMetrics,
  type PersistenceMetrics,
  type PoolMeta,
  type PoolSnapshot,
  priceDeviationBps,
  SPREAD_NOTIONALS_USD,
  type SpreadPoint,
  type VolumeBucket,
} from '@depthwatch/core'

/**
 * Converts a human amount into raw units: 15 significant decimal digits (which rounds away binary
 * float noise such as 0.1 → 0.1000…06) shifted by `decimals` with integer arithmetic only.
 */
export function humanToRaw(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`humanToRaw: bad amount ${value}`)
  const [mantissa = '0', exponent = '0'] = value.toExponential(14).split('e')
  const digits = BigInt(mantissa.replace('.', ''))
  const shift = Number(exponent) - 14 + decimals
  return shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift)
}

export interface LadderSpec {
  /** token1 per token0, human. */
  price: number
  decimals0: number
  decimals1: number
  token0Usd: number | null
  token1Usd: number | null
  /** Total (up + down) depth at ±2 % in USD; null for unpriced pools. */
  depth2Usd: number | null
  /** Human token1 absorbed on the way up 2 %; derived from depth2Usd when priced. */
  depth2Token1?: number
}

function depth2Token1(spec: LadderSpec): number {
  if (spec.depth2Usd !== null && spec.token1Usd !== null) return spec.depth2Usd / 2 / spec.token1Usd
  if (spec.depth2Token1 !== undefined) return spec.depth2Token1
  throw new RangeError('ladder: unpriced ladders need depth2Token1')
}

/** Raw depth ladder: amounts scale linearly with the percent move around the ±2 % anchor. */
export function buildDepth(spec: LadderSpec): DepthLevel[] {
  const base1 = depth2Token1(spec)
  return DEPTH_LEVELS_PCT.map((pct) => {
    const token1Up = (base1 * pct) / 2
    const token0Down = token1Up / spec.price
    return {
      pct,
      up: {
        amountIn: humanToRaw(token1Up, spec.decimals1),
        amountOut: humanToRaw(token1Up / spec.price / (1 + pct / 200), spec.decimals0),
        reached: true,
      },
      down: {
        amountIn: humanToRaw(token0Down, spec.decimals0),
        amountOut: humanToRaw(token0Down * spec.price * (1 - pct / 200), spec.decimals1),
        reached: true,
      },
    }
  })
}

/** USD ladder consistent with `buildDepth`; exact at ±2 % so tests can compare directly. */
export function buildDepthUsd(spec: LadderSpec): DepthLevelUsd[] {
  return DEPTH_LEVELS_PCT.map((pct) => {
    if (spec.depth2Usd === null) return { pct, upUsd: null, downUsd: null, totalUsd: null }
    const half = (spec.depth2Usd * pct) / 4
    const upUsd = spec.token1Usd === null ? null : half
    const downUsd = spec.token0Usd === null ? null : half
    const totalUsd = upUsd !== null && downUsd !== null ? upUsd + downUsd : (upUsd ?? downUsd)
    return { pct, upUsd, downUsd, totalUsd }
  })
}

/** Spread curve anchored on the $10k figure; notionals above `maxFeasibleUsd` are infeasible. */
export function buildSpreads(
  price: number,
  spread10kBps: number | null,
  maxFeasibleUsd = Number.POSITIVE_INFINITY,
): SpreadPoint[] {
  const scale: Record<number, number> = { 1000: 0.6, 10000: 1, 100000: 3.5 }
  return SPREAD_NOTIONALS_USD.map((notionalUsd) => {
    if (spread10kBps === null || notionalUsd > maxFeasibleUsd) {
      return {
        notionalUsd,
        spreadBps: null,
        feasible: false,
        buyAvgPrice: null,
        sellAvgPrice: null,
      }
    }
    const spreadBps = spread10kBps * (scale[notionalUsd] ?? 1)
    return {
      notionalUsd,
      spreadBps,
      feasible: true,
      buyAvgPrice: price * (1 + spreadBps / 20_000),
      sellAvgPrice: price * (1 - spreadBps / 20_000),
    }
  })
}

export function buildConcentration(
  kind: PoolMeta['kind'],
  ownerTop1Share: number | null,
): ConcentrationMetrics {
  const concentrated = kind === 'concentrated'
  return {
    bandPct: 5,
    rangeHhi: concentrated ? 0.28 : 1,
    activeRangeShare: concentrated ? 0.64 : 1,
    owners:
      ownerTop1Share === null
        ? null
        : {
            count: 9,
            top1Share: ownerTop1Share,
            top3Share: Math.min(1, ownerTop1Share * 1.6),
            hhi: Math.min(1, ownerTop1Share ** 2 + 0.05),
            coverage: 0.96,
          },
  }
}

export interface SnapshotSpec extends LadderSpec {
  pool: PoolMeta
  timestamp: number
  blockNumber: bigint
  tvlUsd: number | null
  spread10kBps: number | null
  /** Largest spread notional that is feasible (default: all). */
  maxFeasibleUsd?: number
  ownerTop1Share: number | null
  /** Human token1 amount of active liquidity proxy (concentrated pools only). */
  activeLiquidity?: bigint
  /** The LP fee the snapshot used (default: the pool's `feePips`); null for a row stored before it. */
  feePips?: number | null
}

export function buildSnapshot(spec: SnapshotSpec): PoolSnapshot {
  return {
    poolId: spec.pool.id,
    blockNumber: spec.blockNumber,
    timestamp: spec.timestamp,
    price: spec.price,
    token0Usd: spec.token0Usd,
    token1Usd: spec.token1Usd,
    tvlUsd: spec.tvlUsd,
    activeLiquidity: spec.activeLiquidity ?? 0n,
    feePips: spec.feePips === undefined ? spec.pool.feePips : spec.feePips,
    depth: buildDepth(spec),
    depthUsd: buildDepthUsd(spec),
    spreads: buildSpreads(spec.price, spec.spread10kBps, spec.maxFeasibleUsd),
    concentration: buildConcentration(spec.pool.kind, spec.ownerTop1Share),
    priceDeviationBps: priceDeviationBps(spec.price, spec.token0Usd, spec.token1Usd),
    // No pool of the seed holds a stock.
    reference: null,
  }
}

/** Persistence metrics around a median depth; nulls below three samples, as in core. */
export function buildPersistence(
  windowHours: number,
  samples: number,
  medianDepthUsd: number | null,
): PersistenceMetrics {
  if (samples < 3 || medianDepthUsd === null) {
    return {
      windowHours,
      samples,
      depthUsdMedian: medianDepthUsd,
      depthUsdP10: null,
      depthUsdMin: null,
      stability: null,
      uptime: null,
    }
  }
  return {
    windowHours,
    samples,
    depthUsdMedian: medianDepthUsd,
    depthUsdP10: medianDepthUsd * 0.9,
    depthUsdMin: medianDepthUsd * 0.85,
    stability: 0.9,
    uptime: 1,
  }
}

/** DESIGN.md gap score: 100 · clamp(log10(volume / depth) / 2, 0, 1); null when unknown. */
export function buildGap(volume24hUsd: number | null, depth2Usd: number | null): GapMetrics {
  if (volume24hUsd === null || depth2Usd === null || depth2Usd <= 0) {
    return { volume24hUsd, depth2Usd, turnoverRatio: null, gapScore: null }
  }
  const turnoverRatio = volume24hUsd / depth2Usd
  const gapScore = 100 * Math.min(1, Math.max(0, Math.log10(turnoverRatio) / 2))
  return { volume24hUsd, depth2Usd, turnoverRatio, gapScore }
}

export interface BucketSpec {
  pool: PoolMeta
  /** Hour the newest bucket starts at (unix seconds, aligned). */
  latestHourStart: number
  hours: number
  volume24hUsd: number | null
  price: number
  token0Usd: number | null
  token1Usd: number | null
  /** Human token1 volume per hour for unpriced pools. */
  hourlyToken1?: number
}

/** `hours` hourly buckets ending at `latestHourStart`, splitting the 24 h USD volume evenly. */
export function buildBuckets(spec: BucketSpec): VolumeBucket[] {
  const usdPerHour = spec.volume24hUsd === null ? null : spec.volume24hUsd / 24
  const token1PerHour =
    usdPerHour !== null && spec.token1Usd !== null
      ? usdPerHour / spec.token1Usd
      : (spec.hourlyToken1 ?? 0)
  const buckets: VolumeBucket[] = []
  for (let i = 0; i < spec.hours; i++) {
    buckets.push({
      poolId: spec.pool.id,
      hourStart: spec.latestHourStart - i * 3600,
      volumeToken0: humanToRaw(token1PerHour / spec.price, spec.pool.token0.decimals),
      volumeToken1: humanToRaw(token1PerHour, spec.pool.token1.decimals),
      volumeUsd: usdPerHour,
      swapCount: 10 + ((i * 7) % 13),
    })
  }
  return buckets
}
