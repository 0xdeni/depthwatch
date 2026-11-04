/**
 * Exact price ratios for the swap checks (docs/METRICS.md, "Swap checks"): the trade's effective
 * price, its price impact and the deviation of one price from another (the swap checks compare the
 * pool's mid with another live pool's and with the snapshot's).
 *
 * A price here is a `Fraction` of raw token1 units per raw token0 unit (the pool's orientation,
 * before any decimal adjustment), with both terms positive. Ratios stay exact bigint fractions;
 * the only `number` is the whole-bps figure shown to a person (`ratioToBpsCeil`), and every
 * threshold is compared exactly (`ratioAboveBps`).
 */

import { type Fraction, MAX_UINT160, numberToFraction, pow10, Q192 } from '../math.js'
import type { SwapDirection } from '../types.js'
import { BPS_DENOMINATOR } from './limits.js'

/** True when both terms of `ratio` are positive: a usable price. */
export function isPositiveRatio(ratio: Fraction): boolean {
  return ratio.num > 0n && ratio.den > 0n
}

/**
 * The raw pool price (token1 per token0) of a `sqrtPriceX96`: `sqrtPriceX96² / 2^192`, exact. Null
 * when the value is not in (0, 2^160 − 1], which no initialized pool reports.
 */
export function sqrtPriceX96ToRawPrice(sqrtPriceX96: bigint): Fraction | null {
  if (sqrtPriceX96 <= 0n || sqrtPriceX96 > MAX_UINT160) return null
  return { num: sqrtPriceX96 * sqrtPriceX96, den: Q192 }
}

/**
 * The raw price of a human price (token1 per token0, decimal adjusted, such as a snapshot's
 * `price`): `price × 10^(decimals1 − decimals0)`, from the double's exact value. Null when the
 * price is not a positive finite number.
 */
export function humanPriceToRawPrice(
  price: number,
  decimals0: number,
  decimals1: number,
): Fraction | null {
  if (!Number.isFinite(price) || !(price > 0)) return null
  const { num, den } = numberToFraction(price)
  return decimals1 >= decimals0
    ? { num: num * pow10(decimals1 - decimals0), den }
    : { num, den: den * pow10(decimals0 - decimals1) }
}

/**
 * The trade's average price in raw token1 per raw token0, fees included: `amountOut / amountIn`
 * when selling token0 (`zeroForOne`), `amountIn / amountOut` when buying it (`oneForZero`). Null
 * when either amount is not positive.
 */
export function tradeEffectivePrice(
  direction: SwapDirection,
  amountIn: bigint,
  amountOut: bigint,
): Fraction | null {
  if (amountIn <= 0n || amountOut <= 0n) return null
  return direction === 'zeroForOne'
    ? { num: amountOut, den: amountIn }
    : { num: amountIn, den: amountOut }
}

/**
 * Price impact of an exact-input swap, fees included, as an exact signed fraction of 1. It is the
 * spread legs' impact (docs/METRICS.md, "Effective spread") applied to a live quote: with `avg` the
 * trade's effective price and `mid` the pool's raw price before the trade,
 * - `zeroForOne` (sell token0): `1 − avg / mid = (amountIn·mid.num − amountOut·mid.den) /
 *   (amountIn·mid.num)`;
 * - `oneForZero` (buy token0): `avg / mid − 1 = (amountIn·mid.den − amountOut·mid.num) /
 *   (amountOut·mid.num)`.
 *
 * Positive is a cost. A quote from the pool's own state at the same block is never below 0 (the
 * fee is taken and every step rounds in the pool's favour), so a negative value means the quote and
 * the mid were read from different states. Null when an amount or the mid is not positive.
 */
export function tradePriceImpact(
  direction: SwapDirection,
  amountIn: bigint,
  amountOut: bigint,
  mid: Fraction,
): Fraction | null {
  if (amountIn <= 0n || amountOut <= 0n || !isPositiveRatio(mid)) return null
  if (direction === 'zeroForOne') {
    const atMid = amountIn * mid.num
    return { num: atMid - amountOut * mid.den, den: atMid }
  }
  const atMid = amountOut * mid.num
  return { num: amountIn * mid.den - atMid, den: atMid }
}

/**
 * Relative distance between two prices, `max(p, r) / min(p, r) − 1`, exact: with `p = a/b` and
 * `r = c/d`, `|a·d − c·b| / min(a·d, c·b)`. It is symmetric in its arguments and unchanged when
 * both prices are inverted, so it reads the same whichever token is token0 and whichever price is
 * the reference, and it is never smaller than `|p / r − 1|`. Null when either price is not
 * positive.
 */
export function tradePriceDeviation(price: Fraction, reference: Fraction): Fraction | null {
  if (!isPositiveRatio(price) || !isPositiveRatio(reference)) return null
  const left = price.num * reference.den
  const right = reference.num * price.den
  return left >= right ? { num: left - right, den: right } : { num: right - left, den: left }
}

/**
 * True when `ratio` is above `bps` basis points (`ratio × 10 000 > bps`), compared exactly.
 * Throws RangeError for a non-integer `bps` or a ratio whose denominator is not positive.
 */
export function ratioAboveBps(ratio: Fraction, bps: number): boolean {
  if (ratio.den <= 0n) throw new RangeError(`ratioAboveBps: denominator must be positive`)
  if (!Number.isInteger(bps)) throw new RangeError(`ratioAboveBps: bps must be an integer: ${bps}`)
  return ratio.num * BPS_DENOMINATOR > BigInt(bps) * ratio.den
}

/**
 * `ratio` in whole basis points, rounded up (toward +∞), for display. Rounding up keeps the shown
 * figure above an integer threshold exactly when the ratio is: 100.01 bps shows as 101 and is
 * above 100, 100 bps shows as 100 and is not. Throws RangeError for a denominator that is not
 * positive.
 */
export function ratioToBpsCeil(ratio: Fraction): number {
  if (ratio.den <= 0n) throw new RangeError(`ratioToBpsCeil: denominator must be positive`)
  const scaled = ratio.num * BPS_DENOMINATOR
  const quotient = scaled / ratio.den
  // bigint division truncates toward zero, which is already the ceiling of a negative quotient.
  return Number(scaled > 0n && scaled % ratio.den !== 0n ? quotient + 1n : quotient)
}
