/**
 * Time dimension of the synthetic world (docs/design/web-v2.md §3). Every quantity is a pure
 * function of (seed, anchor, hour), so the time-varying world at an epoch is the state of the hour
 * the epoch falls in, and the logs before it (position mints, hourly rebalances, swaps) are the
 * same in every fixture that contains them: consecutive epochs read like one chain.
 *
 * - Liquidity: every LP position (and the LP supply of the other holders of each Aerodrome v2
 *   pool) follows its pool's daily cycle (6–12 % amplitude, seeded peak hour) plus seeded smooth
 *   noise (5–10 %), so it stays within ±22 % and changes on hour boundaries.
 * - Prices: ETH within ±2 % (the contract allows ±4 %), cbBTC ±2.5 %, AERO ±6 %, stablecoins
 *   fixed, as two seeded sinusoids (≈ 5.5 d and ≈ 1.5 d periods).
 * - Volume: per hour, a UTC daily pattern peaking at 15:00 (×0.5–1.5) times seeded noise
 *   (×0.7–1.3), around the pool's daily average.
 * - Scripted market-maker events, in hours before the anchor's hour (`SYNTHETIC_EVENTS`).
 */
import { type Address, NATIVE_ETH } from '@depthwatch/core'
import { TOKENS } from '../addresses.js'
import {
  SYNTHETIC_DEFAULTS,
  type SyntheticOptions,
  type SyntheticTimeline,
} from './syntheticTypes.js'

export const HOUR_SECONDS = 3_600

export const SYNTHETIC_HISTORY = Object.freeze({
  /** Oldest epoch a time-varying fixture serves: seven days of demo history plus a day. */
  maxAgeSeconds: 8 * 86_400,
  /** LP positions are minted this long before the anchor (before every epoch), then rebalanced. */
  mintAgeSeconds: 8 * 86_400 + 2 * HOUR_SECONDS,
  /** Swap logs a time-varying fixture carries: the 24 h before the epoch (whole hours). */
  swapWindowSeconds: 86_400,
})

/** Price drift amplitude per asset (fraction of the base price). */
export const SYNTHETIC_DRIFT = Object.freeze({ ETH: 0.02, BTC: 0.025, AERO: 0.06 })

/**
 * Scripted market-maker behaviour, in whole hours before the anchor's hour (`age`):
 * - USDC/AERO (`SYNTHETIC_OWNERS[0]`, the Aerodrome v2 pool): while in, it holds `inWalletPct` %
 *   of the pool's base LP supply in its wallet and `inStakedPct` % staked (8× its static 40 % +
 *   10 %); for the first `outHours` of every `cycleHours` (out at the anchor) it has pulled most
 *   of that back out and holds only the static world's 40 % + 10 %.
 * - Slipstream WETH/USDC (`SYNTHETIC_OWNERS[1]`, its staked [-300, 300] position): once, for the
 *   `hours` hours with `startAgeHours − hours < age ≤ startAgeHours`, it decreases the position
 *   to `keepPct` % of its liquidity, then restores it.
 */
export const SYNTHETIC_EVENTS = Object.freeze({
  aeroMarketMaker: Object.freeze({
    cycleHours: 30,
    outHours: 16,
    inWalletPct: 320,
    inStakedPct: 80,
  }),
  slipstreamMarketMaker: Object.freeze({ startAgeHours: 62, hours: 6, keepPct: 12 }),
})

export type SyntheticAsset = 'ETH' | 'BTC' | 'AERO' | 'USD'

const ASSET_STREAM: Readonly<Record<Exclude<SyntheticAsset, 'USD'>, number>> = Object.freeze({
  ETH: 1,
  BTC: 2,
  AERO: 3,
})

/** The asset whose price drift a synthetic token follows (stablecoins: none). */
export function assetOf(token: Address): SyntheticAsset {
  const address = token.toLowerCase()
  if (address === NATIVE_ETH || address === TOKENS.WETH.address) return 'ETH'
  if (address === TOKENS.CBBTC.address) return 'BTC'
  // Both AEROs, Aerodrome's and Aero's, follow one price stream.
  if (address === TOKENS.AERO_AERODROME.address || address === TOKENS.AERO.address) return 'AERO'
  return 'USD'
}

export function hourOf(timestamp: number): number {
  return Math.floor(timestamp / HOUR_SECONDS)
}

export interface SyntheticAnchor {
  anchorBlock: bigint
  anchorTimestamp: number
}

/**
 * First block whose timestamp is ≥ `timestamp` (2 s blocks back from the anchor: the synthetic
 * world keeps Base's pre-Denim spacing, syntheticTypes.ts).
 */
export function blockAtOrAfter(anchor: SyntheticAnchor, timestamp: number): bigint {
  const back = Math.floor((anchor.anchorTimestamp - timestamp) / SYNTHETIC_DEFAULTS.secondsPerBlock)
  return anchor.anchorBlock - BigInt(back)
}

export function timestampOfBlock(anchor: SyntheticAnchor, block: bigint): number {
  return (
    anchor.anchorTimestamp - Number(anchor.anchorBlock - block) * SYNTHETIC_DEFAULTS.secondsPerBlock
  )
}

/** Last block whose timestamp is ≤ `timestamp`. */
function blockAtOrBefore(anchor: SyntheticAnchor, timestamp: number): bigint {
  const back = Math.ceil((anchor.anchorTimestamp - timestamp) / SYNTHETIC_DEFAULTS.secondsPerBlock)
  return anchor.anchorBlock - BigInt(back)
}

/**
 * The time-varying world's clock for `opts`, or null for the static world (no epoch given).
 * Throws a RangeError for an epoch after the anchor, older than `SYNTHETIC_HISTORY.maxAgeSeconds`,
 * an `epochBlock` that disagrees with `epochTimestamp`, or an anchor too low to hold the history.
 */
export function resolveTimeline(opts: SyntheticOptions): SyntheticTimeline | null {
  if (opts.epochTimestamp === undefined && opts.epochBlock === undefined) return null
  const anchor: SyntheticAnchor = {
    anchorBlock: opts.latestBlock ?? SYNTHETIC_DEFAULTS.latestBlock,
    anchorTimestamp: opts.latestTimestamp ?? SYNTHETIC_DEFAULTS.latestTimestamp,
  }
  const seed = opts.seed ?? SYNTHETIC_DEFAULTS.seed
  if (!Number.isSafeInteger(seed)) throw new RangeError('synthetic: seed must be an integer')
  const historyBlocks = BigInt(
    Math.ceil(SYNTHETIC_HISTORY.mintAgeSeconds / SYNTHETIC_DEFAULTS.secondsPerBlock),
  )
  if (anchor.anchorBlock <= historyBlocks + 1n)
    throw new RangeError(`synthetic: latestBlock must be > ${historyBlocks + 1n} for an epoch`)
  let epochBlock: bigint
  if (opts.epochTimestamp !== undefined) {
    if (!Number.isSafeInteger(opts.epochTimestamp))
      throw new RangeError('synthetic: epochTimestamp must be an integer (unix seconds)')
    if (opts.epochTimestamp > anchor.anchorTimestamp)
      throw new RangeError('synthetic: the epoch must not lie after latestTimestamp')
    epochBlock = blockAtOrBefore(anchor, opts.epochTimestamp)
    if (opts.epochBlock !== undefined && opts.epochBlock !== epochBlock)
      throw new RangeError(
        `synthetic: epochBlock ${opts.epochBlock} is not the block of epochTimestamp (${epochBlock})`,
      )
  } else {
    epochBlock = opts.epochBlock as bigint
  }
  const epochTimestamp = timestampOfBlock(anchor, epochBlock)
  const oldest = anchor.anchorTimestamp - SYNTHETIC_HISTORY.maxAgeSeconds
  if (epochBlock > anchor.anchorBlock || epochTimestamp < oldest)
    throw new RangeError(
      `synthetic: the epoch must lie between ${oldest} and ${anchor.anchorTimestamp} (latest)`,
    )
  return { ...anchor, seed, epochBlock, epochTimestamp, epochHour: hourOf(epochTimestamp) }
}

function mix(h: number, x: number): number {
  let k = Math.imul(x | 0, 0xcc9e2d51)
  k = (k << 15) | (k >>> 17)
  k = Math.imul(k, 0x1b873593)
  const m = h ^ k
  return (Math.imul((m << 13) | (m >>> 19), 5) + 0xe6546b64) | 0
}

/** Deterministic uniform number in [0, 1) from integer parts (murmur3-style hash). */
export function unitNoise(...parts: number[]): number {
  let h = 0x9747b28c
  for (const part of parts) h = mix(h, part)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4_294_967_296
}

/** Value noise in [-1, 1]: seeded knots every 6 h, cosine-interpolated (smooth from hour to hour). */
export function smoothNoise(seed: number, stream: number, hour: number): number {
  const knot = Math.floor(hour / 6)
  const frac = (hour - knot * 6) / 6
  const a = unitNoise(seed, stream, knot) * 2 - 1
  const b = unitNoise(seed, stream, knot + 1) * 2 - 1
  const w = (1 - Math.cos(Math.PI * frac)) / 2
  return a + (b - a) * w
}

function hourOfDay(hour: number): number {
  return ((hour % 24) + 24) % 24
}

/** USD price multiplier of `asset` during `hour` (1 for stablecoins). */
export function priceFactor(seed: number, asset: SyntheticAsset, hour: number): number {
  if (asset === 'USD') return 1
  const stream = ASSET_STREAM[asset]
  const p1 = 2 * Math.PI * unitNoise(seed, 20, stream)
  const p2 = 2 * Math.PI * unitNoise(seed, 21, stream)
  const wave =
    0.65 * Math.sin((2 * Math.PI * hour) / 131 + p1) +
    0.35 * Math.sin((2 * Math.PI * hour) / 37 + p2)
  return 1 + SYNTHETIC_DRIFT[asset] * wave
}

/**
 * Liquidity multiplier of one LP (`stream`: the position index, or a v2 pool's other holders)
 * of pool `poolIndex` during `hour`: daily cycle plus noise, within [0.78, 1.22].
 */
export function liquidityFactor(
  seed: number,
  poolIndex: number,
  stream: number,
  hour: number,
): number {
  const amplitude = 0.06 + 0.06 * unitNoise(seed, 10, poolIndex)
  const noiseAmplitude = 0.05 + 0.05 * unitNoise(seed, 11, poolIndex)
  const peak = 24 * unitNoise(seed, 12, poolIndex)
  const daily = Math.cos((2 * Math.PI * (hourOfDay(hour) - peak)) / 24)
  const noise = smoothNoise(seed, 1_000 + poolIndex * 64 + stream, hour)
  return 1 + amplitude * daily + noiseAmplitude * noise
}

/** Volume multiplier of pool `poolIndex` during `hour` (mean ≈ 1 over a day). */
export function volumeFactor(seed: number, poolIndex: number, hour: number): number {
  const daily = 1 + 0.5 * Math.cos((2 * Math.PI * (hourOfDay(hour) - 15)) / 24)
  return daily * (0.7 + 0.6 * unitNoise(seed, 40, poolIndex, hour))
}

function ageHours(anchorTimestamp: number, hour: number): number {
  return hourOf(anchorTimestamp) - hour
}

/** True while the USDC/AERO market maker has pulled its LP (see `SYNTHETIC_EVENTS`). */
export function aeroMarketMakerOut(anchorTimestamp: number, hour: number): boolean {
  const { cycleHours, outHours } = SYNTHETIC_EVENTS.aeroMarketMaker
  const age = ageHours(anchorTimestamp, hour)
  return ((age % cycleHours) + cycleHours) % cycleHours < outHours
}

/** True during the Slipstream market maker's one dip (see `SYNTHETIC_EVENTS`). */
export function slipstreamMarketMakerDipped(anchorTimestamp: number, hour: number): boolean {
  const { startAgeHours, hours } = SYNTHETIC_EVENTS.slipstreamMarketMaker
  const age = ageHours(anchorTimestamp, hour)
  return age <= startAgeHours && age > startAgeHours - hours
}

export interface SyntheticEventState {
  aeroMarketMakerOut: boolean
  slipstreamMarketMakerDipped: boolean
}

/** The scripted events in force at `timestamp`, for the anchor `opts.latestTimestamp`. */
export function syntheticEventsAt(
  timestamp: number,
  opts: Pick<SyntheticOptions, 'latestTimestamp'> = {},
): SyntheticEventState {
  const anchorTimestamp = opts.latestTimestamp ?? SYNTHETIC_DEFAULTS.latestTimestamp
  const hour = hourOf(timestamp)
  return {
    aeroMarketMakerOut: aeroMarketMakerOut(anchorTimestamp, hour),
    slipstreamMarketMakerDipped: slipstreamMarketMakerDipped(anchorTimestamp, hour),
  }
}
