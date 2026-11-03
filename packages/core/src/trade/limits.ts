/**
 * Slippage, minimum output and deadline of a single-pool exact-input swap (docs/METRICS.md, "Swap
 * checks"). Pure bigint arithmetic on raw token amounts: decimals never enter, so a 6-, 8- or
 * 18-decimal token needs no special case.
 */

import { MAX_UINT256 } from '../math.js'

/** Basis-point denominator: 10 000 bps = 100 %. */
export const BPS_DENOMINATOR = 10_000n

/** Slippage tolerance when the user sets none: 50 bps (0.5 %). */
export const TRADE_DEFAULT_SLIPPAGE_BPS = 50

/**
 * The highest slippage tolerance any flag can allow: 300 bps (3 %). A flag's `maxSlippageBps`
 * above it is held to it, so raising the ceiling takes a code change, not a variable.
 */
export const TRADE_MAX_SLIPPAGE_BPS = 300

/**
 * The lowest tolerance accepted: 1 bps. A zero tolerance reverts on any movement between the quote
 * and the block that includes the swap, a dynamic fee's next reading included, so it can only cost
 * the user gas.
 */
export const TRADE_MIN_SLIPPAGE_BPS = 1

/** Seconds a signed swap stays valid after the latest block: 300 (five minutes). */
export const TRADE_DEADLINE_SECONDS = 300n

/** Size cap per swap at launch, in USD. The live value comes from the trade flags. */
export const TRADE_LAUNCH_MAX_USD = 1_000

/** Why a slippage tolerance was not accepted. */
export type SlippageRejection =
  /** The flag's `maxSlippageBps` is not an integer of at least TRADE_MIN_SLIPPAGE_BPS. */
  | 'max-invalid'
  /** Not a whole number of basis points (fractions, NaN, ±Infinity). */
  | 'not-integer'
  /** Below TRADE_MIN_SLIPPAGE_BPS. */
  | 'below-min'
  /** Above the ceiling (`maxBps`). */
  | 'above-max'

export type SlippageCheck =
  | { ok: true; bps: number; maxBps: number }
  | { ok: false; reason: SlippageRejection; maxBps: number | null }

/**
 * The slippage ceiling a flag allows: its `maxSlippageBps` held to TRADE_MAX_SLIPPAGE_BPS, or null
 * when the flag's value is not an integer of at least TRADE_MIN_SLIPPAGE_BPS (fails closed).
 */
export function effectiveMaxSlippageBps(flagMaxBps: number): number | null {
  if (!Number.isSafeInteger(flagMaxBps) || flagMaxBps < TRADE_MIN_SLIPPAGE_BPS) return null
  return Math.min(flagMaxBps, TRADE_MAX_SLIPPAGE_BPS)
}

/**
 * Validates a slippage tolerance in whole basis points against the flag's ceiling.
 * `undefined` means the user set none: TRADE_DEFAULT_SLIPPAGE_BPS, or the ceiling when the flag
 * allows less. Accepted values are the integers from TRADE_MIN_SLIPPAGE_BPS to
 * `min(flagMaxBps, TRADE_MAX_SLIPPAGE_BPS)`, both included.
 */
export function validateSlippageBps(value: number | undefined, flagMaxBps: number): SlippageCheck {
  const maxBps = effectiveMaxSlippageBps(flagMaxBps)
  if (maxBps === null) return { ok: false, reason: 'max-invalid', maxBps: null }
  if (value === undefined)
    return { ok: true, bps: Math.min(TRADE_DEFAULT_SLIPPAGE_BPS, maxBps), maxBps }
  if (!Number.isInteger(value)) return { ok: false, reason: 'not-integer', maxBps }
  if (value < TRADE_MIN_SLIPPAGE_BPS) return { ok: false, reason: 'below-min', maxBps }
  if (value > maxBps) return { ok: false, reason: 'above-max', maxBps }
  return { ok: true, bps: value, maxBps }
}

/** True for a value that fits a uint256: 0 ≤ x ≤ 2^256 − 1. */
export function isUint256(x: bigint): boolean {
  return x >= 0n && x <= MAX_UINT256
}

/**
 * Least output the swap accepts (`amountOutMinimum`), in the output token's raw units:
 * `floor(quotedAmountOut × (10 000 − slippageBps) / 10 000)`.
 *
 * Rounded down, as the bound is a floor the pool must clear: the exact tolerance is
 * `quoted × (1 − s)`, and the integer bound sits at most one raw unit below it. A result of 0
 * (a quote of a few raw units) protects nothing; `checkTrade` refuses it. This is the arithmetic
 * only: the slippage policy (1 to 300 bps) is `validateSlippageBps`. Throws RangeError for a quote
 * outside uint256 or a slippage that is not an integer from 0 to 10 000.
 */
export function minAmountOut(quotedAmountOut: bigint, slippageBps: number): bigint {
  if (!isUint256(quotedAmountOut))
    throw new RangeError(`minAmountOut: quote outside uint256: ${quotedAmountOut}`)
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000)
    throw new RangeError(
      `minAmountOut: slippage must be an integer from 0 to 10000: ${slippageBps}`,
    )
  return (quotedAmountOut * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR
}

/**
 * Deadline of a swap signed now, in unix seconds: the latest block's timestamp plus
 * `windowSeconds` (TRADE_DEADLINE_SECONDS by default). It is taken from the chain, not from the
 * browser's clock, which can be minutes off. Throws RangeError for a negative timestamp or window,
 * or a deadline that does not fit a uint256.
 */
export function tradeDeadline(
  latestBlockTimestamp: bigint,
  windowSeconds: bigint = TRADE_DEADLINE_SECONDS,
): bigint {
  if (latestBlockTimestamp < 0n)
    throw new RangeError(`tradeDeadline: negative block timestamp: ${latestBlockTimestamp}`)
  if (windowSeconds < 0n) throw new RangeError(`tradeDeadline: negative window: ${windowSeconds}`)
  const deadline = latestBlockTimestamp + windowSeconds
  if (!isUint256(deadline)) throw new RangeError(`tradeDeadline: outside uint256: ${deadline}`)
  return deadline
}
