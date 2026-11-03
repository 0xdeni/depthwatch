import { describe, expect, it } from 'vitest'
import { MAX_UINT256 } from '../math.js'
import { tradeSizeAboveUsd, tradeSizeUsd, type UsdPricedAmount } from './size.js'

const usdc = (amount: bigint): UsdPricedAmount => ({ amount, decimals: 6, usdPrice: 1 })
const cbbtc = (amount: bigint): UsdPricedAmount => ({ amount, decimals: 8, usdPrice: 100_000 })
const weth = (amount: bigint): UsdPricedAmount => ({ amount, decimals: 18, usdPrice: 2_500 })

describe('tradeSizeAboveUsd', () => {
  it('allows exactly the cap and refuses one raw unit above it, at 6, 8 and 18 decimals', () => {
    // $1,000 = 1,000 USDC = 0.01 cbBTC = 0.4 WETH.
    expect(tradeSizeAboveUsd([usdc(1_000_000_000n)], 1_000)).toBe(false)
    expect(tradeSizeAboveUsd([usdc(1_000_000_001n)], 1_000)).toBe(true)
    expect(tradeSizeAboveUsd([cbbtc(1_000_000n)], 1_000)).toBe(false)
    expect(tradeSizeAboveUsd([cbbtc(1_000_001n)], 1_000)).toBe(true)
    expect(tradeSizeAboveUsd([weth(4n * 10n ** 17n)], 1_000)).toBe(false)
    expect(tradeSizeAboveUsd([weth(4n * 10n ** 17n + 1n)], 1_000)).toBe(true)
  })

  it('goes by the larger side, so a low price on one token cannot slip a trade under', () => {
    const stale: UsdPricedAmount = { amount: 4n * 10n ** 18n, decimals: 18, usdPrice: 200 }
    // 4 WETH valued at a stale $200 is $800; the 9,930 USDC that come out are not.
    expect(tradeSizeAboveUsd([stale], 1_000)).toBe(false)
    expect(tradeSizeAboveUsd([stale, usdc(9_930_000_000n)], 1_000)).toBe(true)
  })

  it('values the priced side when the other has no usable price', () => {
    const unpriced: UsdPricedAmount = { amount: 10n ** 30n, decimals: 18, usdPrice: null }
    expect(tradeSizeAboveUsd([unpriced, usdc(999_000_000n)], 1_000)).toBe(false)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(tradeSizeAboveUsd([{ ...weth(1n), usdPrice: bad }, usdc(1n)], 1_000)).toBe(false)
  })

  it('is null when no side has a usable price: the size is unknown', () => {
    expect(tradeSizeAboveUsd([], 1_000)).toBeNull()
    expect(tradeSizeAboveUsd([{ ...weth(1n), usdPrice: null }], 1_000)).toBeNull()
    expect(tradeSizeAboveUsd([{ ...weth(1n), usdPrice: 0 }], 1_000)).toBeNull()
  })

  it('handles zero and uint256-sized amounts', () => {
    expect(tradeSizeAboveUsd([usdc(0n)], 1_000)).toBe(false)
    expect(tradeSizeAboveUsd([weth(MAX_UINT256)], 1_000)).toBe(true)
    expect(tradeSizeAboveUsd([{ amount: 1n, decimals: 0, usdPrice: 1e-30 }], 1e-31)).toBe(true)
  })

  it('compares at the exact value of fractional prices and caps', () => {
    // The double nearest 0.1 is 0.1000000000000000055…, so 10,000 units at it are a hair above
    // $1,000 and refused, while 9,999 units are not; 0.125 is exact and lands on the cap.
    const dime: UsdPricedAmount = { amount: 10_000n, decimals: 0, usdPrice: 0.1 }
    expect(tradeSizeAboveUsd([dime], 1_000)).toBe(true)
    expect(tradeSizeAboveUsd([{ ...dime, amount: 9_999n }], 1_000)).toBe(false)
    expect(tradeSizeAboveUsd([{ amount: 8_000n, decimals: 0, usdPrice: 0.125 }], 1_000)).toBe(false)
    expect(tradeSizeAboveUsd([usdc(250_000_000n)], 249.99)).toBe(true)
  })

  it('throws on a negative amount or an unusable cap', () => {
    expect(() => tradeSizeAboveUsd([usdc(-1n)], 1_000)).toThrow(RangeError)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => tradeSizeAboveUsd([usdc(1n)], bad)).toThrow(RangeError)
  })
})

describe('tradeSizeUsd', () => {
  it('is the larger priced side in USD', () => {
    expect(tradeSizeUsd([weth(4n * 10n ** 17n), usdc(996_602_554n)])).toBe(1_000)
    expect(tradeSizeUsd([cbbtc(1_234_567n)])).toBeCloseTo(1_234.567, 9)
    expect(tradeSizeUsd([{ ...weth(1n), usdPrice: null }, usdc(5_000_000n)])).toBe(5)
  })

  it('is null when nothing is priced', () => {
    expect(tradeSizeUsd([])).toBeNull()
    expect(tradeSizeUsd([{ ...usdc(1n), usdPrice: null }])).toBeNull()
  })

  it('throws on a negative amount', () => {
    expect(() => tradeSizeUsd([usdc(-1n)])).toThrow(RangeError)
  })
})
