import { describe, expect, it } from 'vitest'
import { type Fraction, MAX_UINT160, Q96 } from '../math.js'
import { computeEffectiveSpread } from '../metrics/spread.js'
import { simulateSwapExactIn } from '../swap/index.js'
import { buildConcentratedState, buildConstantProductState, makeToken } from '../testing.js'
import { getTickAtSqrtRatio, priceToSqrtPriceX96 } from '../tickMath.js'
import {
  humanPriceToRawPrice,
  isPositiveRatio,
  ratioAboveBps,
  ratioToBpsCeil,
  sqrtPriceX96ToRawPrice,
  tradeEffectivePrice,
  tradePriceDeviation,
  tradePriceImpact,
} from './prices.js'

/** Exact equality of two fractions by cross-multiplication. */
function same(a: Fraction | null, b: Fraction): boolean {
  return a !== null && a.num * b.den === b.num * a.den
}

/** A fraction as a double, for tolerance checks against float references only. */
function toNumber(f: Fraction): number {
  return Number(f.num) / Number(f.den)
}

const ONE: Fraction = { num: 1n, den: 1n }

describe('price fractions', () => {
  it('sqrtPriceX96ToRawPrice squares exactly and rejects values no pool reports', () => {
    expect(same(sqrtPriceX96ToRawPrice(Q96), ONE)).toBe(true)
    expect(same(sqrtPriceX96ToRawPrice(2n * Q96), { num: 4n, den: 1n })).toBe(true)
    expect(sqrtPriceX96ToRawPrice(MAX_UINT160)).not.toBeNull()
    expect(sqrtPriceX96ToRawPrice(0n)).toBeNull()
    expect(sqrtPriceX96ToRawPrice(-Q96)).toBeNull()
    expect(sqrtPriceX96ToRawPrice(MAX_UINT160 + 1n)).toBeNull()
  })

  it('humanPriceToRawPrice applies 10^(decimals1 − decimals0) exactly', () => {
    // WETH (18) / USDC (6) at 2,500 USDC per WETH: 2.5e-9 raw USDC per raw WETH.
    expect(same(humanPriceToRawPrice(2_500, 18, 6), { num: 25n, den: 10n ** 10n })).toBe(true)
    // USDC (6) / WETH (18) at 0.0004 WETH per USDC: 4e8 raw wei per raw USDC unit.
    const inverse = humanPriceToRawPrice(0.0004, 6, 18)
    expect(inverse && toNumber(inverse)).toBeCloseTo(4e8, 0)
    // cbBTC (8) / USDC (6) at 100,000 USDC per cbBTC: 1,000 raw USDC per satoshi.
    expect(same(humanPriceToRawPrice(100_000, 8, 6), { num: 1_000n, den: 1n })).toBe(true)
    // Equal decimals: raw and human coincide.
    expect(same(humanPriceToRawPrice(1.25, 18, 18), { num: 5n, den: 4n })).toBe(true)
  })

  it('humanPriceToRawPrice is null for a price that is not positive and finite', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(humanPriceToRawPrice(bad, 18, 6)).toBeNull()
  })

  it('isPositiveRatio needs both terms above zero', () => {
    expect(isPositiveRatio(ONE)).toBe(true)
    expect(isPositiveRatio({ num: 0n, den: 1n })).toBe(false)
    expect(isPositiveRatio({ num: 1n, den: 0n })).toBe(false)
    expect(isPositiveRatio({ num: -1n, den: -1n })).toBe(false)
  })
})

describe('tradeEffectivePrice', () => {
  it('is token1 per token0 in both directions', () => {
    // Selling 0.01 WETH for 22.904017 USDC; buying with 22.904017 USDC for 0.01 WETH.
    const sell = tradeEffectivePrice('zeroForOne', 10n ** 16n, 22_904_017n)
    const buy = tradeEffectivePrice('oneForZero', 22_904_017n, 10n ** 16n)
    expect(same(sell, { num: 22_904_017n, den: 10n ** 16n })).toBe(true)
    expect(same(buy, { num: 22_904_017n, den: 10n ** 16n })).toBe(true)
  })

  it('is null when either amount is not positive', () => {
    expect(tradeEffectivePrice('zeroForOne', 0n, 1n)).toBeNull()
    expect(tradeEffectivePrice('oneForZero', 1n, 0n)).toBeNull()
    expect(tradeEffectivePrice('zeroForOne', -1n, 1n)).toBeNull()
  })
})

describe('tradePriceImpact', () => {
  it('is exact on hand-made amounts in both directions', () => {
    // mid 2 token1 per token0. Sell 100 token0 for 190 token1: 1 − 1.9 / 2 = 5 %.
    expect(
      same(tradePriceImpact('zeroForOne', 100n, 190n, { num: 2n, den: 1n }), { num: 1n, den: 20n }),
    ).toBe(true)
    // Buy with 210 token1 for 100 token0: 2.1 / 2 − 1 = 5 %.
    expect(
      same(tradePriceImpact('oneForZero', 210n, 100n, { num: 2n, den: 1n }), { num: 1n, den: 20n }),
    ).toBe(true)
    // A trade exactly at mid has no impact.
    expect(
      same(tradePriceImpact('zeroForOne', 100n, 200n, { num: 2n, den: 1n }), { num: 0n, den: 1n }),
    ).toBe(true)
  })

  it('is negative when the quote beats the mid, which only another state can give', () => {
    const impact = tradePriceImpact('zeroForOne', 100n, 210n, { num: 2n, den: 1n })
    expect(same(impact, { num: -1n, den: 20n })).toBe(true)
  })

  it('is null for a zero amount or an unusable mid', () => {
    expect(tradePriceImpact('zeroForOne', 0n, 1n, ONE)).toBeNull()
    expect(tradePriceImpact('oneForZero', 1n, 0n, ONE)).toBeNull()
    expect(tradePriceImpact('zeroForOne', 1n, 1n, { num: 0n, den: 1n })).toBeNull()
    expect(tradePriceImpact('zeroForOne', 1n, 1n, { num: 1n, den: 0n })).toBeNull()
  })

  it('is the effective spread leg impact on the same trade', () => {
    // METRICS.md's WETH/USDC pool, $10,000 legs: buy 70.09 bps, sell 69.60 bps.
    const pool = buildConstantProductState(1_000n * 10n ** 18n, 2_500_000n * 10n ** 6n, 3000)
    const mid = { num: pool.reserve1, den: pool.reserve0 }
    const buy = simulateSwapExactIn(pool, 'oneForZero', 10_000n * 10n ** 6n)
    const sell = simulateSwapExactIn(pool, 'zeroForOne', 4n * 10n ** 18n)
    const buyImpact = tradePriceImpact('oneForZero', buy.amountIn, buy.amountOut, mid)
    const sellImpact = tradePriceImpact('zeroForOne', sell.amountIn, sell.amountOut, mid)
    if (!buyImpact || !sellImpact) throw new Error('missing impact')
    const [point] = computeEffectiveSpread(
      pool,
      makeToken('WETH', 18),
      makeToken('USDC', 6),
      2_500,
      1,
      [10_000],
    )
    if (point?.buyAvgPrice == null || point.sellAvgPrice == null) throw new Error('missing leg')
    expect(toNumber(buyImpact) * 1e4).toBeCloseTo((point.buyAvgPrice / 2_500 - 1) * 1e4, 6)
    expect(toNumber(sellImpact) * 1e4).toBeCloseTo((1 - point.sellAvgPrice / 2_500) * 1e4, 6)
    expect(ratioToBpsCeil(buyImpact)).toBe(71)
    expect(ratioToBpsCeil(sellImpact)).toBe(70)
  })

  it('is at least the fee on a concentrated WETH (18) / USDC (6) pool, both directions', () => {
    const sqrt = priceToSqrtPriceX96(2_500, 18, 6)
    const tick = getTickAtSqrtRatio(sqrt)
    const lower = Math.floor((tick - 6_000) / 10) * 10
    const pool = buildConcentratedState({
      positions: [{ tickLower: lower, tickUpper: lower + 12_000, liquidity: 10n ** 17n }],
      tick,
      sqrtPriceX96: sqrt,
      feePips: 500,
      tickSpacing: 10,
    })
    const mid = sqrtPriceX96ToRawPrice(pool.sqrtPriceX96)
    if (!mid) throw new Error('no mid')
    for (const [direction, amountIn] of [
      ['zeroForOne', 4n * 10n ** 17n],
      ['oneForZero', 1_000n * 10n ** 6n],
    ] as const) {
      const swap = simulateSwapExactIn(pool, direction, amountIn)
      expect(swap.complete).toBe(true)
      const impact = tradePriceImpact(direction, swap.amountIn, swap.amountOut, mid)
      if (!impact) throw new Error('no impact')
      // 500 pips = 5 bps: the fee alone is a floor, and $1,000 into this range adds about 2 bps.
      expect(ratioAboveBps(impact, 5)).toBe(true)
      expect(ratioAboveBps(impact, 10)).toBe(false)
    }
  })

  it('handles an 8-decimal token against an 18-decimal one', () => {
    // cbBTC (8) per WETH (18) at 0.025: raw mid 2.5e-12. Sell 1 WETH for 0.02490000 cbBTC.
    const mid: Fraction = { num: 25n, den: 10n ** 13n }
    const fromHuman = humanPriceToRawPrice(0.025, 18, 8)
    // 0.025 is not a double: the conversion is exact for the double, a hair above 2.5e-12.
    expect(fromHuman && toNumber(fromHuman)).toBeCloseTo(2.5e-12, 25)
    const impact = tradePriceImpact('zeroForOne', 10n ** 18n, 2_490_000n, mid)
    if (!impact) throw new Error('no impact')
    expect(ratioToBpsCeil(impact)).toBe(40)
    expect(ratioAboveBps(impact, 39)).toBe(true)
    expect(ratioAboveBps(impact, 40)).toBe(false)
  })
})

describe('tradePriceDeviation', () => {
  const p: Fraction = { num: 102n, den: 100n }

  it('is max / min − 1, exact', () => {
    expect(same(tradePriceDeviation(p, ONE), { num: 2n, den: 100n })).toBe(true)
    expect(same(tradePriceDeviation(ONE, p), { num: 2n, den: 100n })).toBe(true)
    expect(same(tradePriceDeviation(p, p), { num: 0n, den: 1n })).toBe(true)
  })

  it('reads the same with both prices inverted, so token order does not matter', () => {
    const a: Fraction = { num: 2_491_506_385n, den: 10n ** 21n }
    const b: Fraction = { num: 24n, den: 10n ** 10n }
    const direct = tradePriceDeviation(a, b)
    const inverted = tradePriceDeviation({ num: a.den, den: a.num }, { num: b.den, den: b.num })
    if (!direct) throw new Error('no deviation')
    expect(same(inverted, direct)).toBe(true)
  })

  it('is never smaller than |p / r − 1|', () => {
    const r: Fraction = { num: 97n, den: 100n }
    const d = tradePriceDeviation(ONE, r)
    if (!d) throw new Error('no deviation')
    // |1 / 0.97 − 1| = 3.09 % against |0.97 / 1 − 1| = 3 %: the larger one is reported.
    expect(same(d, { num: 3n, den: 97n })).toBe(true)
    expect(ratioAboveBps(d, 300)).toBe(true)
  })

  it('is null when either price is not positive', () => {
    expect(tradePriceDeviation({ num: 0n, den: 1n }, ONE)).toBeNull()
    expect(tradePriceDeviation(ONE, { num: 1n, den: 0n })).toBeNull()
  })
})

describe('basis points', () => {
  it('ratioAboveBps is strict and exact at the bound', () => {
    expect(ratioAboveBps({ num: 5n, den: 100n }, 500)).toBe(false)
    expect(ratioAboveBps({ num: 50_001n, den: 1_000_000n }, 500)).toBe(true)
    expect(ratioAboveBps({ num: 49_999n, den: 1_000_000n }, 500)).toBe(false)
    expect(ratioAboveBps({ num: 0n, den: 1n }, 0)).toBe(false)
    expect(ratioAboveBps({ num: -1n, den: 100n }, -101)).toBe(true)
  })

  it('ratioToBpsCeil rounds up, toward +∞', () => {
    expect(ratioToBpsCeil({ num: 1n, den: 100n })).toBe(100)
    expect(ratioToBpsCeil({ num: 10_001n, den: 1_000_000n })).toBe(101)
    expect(ratioToBpsCeil({ num: 1n, den: 10n ** 30n })).toBe(1)
    expect(ratioToBpsCeil({ num: 0n, den: 7n })).toBe(0)
    expect(ratioToBpsCeil({ num: -10_001n, den: 1_000_000n })).toBe(-100)
    expect(ratioToBpsCeil({ num: -1n, den: 10n ** 30n })).toBe(0)
  })

  it('a value shows above an integer threshold exactly when it is above it', () => {
    for (let num = 9_990n; num <= 10_010n; num += 1n) {
      const ratio = { num, den: 1_000_000n }
      expect(ratioToBpsCeil(ratio) > 100).toBe(ratioAboveBps(ratio, 100))
    }
  })

  it('throw on a denominator that is not positive or a fractional threshold', () => {
    expect(() => ratioAboveBps({ num: 1n, den: 0n }, 1)).toThrow(RangeError)
    expect(() => ratioAboveBps({ num: 1n, den: 1n }, 1.5)).toThrow(RangeError)
    expect(() => ratioToBpsCeil({ num: 1n, den: -1n })).toThrow(RangeError)
  })
})
