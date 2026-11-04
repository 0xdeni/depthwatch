/**
 * The live-pool and snapshot bounds compare the pool's mid with the reference's, both before the
 * trade (docs/METRICS.md, "Swap checks"): a pool with a 2 % fee is held to the same bounds as any
 * other in both directions, and a pool whose own price is off is refused whichever way it is
 * traded. The fee and the impact are the price impact's bound.
 */

import { describe, expect, it } from 'vitest'
import { simulateSwapExactIn } from '../swap/index.js'
import { buildConstantProductState } from '../testing.js'
import { checkTrade, type TradeCheckInput } from './decision.js'
import { humanPriceToRawPrice } from './prices.js'

const WETH = 10n ** 18n
const USDC = 10n ** 6n
/** WETH (token0, 18 decimals) and USDC (token1, 6) at a mid of 2,500, with a 2 % fee. */
const pool = buildConstantProductState(1_000n * WETH, 2_500_000n * USDC, 20_000)
const mid = { num: pool.reserve1, den: pool.reserve0 }
const at = (price: number) => {
  const raw = humanPriceToRawPrice(price, 18, 6)
  if (!raw) throw new Error(`no raw price for ${price}`)
  return raw
}

/** Sells 0.1 WETH or buys with 250 USDC ($250 either way) against one reference pool. */
function trade(direction: TradeCheckInput['direction'], reference: number): TradeCheckInput {
  const amountIn = direction === 'zeroForOne' ? WETH / 10n : 250n * USDC
  const weth = { decimals: 18, usdPrice: 2_500 }
  const usdc = { decimals: 6, usdPrice: 1 }
  return {
    direction,
    amountIn,
    quotedAmountOut: simulateSwapExactIn(pool, direction, amountIn).amountOut,
    poolMid: mid,
    limits: { maxUsd: 1_000, maxSlippageBps: 300 },
    tokenIn: direction === 'zeroForOne' ? weth : usdc,
    tokenOut: direction === 'zeroForOne' ? usdc : weth,
    snapshotMid: at(2_500),
    otherPoolMids: [at(reference)],
  }
}

describe('checkTrade: a 2 % fee pool against another live pool of the pair', () => {
  it('is tradeable both ways when its mid is within 2 % of the other pool’s', () => {
    // 2,530 / 2,500 − 1 = 120 bps. Selling at about 2,450 is 3.3 % from 2,530, buying at about
    // 2,551 is 0.8 %: compared with the average prices, only the purchase would pass.
    for (const direction of ['zeroForOne', 'oneForZero'] as const)
      expect(checkTrade(trade(direction, 2_530)), direction).toMatchObject({
        kind: 'warn',
        reason: 'price-impact-high',
      })
  })

  it('is refused both ways when its mid is 3 % off the other pool’s', () => {
    // 2,575 / 2,500 − 1 = 300 bps whatever the direction or the amount.
    for (const direction of ['zeroForOne', 'oneForZero'] as const)
      expect(checkTrade(trade(direction, 2_575)), direction).toEqual({
        kind: 'refuse',
        reason: 'live-deviation-above-max',
        value: 300,
        limit: 200,
      })
  })

  it('holds the snapshot bound to the mid as well: 10 % from it passes both ways', () => {
    for (const direction of ['zeroForOne', 'oneForZero'] as const) {
      const input = { ...trade(direction, 2_500), snapshotMid: at(2_750) }
      expect(checkTrade(input), direction).toMatchObject({ kind: 'warn' })
      expect(checkTrade({ ...input, snapshotMid: at(2_751) }), direction).toMatchObject({
        reason: 'snapshot-deviation-above-max',
        value: 1_004,
      })
    }
  })
})
