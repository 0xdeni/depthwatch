import { describe, expect, it } from 'vitest'
import { MAX_UINT256 } from '../math.js'
import {
  checkTrade,
  TRADE_MAX_LIVE_DEVIATION_BPS,
  TRADE_MAX_SNAPSHOT_DEVIATION_BPS,
  TRADE_PRICE_IMPACT_MAX_BPS,
  TRADE_PRICE_IMPACT_WARN_BPS,
  type TradeCheckInput,
} from './decision.js'

/**
 * Hand-made trade: 10,000 raw units of token0 sold at a mid of 1 for 9,970 of token1 (the 0.30 %
 * fee and nothing else), both tokens 0 decimals at $0.0625 (an exact double), so the size is $625.
 */
const base: TradeCheckInput = {
  direction: 'zeroForOne',
  amountIn: 10_000n,
  quotedAmountOut: 9_970n,
  poolMid: { num: 1n, den: 1n },
  limits: { maxUsd: 1_000, maxSlippageBps: 300 },
  tokenIn: { decimals: 0, usdPrice: 0.0625 },
  tokenOut: { decimals: 0, usdPrice: 0.0625 },
  snapshotMid: { num: 1n, den: 1n },
}

const check = (patch: Partial<TradeCheckInput>) => checkTrade({ ...base, ...patch })

describe('checkTrade: bounds', () => {
  it('match the launch decisions: warn 1 %, refuse 5 %, 2 % live, 10 % snapshot', () => {
    expect(TRADE_PRICE_IMPACT_WARN_BPS).toBe(100)
    expect(TRADE_PRICE_IMPACT_MAX_BPS).toBe(500)
    expect(TRADE_MAX_LIVE_DEVIATION_BPS).toBe(200)
    expect(TRADE_MAX_SNAPSHOT_DEVIATION_BPS).toBe(1_000)
  })
})

describe('checkTrade: ok and warn', () => {
  it('is ok with the figures to sign and show', () => {
    // minOut = floor(9,970 × 9,950 / 10,000) = floor(9,920.15) = 9,920
    expect(checkTrade(base)).toEqual({
      kind: 'ok',
      slippageBps: 50,
      minAmountOut: 9_920n,
      priceImpactBps: 30,
      sizeUsd: 625,
    })
  })

  it('uses the slippage the user set', () => {
    expect(check({ slippageBps: 300 })).toMatchObject({ kind: 'ok', minAmountOut: 9_670n })
  })

  it('warns above 1 % of price impact and not at exactly 1 %', () => {
    expect(check({ quotedAmountOut: 9_900n })).toMatchObject({ kind: 'ok', priceImpactBps: 100 })
    expect(check({ quotedAmountOut: 9_899n })).toEqual({
      kind: 'warn',
      reason: 'price-impact-high',
      slippageBps: 50,
      minAmountOut: 9_849n,
      priceImpactBps: 101,
      sizeUsd: 625,
    })
  })

  it('warns, not refuses, at exactly 5 %, in both directions', () => {
    expect(check({ quotedAmountOut: 9_500n })).toMatchObject({
      kind: 'warn',
      priceImpactBps: 500,
    })
    // Buying token0: 10,500 in for 10,000 out at mid 1 is 10,500 / 10,000 − 1 = 5 %.
    expect(
      check({ direction: 'oneForZero', amountIn: 10_500n, quotedAmountOut: 10_000n }),
    ).toMatchObject({ kind: 'warn', reason: 'price-impact-high', priceImpactBps: 500 })
  })

  it('is ok for a quote a little better than mid (another block), shown as negative impact', () => {
    expect(check({ quotedAmountOut: 10_500n })).toMatchObject({
      kind: 'ok',
      priceImpactBps: -500,
    })
  })
})

describe('checkTrade: refusals', () => {
  it('refuses above 5 % of price impact, in both directions', () => {
    expect(check({ quotedAmountOut: 9_499n })).toEqual({
      kind: 'refuse',
      reason: 'price-impact-above-max',
      value: 501,
      limit: 500,
    })
    expect(
      check({ direction: 'oneForZero', amountIn: 10_501n, quotedAmountOut: 10_000n }),
    ).toMatchObject({ kind: 'refuse', reason: 'price-impact-above-max', value: 501 })
  })

  it('refuses a quote that beats the mid by more than 5 %', () => {
    expect(check({ quotedAmountOut: 10_600n })).toEqual({
      kind: 'refuse',
      reason: 'quote-inconsistent',
      value: -600,
      limit: -500,
    })
  })

  it('refuses unusable flag limits (fails closed)', () => {
    for (const maxUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(check({ limits: { maxUsd, maxSlippageBps: 300 } })).toEqual({
        kind: 'refuse',
        reason: 'limits-invalid',
      })
    for (const maxSlippageBps of [0, -5, 2.5, Number.NaN])
      expect(check({ limits: { maxUsd: 1_000, maxSlippageBps } })).toMatchObject({
        reason: 'limits-invalid',
      })
  })

  it('refuses a zero, negative or oversized input and impossible decimals', () => {
    for (const amountIn of [0n, -1n, MAX_UINT256 + 1n])
      expect(check({ amountIn })).toEqual({ kind: 'refuse', reason: 'amount-invalid' })
    for (const decimals of [-1, 1.5, 256])
      expect(check({ tokenOut: { decimals, usdPrice: 1 } })).toMatchObject({
        reason: 'amount-invalid',
      })
  })

  it('refuses slippage outside 1 to the ceiling, with the value and the ceiling', () => {
    expect(check({ slippageBps: 301 })).toEqual({
      kind: 'refuse',
      reason: 'slippage-above-max',
      value: 301,
      limit: 300,
    })
    expect(check({ slippageBps: 150, limits: { maxUsd: 1_000, maxSlippageBps: 100 } })).toEqual({
      kind: 'refuse',
      reason: 'slippage-above-max',
      value: 150,
      limit: 100,
    })
    expect(check({ slippageBps: 500, limits: { maxUsd: 1_000, maxSlippageBps: 5_000 } })).toEqual({
      kind: 'refuse',
      reason: 'slippage-above-max',
      value: 500,
      limit: 300,
    })
    expect(check({ slippageBps: 0 })).toMatchObject({ reason: 'slippage-invalid', value: 0 })
    expect(check({ slippageBps: 0.5 })).toMatchObject({ reason: 'slippage-invalid' })
  })

  it('refuses a quote outside uint256 and one that leaves no minimum output', () => {
    for (const quotedAmountOut of [-1n, MAX_UINT256 + 1n])
      expect(check({ quotedAmountOut })).toEqual({ kind: 'refuse', reason: 'quote-invalid' })
    expect(check({ quotedAmountOut: 0n })).toEqual({ kind: 'refuse', reason: 'no-output' })
    // floor(1 × 9,950 / 10,000) = 0: a bound of 0 protects nothing.
    expect(check({ quotedAmountOut: 1n })).toEqual({ kind: 'refuse', reason: 'no-output' })
  })

  it('refuses without a usable pool mid', () => {
    expect(check({ poolMid: null })).toEqual({ kind: 'refuse', reason: 'mid-price-invalid' })
    expect(check({ poolMid: { num: 0n, den: 1n } })).toMatchObject({ reason: 'mid-price-invalid' })
  })

  it('refuses above the USD cap, and allows exactly the cap', () => {
    expect(check({ limits: { maxUsd: 625, maxSlippageBps: 300 } })).toMatchObject({ kind: 'ok' })
    expect(check({ limits: { maxUsd: 624.99, maxSlippageBps: 300 } })).toEqual({
      kind: 'refuse',
      reason: 'size-above-max',
      value: 625,
      limit: 624.99,
    })
  })

  it('refuses when neither token has a snapshot USD price, values the priced one otherwise', () => {
    const unpriced = { decimals: 0, usdPrice: null }
    expect(check({ tokenIn: unpriced, tokenOut: unpriced })).toEqual({
      kind: 'refuse',
      reason: 'size-unpriced',
    })
    expect(check({ tokenIn: unpriced })).toMatchObject({ kind: 'ok', sizeUsd: 623.125 })
  })

  it('refuses without a snapshot price and more than 10 % away from it', () => {
    expect(check({ snapshotMid: null })).toEqual({
      kind: 'refuse',
      reason: 'snapshot-price-missing',
    })
    expect(check({ snapshotMid: { num: 0n, den: 1n } })).toMatchObject({
      reason: 'snapshot-price-missing',
    })
    // Effective price 0.997; 0.997 × 1.1 = 1.0967 is exactly 10 % away and passes.
    expect(check({ snapshotMid: { num: 10_967n, den: 10_000n } })).toMatchObject({ kind: 'ok' })
    // 1.0968 / 0.997 − 1 = 998 / 9,970 = 1,001.003 bps, shown rounded up as 1,002.
    expect(check({ snapshotMid: { num: 10_968n, den: 10_000n } })).toEqual({
      kind: 'refuse',
      reason: 'snapshot-deviation-above-max',
      value: 1_002,
      limit: 1_000,
    })
    // Below works the same: 0.997 / 1.1 is exactly 10 % away the other way.
    expect(check({ snapshotMid: { num: 9_970n, den: 11_000n } })).toMatchObject({ kind: 'ok' })
    expect(check({ snapshotMid: { num: 9_969n, den: 11_000n } })).toMatchObject({
      reason: 'snapshot-deviation-above-max',
    })
  })

  it('refuses more than 2 % away from another live pool of the pair', () => {
    // 0.997 × 1.02 = 1.01694: exactly 2 % away passes, a hair more does not.
    const exact = { num: 101_694n, den: 100_000n }
    const beyond = { num: 101_695n, den: 100_000n }
    expect(check({ otherPoolMids: [exact] })).toMatchObject({ kind: 'ok' })
    expect(check({ otherPoolMids: [exact, beyond] })).toEqual({
      kind: 'refuse',
      reason: 'live-deviation-above-max',
      value: 201,
      limit: 200,
    })
    expect(check({ otherPoolMids: [{ num: 0n, den: 1n }] })).toEqual({
      kind: 'refuse',
      reason: 'reference-price-invalid',
    })
    expect(check({ otherPoolMids: [] })).toMatchObject({ kind: 'ok' })
  })
})

describe('checkTrade: order', () => {
  it('reports the first refusal: limits, amount, slippage, quote, then mid', () => {
    const everythingWrong: Partial<TradeCheckInput> = {
      limits: { maxUsd: 0, maxSlippageBps: 300 },
      amountIn: 0n,
      slippageBps: 999,
      quotedAmountOut: 0n,
      poolMid: null,
      snapshotMid: null,
    }
    expect(check(everythingWrong)).toMatchObject({ reason: 'limits-invalid' })
    const { limits: _l, ...noLimits } = everythingWrong
    expect(check(noLimits)).toMatchObject({ reason: 'amount-invalid' })
    const { amountIn: _a, ...noAmount } = noLimits
    expect(check(noAmount)).toMatchObject({ reason: 'slippage-above-max' })
    const { slippageBps: _s, ...noSlippage } = noAmount
    expect(check(noSlippage)).toMatchObject({ reason: 'no-output' })
    const { quotedAmountOut: _q, ...noQuote } = noSlippage
    expect(check(noQuote)).toMatchObject({ reason: 'mid-price-invalid' })
  })

  it('reports the size before the impact and the impact before the deviations', () => {
    const big = { amountIn: 1_000_000n, quotedAmountOut: 900_000n }
    expect(check(big)).toMatchObject({ reason: 'size-above-max' })
    expect(check({ quotedAmountOut: 9_000n, snapshotMid: null })).toMatchObject({
      reason: 'price-impact-above-max',
    })
    expect(
      check({ snapshotMid: { num: 2n, den: 1n }, otherPoolMids: [{ num: 2n, den: 1n }] }),
    ).toMatchObject({ reason: 'snapshot-deviation-above-max' })
  })
})

describe('checkTrade: real token decimals', () => {
  it('passes a $1,000 cbBTC (8) → USDC (6) sale at the cap', () => {
    // Mid 100,000 USDC per cbBTC = 1,000 raw USDC units per satoshi; 0.01 cbBTC for 999 USDC.
    expect(
      checkTrade({
        ...base,
        amountIn: 1_000_000n,
        quotedAmountOut: 999_000_000n,
        poolMid: { num: 1_000n, den: 1n },
        snapshotMid: { num: 1_000n, den: 1n },
        tokenIn: { decimals: 8, usdPrice: 100_000 },
        tokenOut: { decimals: 6, usdPrice: 1 },
      }),
    ).toEqual({
      kind: 'ok',
      slippageBps: 50,
      minAmountOut: 994_005_000n,
      priceImpactBps: 10,
      sizeUsd: 1_000,
    })
  })

  it('passes a USDC (6) → WETH (18) buy and refuses one raw unit over the cap', () => {
    // WETH token0, USDC token1, mid 2.5e-9 raw; 25 USDC in for 0.00997 WETH.
    const input: TradeCheckInput = {
      ...base,
      direction: 'oneForZero',
      amountIn: 25_000_000n,
      quotedAmountOut: 9_970_000_000_000_000n,
      poolMid: { num: 25n, den: 10n ** 10n },
      snapshotMid: { num: 25n, den: 10n ** 10n },
      tokenIn: { decimals: 6, usdPrice: 1 },
      tokenOut: { decimals: 18, usdPrice: 2_500 },
    }
    // avg = 25 / 0.00997 = 2,507.52 → impact 30.09 bps, shown 31; 0.5 % off 9.97e15 wei.
    expect(checkTrade(input)).toEqual({
      kind: 'ok',
      slippageBps: 50,
      minAmountOut: 9_920_150_000_000_000n,
      priceImpactBps: 31,
      sizeUsd: 25,
    })
    const atCap = { ...input, limits: { maxUsd: 25, maxSlippageBps: 300 } }
    expect(checkTrade(atCap)).toMatchObject({ kind: 'ok' })
    expect(checkTrade({ ...atCap, amountIn: 25_000_001n })).toMatchObject({
      reason: 'size-above-max',
    })
  })
})
