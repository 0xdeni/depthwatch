import { describe, expect, it } from 'vitest'
import { MAX_UINT256 } from '../math.js'
import {
  effectiveMaxSlippageBps,
  isUint256,
  minAmountOut,
  TRADE_DEADLINE_SECONDS,
  TRADE_DEFAULT_SLIPPAGE_BPS,
  TRADE_LAUNCH_MAX_USD,
  TRADE_MAX_SLIPPAGE_BPS,
  TRADE_MIN_SLIPPAGE_BPS,
  tradeDeadline,
  validateSlippageBps,
} from './limits.js'

describe('launch constants', () => {
  it('match the launch limits: 50 bps default, 300 bps ceiling, $1,000, 300 s', () => {
    expect(TRADE_DEFAULT_SLIPPAGE_BPS).toBe(50)
    expect(TRADE_MAX_SLIPPAGE_BPS).toBe(300)
    expect(TRADE_MIN_SLIPPAGE_BPS).toBe(1)
    expect(TRADE_LAUNCH_MAX_USD).toBe(1_000)
    expect(TRADE_DEADLINE_SECONDS).toBe(300n)
  })
})

describe('effectiveMaxSlippageBps', () => {
  it('keeps a flag at or under the ceiling and holds a higher one to it', () => {
    expect(effectiveMaxSlippageBps(300)).toBe(300)
    expect(effectiveMaxSlippageBps(100)).toBe(100)
    expect(effectiveMaxSlippageBps(1)).toBe(1)
    expect(effectiveMaxSlippageBps(301)).toBe(300)
    expect(effectiveMaxSlippageBps(10_000)).toBe(300)
  })

  it('fails closed on a flag that is not an integer of at least 1', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60])
      expect(effectiveMaxSlippageBps(bad)).toBeNull()
  })
})

describe('validateSlippageBps', () => {
  it('uses the 50 bps default when the user sets none', () => {
    expect(validateSlippageBps(undefined, 300)).toEqual({ ok: true, bps: 50, maxBps: 300 })
  })

  it('holds the default to a flag ceiling below it', () => {
    expect(validateSlippageBps(undefined, 30)).toEqual({ ok: true, bps: 30, maxBps: 30 })
  })

  it('accepts every integer from 1 to the ceiling, both included', () => {
    expect(validateSlippageBps(1, 300)).toEqual({ ok: true, bps: 1, maxBps: 300 })
    expect(validateSlippageBps(123, 300)).toEqual({ ok: true, bps: 123, maxBps: 300 })
    expect(validateSlippageBps(300, 300)).toEqual({ ok: true, bps: 300, maxBps: 300 })
  })

  it('refuses above the ceiling, including a flag above 300 bps', () => {
    expect(validateSlippageBps(301, 300)).toEqual({ ok: false, reason: 'above-max', maxBps: 300 })
    expect(validateSlippageBps(101, 100)).toEqual({ ok: false, reason: 'above-max', maxBps: 100 })
    expect(validateSlippageBps(500, 1_000)).toEqual({
      ok: false,
      reason: 'above-max',
      maxBps: 300,
    })
  })

  it('refuses zero, negatives and anything that is not a whole number of bps', () => {
    expect(validateSlippageBps(0, 300)).toEqual({ ok: false, reason: 'below-min', maxBps: 300 })
    expect(validateSlippageBps(-5, 300)).toEqual({ ok: false, reason: 'below-min', maxBps: 300 })
    for (const bad of [0.5, 49.999, Number.NaN, Number.POSITIVE_INFINITY])
      expect(validateSlippageBps(bad, 300)).toEqual({
        ok: false,
        reason: 'not-integer',
        maxBps: 300,
      })
  })

  it('fails closed when the flag ceiling is unusable, even for the default', () => {
    for (const flag of [0, -1, 2.5, Number.NaN])
      expect(validateSlippageBps(undefined, flag)).toEqual({
        ok: false,
        reason: 'max-invalid',
        maxBps: null,
      })
  })
})

describe('minAmountOut', () => {
  it('is floor(quoted × (10 000 − s) / 10 000)', () => {
    expect(minAmountOut(10_000n, 50)).toBe(9_950n)
    expect(minAmountOut(1_000_000n, 300)).toBe(970_000n)
    // 12 345 × 9 950 / 10 000 = 12 283.275 → 12 283
    expect(minAmountOut(12_345n, 50)).toBe(12_283n)
  })

  it('rounds down, never up, and stays within one raw unit of the exact tolerance', () => {
    // 19 999 × 0.995 = 19 899.005 → 19 899; 19 999 × 0.97 = 19 399.03 → 19 399
    expect(minAmountOut(19_999n, 50)).toBe(19_899n)
    expect(minAmountOut(19_999n, 300)).toBe(19_399n)
    for (let q = 0n; q < 2_000n; q += 7n) {
      for (const s of [1, 50, 299, 300]) {
        const min = minAmountOut(q, s)
        const exactTimes1e4 = q * BigInt(10_000 - s)
        expect(min * 10_000n <= exactTimes1e4).toBe(true)
        expect((min + 1n) * 10_000n > exactTimes1e4).toBe(true)
      }
    }
  })

  it('is 0 for a zero quote and for a quote too small to keep a unit after slippage', () => {
    expect(minAmountOut(0n, 50)).toBe(0n)
    expect(minAmountOut(1n, 50)).toBe(0n)
    expect(minAmountOut(1n, 1)).toBe(0n)
    // The smallest quote that keeps one unit at 50 bps: ceil(10 000 / 9 950) = 2.
    expect(minAmountOut(2n, 50)).toBe(1n)
    expect(minAmountOut(1n, 0)).toBe(1n)
  })

  it('keeps the quote at 0 bps and gives 0 at 10 000 bps', () => {
    expect(minAmountOut(987_654_321n, 0)).toBe(987_654_321n)
    expect(minAmountOut(987_654_321n, 10_000)).toBe(0n)
  })

  it('is exact at the uint256 maximum', () => {
    expect(minAmountOut(MAX_UINT256, 0)).toBe(MAX_UINT256)
    expect(minAmountOut(MAX_UINT256, 50)).toBe((MAX_UINT256 * 9_950n) / 10_000n)
    expect(minAmountOut(MAX_UINT256, 50) < MAX_UINT256).toBe(true)
  })

  it('works in raw units for 6-, 8- and 18-decimal tokens alike', () => {
    // 22.904017 USDC (6 decimals) at 50 bps: 22 904 017 × 0.995 = 22 789 496.915 → 22 789 496
    expect(minAmountOut(22_904_017n, 50)).toBe(22_789_496n)
    // 0.01234567 cbBTC (8 decimals) at 100 bps: 1 234 567 × 0.99 = 1 222 221.33 → 1 222 221
    expect(minAmountOut(1_234_567n, 100)).toBe(1_222_221n)
    // 0.398641021960442175 WETH (18 decimals) at 50 bps
    expect(minAmountOut(398_641_021_960_442_175n, 50)).toBe(396_647_816_850_639_964n)
  })

  it('throws on a quote outside uint256 or a slippage outside 0..10 000 integers', () => {
    expect(() => minAmountOut(-1n, 50)).toThrow(RangeError)
    expect(() => minAmountOut(MAX_UINT256 + 1n, 50)).toThrow(RangeError)
    for (const s of [-1, 10_001, 0.5, Number.NaN])
      expect(() => minAmountOut(100n, s)).toThrow(RangeError)
  })
})

describe('tradeDeadline', () => {
  it('is the latest block timestamp plus 300 s', () => {
    expect(tradeDeadline(1_793_722_565n)).toBe(1_793_722_865n)
    expect(tradeDeadline(0n)).toBe(300n)
  })

  it('takes another window', () => {
    expect(tradeDeadline(1_000n, 60n)).toBe(1_060n)
    expect(tradeDeadline(1_000n, 0n)).toBe(1_000n)
  })

  it('throws on a negative timestamp or window and on a deadline past uint256', () => {
    expect(() => tradeDeadline(-1n)).toThrow(RangeError)
    expect(() => tradeDeadline(1n, -1n)).toThrow(RangeError)
    expect(() => tradeDeadline(MAX_UINT256)).toThrow(RangeError)
    expect(tradeDeadline(MAX_UINT256 - 300n)).toBe(MAX_UINT256)
  })
})

describe('isUint256', () => {
  it('accepts 0 to 2^256 − 1 only', () => {
    expect(isUint256(0n)).toBe(true)
    expect(isUint256(MAX_UINT256)).toBe(true)
    expect(isUint256(-1n)).toBe(false)
    expect(isUint256(MAX_UINT256 + 1n)).toBe(false)
  })
})
