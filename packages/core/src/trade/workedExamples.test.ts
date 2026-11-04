/**
 * The swap checks' worked examples in docs/METRICS.md ("Swap checks"), reproduced to the raw unit
 * and to the two decimals of bps the page prints. A change that moves any figure here must update
 * the page in the same commit.
 */

import { describe, expect, it } from 'vitest'
import type { Fraction } from '../math.js'
import { simulateSwapExactIn } from '../swap/index.js'
import { buildConstantProductState } from '../testing.js'
import { checkTrade, type TradeCheckInput } from './decision.js'
import { minAmountOut, tradeDeadline } from './limits.js'
import {
  humanPriceToRawPrice,
  ratioToBpsCeil,
  tradeEffectivePrice,
  tradePriceDeviation,
  tradePriceImpact,
} from './prices.js'

/** A fraction in bps, rounded to the two decimals METRICS.md prints. */
function bps2dp(f: Fraction | null): number {
  if (f === null) throw new Error('missing ratio')
  return Number(((Number(f.num) / Number(f.den)) * 1e4).toFixed(2))
}

const WETH = 10n ** 18n
const USDC = 10n ** 6n
/** METRICS.md's pool: 1,000 WETH (token0, 18 decimals), 2,500,000 USDC (token1, 6), 0.30 %. */
const pool = buildConstantProductState(1_000n * WETH, 2_500_000n * USDC, 3000)
const mid: Fraction = { num: pool.reserve1, den: pool.reserve0 }
const snapshot = humanPriceToRawPrice(2_500, 18, 6)

function input(direction: TradeCheckInput['direction'], amountIn: bigint): TradeCheckInput {
  const swap = simulateSwapExactIn(pool, direction, amountIn)
  const weth = { decimals: 18, usdPrice: 2_500 }
  const usdc = { decimals: 6, usdPrice: 1 }
  return {
    direction,
    amountIn,
    quotedAmountOut: swap.amountOut,
    poolMid: mid,
    limits: { maxUsd: 1_000, maxSlippageBps: 300 },
    tokenIn: direction === 'zeroForOne' ? weth : usdc,
    tokenOut: direction === 'zeroForOne' ? usdc : weth,
    snapshotMid: snapshot,
  }
}

describe('docs/METRICS.md worked examples: swap checks', () => {
  it('Sell 0.4 WETH: 996.602554 USDC, impact 33.97 bps (34 shown), at least 991.619541', () => {
    const sell = input('zeroForOne', 4n * 10n ** 17n)
    expect(sell.quotedAmountOut).toBe(996_602_554n)
    const impact = tradePriceImpact('zeroForOne', sell.amountIn, sell.quotedAmountOut, mid)
    expect(bps2dp(impact)).toBe(33.97)
    expect(impact && ratioToBpsCeil(impact)).toBe(34)
    expect(minAmountOut(sell.quotedAmountOut, 50)).toBe(991_619_541n)
    if (!snapshot) throw new Error('missing price')
    // Mid to mid: the pool's mid is the snapshot's 2,500, whatever the trade's average price.
    expect(bps2dp(tradePriceDeviation(mid, snapshot))).toBe(0)
    expect(checkTrade(sell)).toEqual({
      kind: 'ok',
      slippageBps: 50,
      minAmountOut: 991_619_541n,
      priceImpactBps: 34,
      sizeUsd: 1_000,
    })
  })

  it('One wei more is above the $1,000 cap', () => {
    expect(checkTrade(input('zeroForOne', 4n * 10n ** 17n + 1n))).toMatchObject({
      kind: 'refuse',
      reason: 'size-above-max',
    })
  })

  it('Buy with 1,000 USDC: 0.398641021960442175 WETH, impact 34.09 bps (35 shown)', () => {
    const buy = input('oneForZero', 1_000n * USDC)
    expect(buy.quotedAmountOut).toBe(398_641_021_960_442_175n)
    const impact = tradePriceImpact('oneForZero', buy.amountIn, buy.quotedAmountOut, mid)
    expect(bps2dp(impact)).toBe(34.09)
    expect(checkTrade(buy)).toEqual({
      kind: 'ok',
      slippageBps: 50,
      minAmountOut: 396_647_816_850_639_964n,
      priceImpactBps: 35,
      sizeUsd: 1_000,
    })
  })

  it('The same 0.4 WETH into thinner pools: a warning at 40 WETH, a refusal at 8 WETH', () => {
    for (const [reserve0, reserve1, out, expected] of [
      [
        40n,
        100_000n,
        987_158_034n,
        { kind: 'warn', reason: 'price-impact-high', priceImpactBps: 129 },
      ],
      [8n, 20_000n, 949_659_475n, { kind: 'refuse', reason: 'price-impact-above-max', value: 504 }],
    ] as const) {
      const thin = buildConstantProductState(reserve0 * WETH, reserve1 * USDC, 3000)
      const thinMid = { num: thin.reserve1, den: thin.reserve0 }
      const swap = simulateSwapExactIn(thin, 'zeroForOne', 4n * 10n ** 17n)
      expect(swap.amountOut).toBe(out)
      const decision = checkTrade({
        ...input('zeroForOne', 4n * 10n ** 17n),
        quotedAmountOut: swap.amountOut,
        poolMid: thinMid,
      })
      expect(decision).toMatchObject(expected)
    }
    const warn = tradePriceImpact('zeroForOne', 4n * 10n ** 17n, 987_158_034n, {
      num: 100_000n * USDC,
      den: 40n * WETH,
    })
    const refuse = tradePriceImpact('zeroForOne', 4n * 10n ** 17n, 949_659_475n, {
      num: 20_000n * USDC,
      den: 8n * WETH,
    })
    expect(bps2dp(warn)).toBe(128.42)
    expect(bps2dp(refuse)).toBe(503.41)
  })

  it('Deviation, mid to mid: 2,450 in another live pool and 2,272 in the snapshot are too far', () => {
    const [live2451, live2450, snap2273, snap2272] = [2_451, 2_450, 2_273, 2_272].map((price) =>
      humanPriceToRawPrice(price, 18, 6),
    )
    if (!live2451 || !live2450 || !snap2273 || !snap2272) throw new Error('missing price')
    expect(bps2dp(tradePriceDeviation(mid, live2451))).toBe(199.92)
    expect(bps2dp(tradePriceDeviation(mid, live2450))).toBe(204.08)
    expect(bps2dp(tradePriceDeviation(mid, snap2273))).toBe(998.68)
    expect(bps2dp(tradePriceDeviation(mid, snap2272))).toBe(1_003.52)
    // The same for the sale and the purchase: neither the fee nor the impact enters.
    for (const trade of [
      input('zeroForOne', 4n * 10n ** 17n),
      input('oneForZero', 1_000n * USDC),
    ]) {
      expect(checkTrade({ ...trade, otherPoolMids: [live2451] })).toMatchObject({ kind: 'ok' })
      expect(checkTrade({ ...trade, otherPoolMids: [live2450] })).toMatchObject({
        reason: 'live-deviation-above-max',
        value: 205,
      })
      expect(checkTrade({ ...trade, snapshotMid: snap2273 })).toMatchObject({ kind: 'ok' })
      expect(checkTrade({ ...trade, snapshotMid: snap2272 })).toMatchObject({
        reason: 'snapshot-deviation-above-max',
        value: 1_004,
      })
    }
  })

  it('A 2 % fee pool: 0.1 WETH for 244.975992 USDC, 200.96 bps, allowed both ways next to 2,530', () => {
    const steep = buildConstantProductState(1_000n * WETH, 2_500_000n * USDC, 20_000)
    const reference = humanPriceToRawPrice(2_530, 18, 6)
    if (!reference) throw new Error('missing price')
    const sell = simulateSwapExactIn(steep, 'zeroForOne', WETH / 10n).amountOut
    const buy = simulateSwapExactIn(steep, 'oneForZero', 250n * USDC).amountOut
    expect([sell, buy]).toEqual([244_975_992n, 97_990_396_941_099_772n])
    expect(bps2dp(tradePriceImpact('zeroForOne', WETH / 10n, sell, mid))).toBe(200.96)
    expect(bps2dp(tradePriceImpact('oneForZero', 250n * USDC, buy, mid))).toBe(205.08)
    expect(bps2dp(tradePriceDeviation(mid, reference))).toBe(120)
    const sellAvg = tradeEffectivePrice('zeroForOne', WETH / 10n, sell)
    expect(sellAvg && bps2dp(tradePriceDeviation(sellAvg, reference))).toBe(327.54)
    for (const [direction, amountIn, out] of [
      ['zeroForOne', WETH / 10n, sell],
      ['oneForZero', 250n * USDC, buy],
    ] as const)
      expect(
        checkTrade({
          ...input(direction, amountIn),
          quotedAmountOut: out,
          otherPoolMids: [reference],
        }),
      ).toMatchObject({ kind: 'warn', reason: 'price-impact-high' })
  })

  it('Deadline: block 53,466,609 at 1,793,722,565 s signs until 1,793,722,865', () => {
    expect(tradeDeadline(1_793_722_565n)).toBe(1_793_722_865n)
  })
})
