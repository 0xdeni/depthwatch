/**
 * One decision from every swap check (docs/METRICS.md, "Swap checks"): `ok`, `warn` with a reason,
 * or `refuse` with a reason. The checks run in a fixed order and the first refusal wins; a warning
 * is returned only when nothing refuses. Pure: every price and amount is read by the caller.
 */

import type { Fraction } from '../math.js'
import type { SwapDirection, TradeLimits } from '../types.js'
import { isUint256, minAmountOut, validateSlippageBps } from './limits.js'
import {
  isPositiveRatio,
  ratioAboveBps,
  ratioToBpsCeil,
  tradePriceDeviation,
  tradePriceImpact,
} from './prices.js'
import { tradeSizeAboveUsd, tradeSizeUsd, type UsdPricedAmount } from './size.js'

/** Price impact above which the trade is shown with a warning: 100 bps (1 %). */
export const TRADE_PRICE_IMPACT_WARN_BPS = 100

/** Price impact above which the trade is refused: 500 bps (5 %). */
export const TRADE_PRICE_IMPACT_MAX_BPS = 500

/**
 * Largest deviation of the pool's mid from the mid of another live pool of the same pair, both
 * read at the quote's block: 200 bps (2 %).
 */
export const TRADE_MAX_LIVE_DEVIATION_BPS = 200

/**
 * Largest deviation of the pool's mid at the quote's block from the snapshot's price of the pool:
 * 1,000 bps (10 %), wide because the snapshot can be three hours old.
 */
export const TRADE_MAX_SNAPSHOT_DEVIATION_BPS = 1_000

/** A token's decimals and its snapshot USD price (null when the snapshot has none). */
export interface TradeTokenPricing {
  decimals: number
  usdPrice: number | null
}

export interface TradeCheckInput {
  direction: SwapDirection
  /** Exact input, raw units of the input token. */
  amountIn: bigint
  /** The live quote for `amountIn`, raw units of the output token. */
  quotedAmountOut: bigint
  /**
   * The pool's raw price (token1 per token0) before the trade, read at the quote's block, for
   * example `sqrtPriceX96ToRawPrice(slot0.sqrtPriceX96)`. Null when it could not be read.
   */
  poolMid: Fraction | null
  /** Slippage tolerance in whole bps; undefined for the default. */
  slippageBps?: number
  limits: TradeLimits
  tokenIn: TradeTokenPricing
  tokenOut: TradeTokenPricing
  /**
   * The snapshot's price of this pool as a raw price (`humanPriceToRawPrice(price, decimals0,
   * decimals1)`). Null when the snapshot has none: the trade is refused.
   */
  snapshotMid: Fraction | null
  /** Raw prices of other live pools of the same pair, read at the quote's block. */
  otherPoolMids?: readonly Fraction[]
}

/**
 * Why a trade is refused, in the order the checks run. Units of `value` and `limit` on the
 * refusal: bps for slippage, price impact and deviations; USD for the size.
 */
export type TradeRefuseReason =
  | 'limits-invalid'
  | 'amount-invalid'
  | 'slippage-invalid'
  | 'slippage-above-max'
  | 'quote-invalid'
  | 'no-output'
  | 'mid-price-invalid'
  | 'size-unpriced'
  | 'size-above-max'
  | 'price-impact-above-max'
  | 'quote-inconsistent'
  | 'snapshot-price-missing'
  | 'snapshot-deviation-above-max'
  | 'reference-price-invalid'
  | 'live-deviation-above-max'

export type TradeWarnReason = 'price-impact-high'

/** The figures of a trade that passed every refusal check, for the review screen. */
export interface TradeFigures {
  slippageBps: number
  /** `amountOutMinimum` to sign, raw units of the output token. */
  minAmountOut: bigint
  /** Price impact in whole bps, rounded up (`ratioToBpsCeil`). */
  priceImpactBps: number
  /** The larger of the input's and the quoted output's USD values at snapshot prices. */
  sizeUsd: number
}

export type TradeDecision =
  | ({ kind: 'ok' } & TradeFigures)
  | ({ kind: 'warn'; reason: TradeWarnReason } & TradeFigures)
  | { kind: 'refuse'; reason: TradeRefuseReason; value?: number; limit?: number }

/** An ERC-20 `decimals()` value: an integer from 0 to 255. */
function isTokenDecimals(decimals: number): boolean {
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
}

function refuse(reason: TradeRefuseReason, value?: number, limit?: number): TradeDecision {
  if (value === undefined || limit === undefined) return { kind: 'refuse', reason }
  return { kind: 'refuse', reason, value, limit }
}

/**
 * Runs every swap check on a live quote and returns one decision. Refusals, first match wins:
 * 1. `limits-invalid`: the flags' `maxUsd` is not a positive finite number, or their
 *    `maxSlippageBps` is not an integer of at least 1 (fails closed);
 * 2. `amount-invalid`: `amountIn` is 0 or outside uint256, or a token's decimals are not an
 *    integer from 0 to 255;
 * 3. `slippage-invalid` (not a whole number of bps, or below 1) or `slippage-above-max`;
 * 4. `quote-invalid`: the quote is outside uint256;
 * 5. `no-output`: the quote, or the minimum output it leaves after slippage, is 0;
 * 6. `mid-price-invalid`: no usable pool price before the trade;
 * 7. `size-unpriced` (neither token has a snapshot USD price) or `size-above-max`;
 * 8. `price-impact-above-max`: impact above TRADE_PRICE_IMPACT_MAX_BPS;
 * 9. `quote-inconsistent`: the quote beats the pool's own mid by more than that same bound, which
 *    only a quote and a mid read from different states can do;
 * 10. `snapshot-price-missing` or `snapshot-deviation-above-max`: the pool's mid against the
 *    snapshot's price (TRADE_MAX_SNAPSHOT_DEVIATION_BPS);
 * 11. `reference-price-invalid` or `live-deviation-above-max`: the pool's mid against each other
 *    live pool's mid given (TRADE_MAX_LIVE_DEVIATION_BPS).
 *
 * The deviations compare prices before the trade, mid to mid, so they read the same at any amount
 * and in both directions: they catch a pool whose own price is off. The fee and the trade's impact
 * are the price impact's bound, which includes them.
 *
 * Otherwise `warn` with `price-impact-high` when the impact is above TRADE_PRICE_IMPACT_WARN_BPS,
 * else `ok`. Every bound is "above": a value exactly at the bound passes.
 */
export function checkTrade(input: TradeCheckInput): TradeDecision {
  const { direction, amountIn, quotedAmountOut: quoted, limits } = input
  const slippage = validateSlippageBps(input.slippageBps, limits.maxSlippageBps)
  if (!(Number.isFinite(limits.maxUsd) && limits.maxUsd > 0)) return refuse('limits-invalid')
  if (!slippage.ok && slippage.reason === 'max-invalid') return refuse('limits-invalid')
  if (amountIn === 0n || !isUint256(amountIn)) return refuse('amount-invalid')
  if (!isTokenDecimals(input.tokenIn.decimals) || !isTokenDecimals(input.tokenOut.decimals))
    return refuse('amount-invalid')
  if (!slippage.ok) {
    const reason = slippage.reason === 'above-max' ? 'slippage-above-max' : 'slippage-invalid'
    return refuse(reason, input.slippageBps, slippage.maxBps ?? undefined)
  }
  if (!isUint256(quoted)) return refuse('quote-invalid')
  const minOut = minAmountOut(quoted, slippage.bps)
  if (minOut === 0n) return refuse('no-output')
  const mid = input.poolMid
  if (mid === null || !isPositiveRatio(mid)) return refuse('mid-price-invalid')

  const sides: UsdPricedAmount[] = [
    { amount: amountIn, ...input.tokenIn },
    { amount: quoted, ...input.tokenOut },
  ]
  const aboveCap = tradeSizeAboveUsd(sides, limits.maxUsd)
  const sizeUsd = tradeSizeUsd(sides)
  if (aboveCap === null || sizeUsd === null) return refuse('size-unpriced')
  if (aboveCap) return refuse('size-above-max', sizeUsd, limits.maxUsd)

  const impact = tradePriceImpact(direction, amountIn, quoted, mid)
  if (impact === null) return refuse('mid-price-invalid')
  const impactBps = ratioToBpsCeil(impact)
  if (ratioAboveBps(impact, TRADE_PRICE_IMPACT_MAX_BPS))
    return refuse('price-impact-above-max', impactBps, TRADE_PRICE_IMPACT_MAX_BPS)
  if (ratioAboveBps({ num: -impact.num, den: impact.den }, TRADE_PRICE_IMPACT_MAX_BPS))
    return refuse('quote-inconsistent', impactBps, -TRADE_PRICE_IMPACT_MAX_BPS)

  const snapshot = input.snapshotMid
  const fromSnapshot = snapshot === null ? null : tradePriceDeviation(mid, snapshot)
  if (fromSnapshot === null) return refuse('snapshot-price-missing')
  if (ratioAboveBps(fromSnapshot, TRADE_MAX_SNAPSHOT_DEVIATION_BPS))
    return refuse(
      'snapshot-deviation-above-max',
      ratioToBpsCeil(fromSnapshot),
      TRADE_MAX_SNAPSHOT_DEVIATION_BPS,
    )
  for (const other of input.otherPoolMids ?? []) {
    const fromLive = tradePriceDeviation(mid, other)
    if (fromLive === null) return refuse('reference-price-invalid')
    if (ratioAboveBps(fromLive, TRADE_MAX_LIVE_DEVIATION_BPS))
      return refuse(
        'live-deviation-above-max',
        ratioToBpsCeil(fromLive),
        TRADE_MAX_LIVE_DEVIATION_BPS,
      )
  }

  const figures: TradeFigures = {
    slippageBps: slippage.bps,
    minAmountOut: minOut,
    priceImpactBps: impactBps,
    sizeUsd,
  }
  if (ratioAboveBps(impact, TRADE_PRICE_IMPACT_WARN_BPS))
    return { kind: 'warn', reason: 'price-impact-high', ...figures }
  return { kind: 'ok', ...figures }
}
