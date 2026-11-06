/**
 * Swap logs of the synthetic world.
 *
 * - Static world: a day's swaps spread over the 24 h before latest; sizes vary around the pool's
 *   average trade (`swapLogs`).
 * - Time-varying world: swaps are planned per pool and absolute hour (`plannedSwaps`): the count
 *   and volume follow `volumeFactor` (UTC daily pattern × noise) around the pool's daily
 *   average, blocks fall inside the hour but never on its first block (reserved for LP
 *   rebalances). A fixture carries the swaps of the 24 h before its epoch (`swapWindowHours`).
 *
 * `logIndex` is unique per (address, block): the swap's ordinal in the window (static) or in its
 * hour (time-varying), so the derived tx hashes stay unique too.
 */
import type { Address, Hex, PoolMeta } from '@depthwatch/core'
import { aerodromePoolAbi } from '../abi/aerodromePool.js'
import { uniswapV3PoolAbi } from '../abi/uniswapV3Pool.js'
import { v4PoolManagerAbi } from '../abi/v4PoolManager.js'
import type { ChainAddresses } from '../addresses.js'
import type { FixtureLog } from '../transport/fixture.js'
import { makeLog } from './builders.js'
import type { ConcentratedSpec, V2Spec } from './syntheticBuild.js'
import {
  assetOf,
  blockAtOrAfter,
  HOUR_SECONDS,
  hourOf,
  priceFactor,
  SYNTHETIC_HISTORY,
  unitNoise,
  volumeFactor,
} from './syntheticTime.js'
import {
  prng,
  SYNTHETIC_ROUTER,
  type SyntheticActivity,
  type SyntheticPool,
  type SyntheticTimeline,
  type SyntheticWorld,
} from './syntheticTypes.js'

/**
 * Blocks per hour of the synthetic world's 2 s blocks (Base's before Denim; 18 000 an hour since)
 * and the in-hour offsets swaps may use (1 … 1798).
 */
const BLOCKS_PER_HOUR = HOUR_SECONDS / 2
const SWAP_OFFSETS = BLOCKS_PER_HOUR - 2

export function rawAmount(usd: number, tokenUsd: number, decimals: number): bigint {
  return (BigInt(Math.round((usd / tokenUsd) * 1e6)) * 10n ** BigInt(decimals)) / 1_000_000n
}

/** The pool's price state a v3 / v4 `Swap` log reports (after the swap). */
export interface SwapPriceState {
  sqrtPriceX96: bigint
  liquidity: bigint
  tick: number
}

export interface SwapLogInput {
  /** USD value of the input side. */
  usd: number
  zeroForOne: boolean
  token0Usd: number
  token1Usd: number
  blockNumber: bigint
  logIndex: number
  txIndex: number
  /** Concentrated pools only (v3, Slipstream, Aero Slipstream, v4). */
  price: SwapPriceState | null
}

/** Aero Slipstream pools emit Uniswap v3's `Swap`, Aero v2 pools Aerodrome v2's (kind 'v2'). */
type SwapPoolKind = 'v2' | 'v3' | 'slipstream' | 'aero-slipstream' | 'v4'

/** One `Swap` log as the pool's DEX emits it. */
export function swapLog(
  meta: PoolMeta,
  kind: SwapPoolKind,
  addresses: ChainAddresses,
  input: SwapLogInput,
): FixtureLog {
  const { zeroForOne, blockNumber, logIndex, txIndex } = input
  const in0 = rawAmount(input.usd, input.token0Usd, meta.token0.decimals)
  const in1 = rawAmount(input.usd * (1 - meta.feePips / 1e6), input.token1Usd, meta.token1.decimals)
  // Pool perspective: positive = received by the pool.
  const amount0 = zeroForOne ? in0 : -in0
  const amount1 = zeroForOne ? -in1 : in1
  if (kind === 'v2')
    return makeLog({
      address: meta.address as Address,
      abi: aerodromePoolAbi,
      eventName: 'Swap',
      args: {
        sender: SYNTHETIC_ROUTER,
        to: SYNTHETIC_ROUTER,
        amount0In: zeroForOne ? in0 : 0n,
        amount1In: zeroForOne ? 0n : in1,
        amount0Out: zeroForOne ? 0n : in0,
        amount1Out: zeroForOne ? in1 : 0n,
      },
      blockNumber,
      logIndex,
      txIndex,
    })
  const price = input.price
  if (price === null) throw new Error(`synthetic ${meta.id}: a concentrated swap needs a price`)
  if (kind === 'v4')
    return makeLog({
      address: addresses.uniswapV4.poolManager,
      abi: v4PoolManagerAbi,
      eventName: 'Swap',
      // Swapper perspective, as PoolManager emits it: negative = paid into the pool.
      args: {
        id: meta.poolId as Hex,
        sender: SYNTHETIC_ROUTER,
        amount0: -amount0,
        amount1: -amount1,
        sqrtPriceX96: price.sqrtPriceX96,
        liquidity: price.liquidity,
        tick: price.tick,
        fee: meta.feePips,
      },
      blockNumber,
      logIndex,
      txIndex,
    })
  return makeLog({
    address: meta.address as Address,
    abi: uniswapV3PoolAbi,
    eventName: 'Swap',
    args: {
      sender: SYNTHETIC_ROUTER,
      recipient: SYNTHETIC_ROUTER,
      amount0,
      amount1,
      sqrtPriceX96: price.sqrtPriceX96,
      liquidity: price.liquidity,
      tick: price.tick,
    },
    blockNumber,
    logIndex,
    txIndex,
  })
}

export function swapKind(pool: SyntheticPool): SwapPoolKind {
  return pool.kind === 'v2' ? 'v2' : pool.variant
}

/** Static world: ~24 h of swaps spread over the window before latest. */
export function swapLogs(
  world: SyntheticWorld,
  pool: SyntheticPool,
  addresses: ChainAddresses,
  seed: number,
): FixtureLog[] {
  const rand = prng(seed)
  const n = pool.swapCount
  const avgUsd = pool.volumeUsd / n
  const start = world.latestBlock - world.swapWindowBlocks
  const price = pool.kind === 'v2' ? null : pool.state
  const logs: FixtureLog[] = []
  for (let i = 0; i < n; i++) {
    const blockNumber =
      start + BigInt(Math.floor(((i + rand()) / n) * Number(world.swapWindowBlocks)))
    const usd = avgUsd * (0.3 + 1.4 * rand())
    const zeroForOne = rand() < 0.5
    logs.push(
      swapLog(pool.meta, swapKind(pool), addresses, {
        usd,
        zeroForOne,
        token0Usd: pool.token0Usd,
        token1Usd: pool.token1Usd,
        blockNumber,
        logIndex: i,
        txIndex: i,
        price,
      }),
    )
  }
  return logs
}

export interface PlannedSwap {
  blockNumber: bigint
  usd: number
  zeroForOne: boolean
  /** Ordinal within the hour (the log index). */
  index: number
}

type TimelineAnchor = Pick<SyntheticTimeline, 'seed' | 'anchorBlock' | 'anchorTimestamp'>

/** The swaps of pool `poolIndex` during `hour`, around its daily `activity`. */
export function plannedSwaps(
  timeline: TimelineAnchor,
  poolIndex: number,
  activity: SyntheticActivity,
  hour: number,
): PlannedSwap[] {
  const factor = volumeFactor(timeline.seed, poolIndex, hour)
  const rand = prng(Math.floor(unitNoise(timeline.seed, 50, poolIndex, hour) * 4_294_967_296))
  const count = Math.floor((activity.swapCount / 24) * factor + rand())
  if (count <= 0) return []
  const avgUsd = ((activity.volumeUsd / 24) * factor) / count
  const start = blockAtOrAfter(timeline, hour * HOUR_SECONDS)
  const out: PlannedSwap[] = []
  for (let index = 0; index < count; index++) {
    const offset = 1 + Math.floor(((index + rand()) / count) * SWAP_OFFSETS)
    out.push({
      blockNumber: start + BigInt(offset),
      usd: avgUsd * (0.3 + 1.4 * rand()),
      zeroForOne: rand() < 0.5,
      index,
    })
  }
  return out
}

/** Hours whose swaps a fixture at the epoch carries: the 24 h before it, in whole hours. */
export function swapWindowHours(timeline: SyntheticTimeline): number[] {
  const first = hourOf(timeline.epochTimestamp - SYNTHETIC_HISTORY.swapWindowSeconds)
  const hours: number[] = []
  for (let hour = first; hour <= timeline.epochHour; hour++) hours.push(hour)
  return hours
}

/** USD price of a pool's two tokens during `hour`. */
export function tokenUsdAt(
  timeline: Pick<SyntheticTimeline, 'seed'>,
  spec: ConcentratedSpec | V2Spec,
  hour: number,
): { token0Usd: number; token1Usd: number } {
  return {
    token0Usd:
      spec.activity.token0Usd * priceFactor(timeline.seed, assetOf(spec.token0.address), hour),
    token1Usd:
      spec.activity.token1Usd * priceFactor(timeline.seed, assetOf(spec.token1.address), hour),
  }
}

/** Activity of a time-varying pool: the swaps in the window up to the epoch, prices at the epoch. */
export function windowActivity(
  timeline: SyntheticTimeline,
  poolIndex: number,
  spec: ConcentratedSpec | V2Spec,
): SyntheticActivity {
  let volumeUsd = 0
  let swapCount = 0
  for (const hour of swapWindowHours(timeline))
    for (const swap of plannedSwaps(timeline, poolIndex, spec.activity, hour)) {
      if (swap.blockNumber > timeline.epochBlock) continue
      volumeUsd += swap.usd
      swapCount++
    }
  return { volumeUsd, swapCount, ...tokenUsdAt(timeline, spec, timeline.epochHour) }
}
