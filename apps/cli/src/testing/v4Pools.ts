/**
 * Uniswap v4 pools on a built concentrated state, for the pipeline's unit tests that need a pool's
 * overview and state without a chain (`snapshot.test.ts`, `tracking.test.ts`,
 * `snapshot.stocks.test.ts`): a pool of any two tokens at a price, its liquidity in ±20 % of it.
 */
import type { PoolOverview } from '@depthwatch/chain'
import {
  type Address,
  buildConcentratedState,
  type ConcentratedState,
  getTickAtSqrtRatio,
  type PoolMeta,
  priceToSqrtPriceX96,
  type TokenInfo,
} from '@depthwatch/core'

export const token = (address: string, symbol: string, decimals: number): TokenInfo => ({
  address: address.toLowerCase() as Address,
  symbol,
  name: symbol,
  decimals,
})

export const WETH = token('0x4200000000000000000000000000000000000006', 'WETH', 18)
export const USDC = token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 6)
export const HOOK: Address = '0x00000000000000000000000000000000000000c0'

/** A Uniswap v4 pool `uniswap-v4:<label>` (fee 0.05 %, tick spacing 10) of two sorted tokens. */
export function v4Pool(
  label: string,
  token0: TokenInfo,
  token1: TokenInfo,
  hooks: Address | null = null,
): PoolMeta {
  if (token0.address >= token1.address) throw new Error(`${label}: tokens not sorted`)
  const hex = [...label].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return {
    id: `uniswap-v4:${label}`,
    dex: 'uniswap-v4',
    kind: 'concentrated',
    address: null,
    poolId: `0x${hex.padEnd(64, '0').slice(0, 64)}`,
    token0,
    token1,
    feePips: 500,
    tickSpacing: 10,
    stable: false,
    hooks,
    createdAtBlock: 1n,
  }
}

/** `pool` at `price` (token1 per token0, human) with `liquidity` in ±20 % of it. */
export function v4PoolAt(
  pool: PoolMeta,
  price: number,
  liquidity: bigint,
): { view: PoolOverview; state: ConcentratedState } {
  const sqrtPriceX96 = priceToSqrtPriceX96(price, pool.token0.decimals, pool.token1.decimals)
  const tick = getTickAtSqrtRatio(sqrtPriceX96)
  const aligned = Math.floor(tick / 10) * 10
  const state = buildConcentratedState({
    positions: [{ tickLower: aligned - 2_000, tickUpper: aligned + 2_000, liquidity }],
    tick,
    sqrtPriceX96,
    feePips: 500,
    tickSpacing: 10,
    tickLowerBound: aligned - 4_000,
    tickUpperBound: aligned + 4_000,
  })
  const view: PoolOverview = {
    pool,
    blockNumber: state.blockNumber,
    sqrtPriceX96,
    tick,
    liquidity: state.liquidity,
    reserve0: 0n,
    reserve1: 0n,
  }
  return { view, state }
}
