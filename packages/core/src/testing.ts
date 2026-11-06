/**
 * Test helpers exported for every package's tests: deterministic pool builders, stock builders and
 * a brute-force reference simulator (many tiny exact-in swaps applied one after another).
 */

import { WAD } from './math.js'
import { aggregatePositionTicks, type PositionLiquidity } from './positionTicks.js'
import type { StockFeedInfo, StockInfo, StockRawRead } from './stocks/types.js'
import { liquidityAtTick } from './swap/concentrated.js'
import { simulateSwapExactIn } from './swap/index.js'
import { midPrice, type PriceDecimals, RAW_PRICE_DECIMALS } from './swap/midPrice.js'
import { getSqrtRatioAtTick, getTickAtSqrtRatio, priceToSqrtPriceX96 } from './tickMath.js'
import type {
  Address,
  ConcentratedState,
  ConstantProductState,
  PoolState,
  StableSwapState,
  SwapDirection,
  SwapResult,
  TokenInfo,
} from './types.js'

/** Tick range + liquidity of a test position (the same shape `aggregatePositionTicks` takes). */
export type TestPosition = PositionLiquidity

export interface BuildConcentratedOptions {
  positions: TestPosition[]
  tick: number
  feePips: number
  tickSpacing: number
  blockNumber?: bigint
  timestamp?: number
  /** Exact sqrt price; must lie in [ratio(tick), ratio(tick + 1)). Defaults to ratio(tick). */
  sqrtPriceX96?: bigint
  /** Known tick bounds; default to the extreme position ticks (and the current tick). */
  tickLowerBound?: number
  tickUpperBound?: number
}

/**
 * Aggregates positions into initialised ticks and active liquidity like the pool contract
 * (via `aggregatePositionTicks`, shared with the market-maker attribution).
 */
export function buildConcentratedState(opts: BuildConcentratedOptions): ConcentratedState {
  const { ticks, liquidity, minTick, maxTick } = aggregatePositionTicks(opts.positions, opts.tick)
  const sqrtPriceX96 = opts.sqrtPriceX96 ?? getSqrtRatioAtTick(opts.tick)
  if (getTickAtSqrtRatio(sqrtPriceX96) !== opts.tick)
    throw new RangeError('sqrtPriceX96 is not inside the given tick')
  return {
    kind: 'concentrated',
    blockNumber: opts.blockNumber ?? 1n,
    timestamp: opts.timestamp ?? 1_700_000_000,
    sqrtPriceX96,
    tick: opts.tick,
    liquidity,
    feePips: opts.feePips,
    tickSpacing: opts.tickSpacing,
    ticks,
    tickLowerBound: opts.tickLowerBound ?? minTick,
    tickUpperBound: opts.tickUpperBound ?? maxTick,
  }
}

export function buildConstantProductState(
  reserve0: bigint,
  reserve1: bigint,
  feePips: number,
  extra: { blockNumber?: bigint; timestamp?: number } = {},
): ConstantProductState {
  return {
    kind: 'constant-product',
    blockNumber: extra.blockNumber ?? 1n,
    timestamp: extra.timestamp ?? 1_700_000_000,
    reserve0,
    reserve1,
    feePips,
  }
}

export function buildStableSwapState(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number,
  feePips: number,
  extra: { blockNumber?: bigint; timestamp?: number } = {},
): StableSwapState {
  return {
    kind: 'stable-swap',
    blockNumber: extra.blockNumber ?? 1n,
    timestamp: extra.timestamp ?? 1_700_000_000,
    reserve0,
    reserve1,
    decimals0,
    decimals1,
    feePips,
  }
}

/** A TokenInfo with a deterministic fake address derived from the symbol. */
export function makeToken(symbol: string, decimals: number, address?: Address): TokenInfo {
  const hex = [...symbol.toLowerCase()]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
  return {
    address: address ?? (`0x${hex.padEnd(40, '0').slice(0, 40)}` as Address),
    symbol,
    name: symbol,
    decimals,
  }
}

/** 40 hex digits: `prefix`, then the symbol's characters in hex, padded with zeros. */
function symbolAddress(prefix: string, symbol: string): Address {
  const hex = [...symbol.toLowerCase()].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
  return `0x${(prefix + hex.join('')).padEnd(40, '0').slice(0, 40)}` as Address
}

/**
 * A stock of the stock list: an 8-decimal token at `0xb2…` (after USDC's and WETH's addresses, as
 * the B20 precompiles are) with a 24/5 feed of 8 decimals, a 86,400 s heartbeat and a 50 bps
 * threshold, as the ten feeds have. The ticker is the symbol less a trailing "c"; `feed: null` is a
 * stock without a feed.
 */
export function makeStock(
  symbol: string,
  opts: { address?: Address; feed?: Partial<StockFeedInfo> | null } = {},
): StockInfo {
  const feed: StockFeedInfo | null =
    opts.feed === null
      ? null
      : {
          address: symbolAddress('fe', symbol),
          decimals: 8,
          heartbeatSeconds: 86_400,
          deviationThresholdBps: 50,
          hours: '24/5',
          ...opts.feed,
        }
  return {
    token: makeToken(symbol, 8, opts.address ?? symbolAddress('b2', symbol)),
    ticker: symbol.replace(/c$/, ''),
    feed,
  }
}

/**
 * The answers of a sound reading of `stock` at a block: its feed's decimals and description, the
 * oracle registry unpaused, both multipliers 1 (WAD) and no feature paused; `overrides` replace any.
 */
export function stockRawRead(
  stock: StockInfo,
  answer: bigint,
  updatedAt: number,
  overrides: Partial<StockRawRead> = {},
): StockRawRead {
  return {
    roundId: 1n,
    answer,
    updatedAt,
    decimals: stock.feed?.decimals ?? 8,
    description: `Coinbase ${stock.ticker}`,
    oracleMultiplierWad: WAD,
    oraclePaused: false,
    tokenMultiplierWad: WAD,
    pausedOrdinals: [],
    ...overrides,
  }
}

/** The pool state after a simulated swap has been executed (fees leave reserve pools). */
export function applySwap(state: PoolState, result: SwapResult): PoolState {
  switch (state.kind) {
    case 'concentrated': {
      const sqrtPriceX96 = result.sqrtPriceAfterX96 ?? state.sqrtPriceX96
      const tick = result.tickAfter ?? state.tick
      return { ...state, sqrtPriceX96, tick, liquidity: liquidityAtTick(state, tick) }
    }
    case 'constant-product':
    case 'stable-swap': {
      const net = result.amountIn - result.feePaid
      return result.direction === 'zeroForOne'
        ? { ...state, reserve0: state.reserve0 + net, reserve1: state.reserve1 - result.amountOut }
        : { ...state, reserve0: state.reserve0 - result.amountOut, reserve1: state.reserve1 + net }
    }
  }
}

function samePrice(a: PoolState, b: PoolState): boolean {
  if (a.kind === 'concentrated' && b.kind === 'concentrated')
    return a.sqrtPriceX96 === b.sqrtPriceX96
  if (a.kind !== 'concentrated' && b.kind !== 'concentrated')
    return a.reserve0 === b.reserve0 && a.reserve1 === b.reserve1
  return false
}

export interface BruteForceResult {
  direction: SwapDirection
  amountIn: bigint
  amountOut: bigint
  feePaid: bigint
  steps: number
  /** False when a step could not be fully consumed (liquidity or bounds exhausted). */
  complete: boolean
  finalState: PoolState
}

/**
 * Reference swap-to-price: applies `stepAmountIn` exact-in swaps one after another until the
 * pool's price passes `targetPrice` (human, converted with `decimals` like simulateSwapToPrice).
 * Overshoots the target by at most one step. Throws after `maxSteps`.
 */
export function bruteForceSwapToPrice(
  state: PoolState,
  targetPrice: number,
  stepAmountIn: bigint,
  decimals: PriceDecimals = RAW_PRICE_DECIMALS,
  maxSteps = 100_000,
): BruteForceResult {
  if (stepAmountIn <= 0n) throw new RangeError('bruteForceSwapToPrice: step must be > 0')
  const d =
    state.kind === 'stable-swap'
      ? { decimals0: state.decimals0, decimals1: state.decimals1 }
      : decimals
  const start = midPrice(state, d.decimals0, d.decimals1)
  const direction: SwapDirection = targetPrice > start ? 'oneForZero' : 'zeroForOne'
  const targetSqrt =
    state.kind === 'concentrated' ? priceToSqrtPriceX96(targetPrice, d.decimals0, d.decimals1) : 0n
  const passed = (s: PoolState): boolean => {
    if (s.kind === 'concentrated')
      return direction === 'oneForZero'
        ? s.sqrtPriceX96 >= targetSqrt
        : s.sqrtPriceX96 <= targetSqrt
    const p = midPrice(s, d.decimals0, d.decimals1)
    return direction === 'oneForZero' ? p >= targetPrice : p <= targetPrice
  }
  let current = state
  let amountIn = 0n
  let amountOut = 0n
  let feePaid = 0n
  let steps = 0
  let complete = true
  while (!passed(current)) {
    if (steps >= maxSteps) throw new Error(`bruteForceSwapToPrice: exceeded ${maxSteps} steps`)
    const r = simulateSwapExactIn(current, direction, stepAmountIn)
    amountIn += r.amountIn
    amountOut += r.amountOut
    feePaid += r.feePaid
    steps++
    if (!r.complete) {
      complete = false
      break
    }
    const next = applySwap(current, r)
    if (r.amountOut === 0n && samePrice(current, next))
      throw new Error('bruteForceSwapToPrice: step too small to move the price (eaten by the fee)')
    current = next
  }
  return { direction, amountIn, amountOut, feePaid, steps, complete, finalState: current }
}
