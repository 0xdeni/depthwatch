/**
 * Calldata of the swap: `exactInputSingle` in one pool, through the router its factory
 * is bound to (`TradeRoute`, compiled into `@depthwatch/chain/addresses`), and the quote of the
 * same swap from that route's quoter (read with `eth_call`, never sent). Two router encodings:
 * - `swap-router-02` (Uniswap): no deadline in the struct, so the swap is wrapped in
 *   `multicall(deadline, [...])`; recipient `address(2)` is the router itself;
 * - `slipstream` (Aerodrome Slipstream, Aero): the deadline sits in the struct and `multicall`
 *   takes none; recipient `address(0)` is the router itself; `exactInputSingle` ends with
 *   `refundETH()`.
 * ETH in: `value` = amount with WETH as `tokenIn` (the router wraps what the pool takes); on
 * SwapRouter02, whose `exactInputSingle` refunds nothing, the multicall ends with `refundETH()` so
 * ETH a pool did not take goes back to the account, not to the router. ETH out: the router keeps
 * the WETH and `unwrapWETH9(minOut, account)` sends ETH to the account in the same multicall.
 * Every recipient is the connected account; every `to` is a route's router or the input token.
 */
import {
  metaquoterAbi,
  quoterV2Abi,
  slipstreamQuoterV2Abi,
  slipstreamSwapRouterAbi,
  swapRouter02Abi,
  type TradeRoute,
  tradeErc20Abi,
} from '@depthwatch/chain/addresses'
import { type Address, MAX_SQRT_RATIO, MIN_SQRT_RATIO } from '@depthwatch/core'
import { decodeFunctionResult, encodeFunctionData, type Hex } from 'viem'

/** The pool as read on chain (`trade/reads.ts`), every address lowercase. */
export interface PoolKey {
  address: Address
  token0: Address
  token1: Address
  /** `fee()` in pips: the Uniswap v3 pool key. */
  fee: number
  /** `tickSpacing()`: the Slipstream pool key. */
  tickSpacing: number
}

/** One transaction: the only shape the panel sends. */
export interface TxRequest {
  to: Address
  data: Hex
  value: bigint
}

export interface SwapIntent {
  route: TradeRoute
  pool: PoolKey
  /** WETH when paying with ETH. */
  tokenIn: Address
  /** WETH when receiving ETH. */
  tokenOut: Address
  amountIn: bigint
  minOut: bigint
  /** The connected account: the only recipient. */
  account: Address
  /** Unix seconds (`tradeDeadline` of core). */
  deadline: bigint
  ethIn: boolean
  ethOut: boolean
}

/** SwapRouter02's `ADDRESS_THIS`: the router keeps the output (for `unwrapWETH9`). */
export const SWAP_ROUTER_02_SELF: Address = '0x0000000000000000000000000000000000000002'
/** The Slipstream routers read a zero recipient as the router itself. */
export const SLIPSTREAM_SELF: Address = '0x0000000000000000000000000000000000000000'

/** The price limit that lets the swap run to the end of the range (the quoters' "no limit"). */
export function openPriceLimit(zeroForOne: boolean): bigint {
  return zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n
}

/** `eth_call` of the route's quoter for an exact-input swap of `amountIn` of `tokenIn`. */
export function quoteCall(
  route: TradeRoute,
  pool: PoolKey,
  tokenIn: Address,
  amountIn: bigint,
): { to: Address; data: Hex } {
  const tokenOut = tokenIn === pool.token0 ? pool.token1 : pool.token0
  if (route.quoterAbi === 'quoter-v2') {
    const params = { tokenIn, tokenOut, amountIn, fee: pool.fee, sqrtPriceLimitX96: 0n }
    const data = encodeFunctionData({
      abi: quoterV2Abi,
      functionName: 'quoteExactInputSingle',
      args: [params],
    })
    return { to: route.quoter, data }
  }
  if (route.quoterAbi === 'slipstream-quoter-v2') {
    const params = {
      tokenIn,
      tokenOut,
      amountIn,
      tickSpacing: pool.tickSpacing,
      sqrtPriceLimitX96: 0n,
    }
    const data = encodeFunctionData({
      abi: slipstreamQuoterV2Abi,
      functionName: 'quoteExactInputSingle',
      args: [params],
    })
    return { to: route.quoter, data }
  }
  const limit = openPriceLimit(tokenIn === pool.token0)
  const data = encodeFunctionData({
    abi: metaquoterAbi,
    functionName: 'quoteExactInputSingleV3',
    args: [pool.address, tokenIn, amountIn, limit],
  })
  return { to: route.quoter, data }
}

export interface QuoteResult {
  amountOut: bigint
  sqrtPriceX96After: bigint
  /**
   * True when the swap stopped at the price limit, which leaves part of `amountIn` unused: no
   * quoter signals it otherwise (QuoterV2 called with limit 0 uses the same open limit, and its
   * callback returns the output without checking the input), so such a quote is refused.
   */
  partial: boolean
}

export function decodeQuote(route: TradeRoute, data: Hex, zeroForOne: boolean): QuoteResult {
  const [amountOut, sqrtPriceX96After] =
    route.quoterAbi === 'metaquoter'
      ? decodeFunctionResult({ abi: metaquoterAbi, functionName: 'quoteExactInputSingleV3', data })
      : decodeFunctionResult({
          abi: route.quoterAbi === 'quoter-v2' ? quoterV2Abi : slipstreamQuoterV2Abi,
          functionName: 'quoteExactInputSingle',
          data,
        })
  return {
    amountOut,
    sqrtPriceX96After,
    partial: sqrtPriceX96After === openPriceLimit(zeroForOne),
  }
}

/** The swap transaction of `intent`, to the route's router. */
export function swapCall(intent: SwapIntent): TxRequest {
  const { route, pool, tokenIn, tokenOut, amountIn, minOut, account, deadline, ethIn, ethOut } =
    intent
  const value = ethIn ? amountIn : 0n
  if (route.routerAbi === 'swap-router-02') {
    const params = {
      tokenIn,
      tokenOut,
      fee: pool.fee,
      recipient: ethOut ? SWAP_ROUTER_02_SELF : account,
      amountIn,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0n,
    }
    const calls: Hex[] = [
      encodeFunctionData({
        abi: swapRouter02Abi,
        functionName: 'exactInputSingle',
        args: [params],
      }),
    ]
    if (ethOut)
      calls.push(
        encodeFunctionData({
          abi: swapRouter02Abi,
          functionName: 'unwrapWETH9',
          args: [minOut, account],
        }),
      )
    if (ethIn) calls.push(encodeFunctionData({ abi: swapRouter02Abi, functionName: 'refundETH' }))
    const data = encodeFunctionData({
      abi: swapRouter02Abi,
      functionName: 'multicall',
      args: [deadline, calls],
    })
    return { to: route.router, data, value }
  }
  const params = {
    tokenIn,
    tokenOut,
    tickSpacing: pool.tickSpacing,
    recipient: ethOut ? SLIPSTREAM_SELF : account,
    deadline,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  }
  const swap = encodeFunctionData({
    abi: slipstreamSwapRouterAbi,
    functionName: 'exactInputSingle',
    args: [params],
  })
  if (!ethOut) return { to: route.router, data: swap, value }
  const unwrap = encodeFunctionData({
    abi: slipstreamSwapRouterAbi,
    functionName: 'unwrapWETH9',
    args: [minOut, account],
  })
  const data = encodeFunctionData({
    abi: slipstreamSwapRouterAbi,
    functionName: 'multicall',
    args: [[swap, unwrap]],
  })
  return { to: route.router, data, value }
}

/** `approve(router, amount)` for exactly the swap's input: never more. */
export function approveCall(token: Address, spender: Address, amount: bigint): TxRequest {
  const data = encodeFunctionData({
    abi: tradeErc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })
  return { to: token, data, value: 0n }
}
