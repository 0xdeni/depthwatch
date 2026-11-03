/**
 * Calldata of the swap per route: every `to` is a compiled-in router (or the input token for the
 * approval), every recipient the account or the router itself before `unwrapWETH9` to the account,
 * ETH in on SwapRouter02 followed by `refundETH()`, the approval exactly the input, the quote
 * addressed to the route's quoter, a quote that stopped at the price limit refused as a partial
 * fill whatever the quoter, and the selectors those of the signatures the routers and quoters
 * declare.
 */
import {
  quoterV2Abi,
  slipstreamQuoterV2Abi,
  swapRouter02Abi,
  TOKENS,
  TRADE_ROUTES,
  type TradeRoute,
} from '@depthwatch/chain/addresses'
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from '@depthwatch/core'
import { decodeFunctionData, encodeFunctionResult, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { decodeSwap } from '../testing/swapCalldata.js'
import {
  approveCall,
  decodeQuote,
  type PoolKey,
  quoteCall,
  type SwapIntent,
  swapCall,
} from './venue.js'

const WETH = TOKENS.WETH.address
const USDC = TOKENS.USDC.address
const ACCOUNT = '0x00000000000000000000000000000000000a11ce'
const POOL: PoolKey = {
  address: '0xd0b53d9277642d899df5c87a3966a349a798f224',
  token0: WETH,
  token1: USDC,
  fee: 500,
  tickSpacing: 100,
}
const route = (deployment: string) => TRADE_ROUTES.find((r) => r.deployment === deployment)!
const ROUTERS = new Set(TRADE_ROUTES.map((r) => r.router))

const SELECTOR = {
  router02Multicall: toFunctionSelector('multicall(uint256,bytes[])'),
  router02Swap: toFunctionSelector(
    'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
  ),
  slipMulticall: toFunctionSelector('multicall(bytes[])'),
  slipSwap: toFunctionSelector(
    'exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))',
  ),
  unwrap: toFunctionSelector('unwrapWETH9(uint256,address)'),
  refund: toFunctionSelector('refundETH()'),
  approve: toFunctionSelector('approve(address,uint256)'),
}

function intent(r: TradeRoute, over: Partial<SwapIntent> = {}): SwapIntent {
  return {
    route: r,
    pool: POOL,
    tokenIn: USDC,
    tokenOut: WETH,
    amountIn: 100_000_000n,
    minOut: 25_000_000_000_000_000n,
    account: ACCOUNT,
    deadline: 1_760_000_300n,
    ethIn: false,
    ethOut: false,
    ...over,
  }
}

describe('Uniswap v3 through SwapRouter02', () => {
  const r = route('uniswap-v3')

  it('wraps exactInputSingle in multicall(deadline, …), paid to the account', () => {
    const tx = swapCall(intent(r))
    expect(ROUTERS.has(tx.to)).toBe(true)
    expect(tx.to).toBe('0x2626664c2603336e57b271c5c0b26f421741e481')
    expect(tx.data.startsWith(SELECTOR.router02Multicall)).toBe(true)
    expect(tx.value).toBe(0n)
    const swap = decodeSwap(r, tx.data)!
    expect(swap).toMatchObject({ tokenIn: USDC, tokenOut: WETH, recipient: ACCOUNT, unwrap: null })
    expect(swap.amountOutMinimum).toBe(25_000_000_000_000_000n)
    expect(swap.multicallDeadline).toBe(1_760_000_300n)
  })

  it('pays ETH in as value, WETH as tokenIn, and ends with refundETH()', () => {
    const tx = swapCall(
      intent(r, { tokenIn: WETH, tokenOut: USDC, amountIn: 10n ** 17n, ethIn: true }),
    )
    expect(tx.value).toBe(10n ** 17n)
    expect(decodeSwap(r, tx.data)).toMatchObject({ tokenIn: WETH, recipient: ACCOUNT })
    // SwapRouter02 keeps ETH a pool did not take; refundETH() sends it back to the sender.
    expect(innerSelectors(tx.data)).toEqual([SELECTOR.router02Swap, SELECTOR.refund])
    expect(innerSelectors(swapCall(intent(r)).data)).toEqual([SELECTOR.router02Swap])
  })

  it('pays ETH out through the router and unwrapWETH9(minOut, account)', () => {
    const tx = swapCall(intent(r, { ethOut: true }))
    const swap = decodeSwap(r, tx.data)!
    // V3SwapRouter: Constants.ADDRESS_THIS = address(2) (docs/research/base-contracts.md, ## trade).
    expect(swap.recipient).toBe('0x0000000000000000000000000000000000000002')
    expect(swap.unwrap).toEqual({ amountMinimum: swap.amountOutMinimum, recipient: ACCOUNT })
    expect(innerSelectors(tx.data)).toEqual([SELECTOR.router02Swap, SELECTOR.unwrap])
  })

  it('quotes through QuoterV2 by fee', () => {
    const q = quoteCall(r, POOL, USDC, 1n)
    expect(q.to).toBe(r.quoter)
    expect(
      q.data.startsWith(
        toFunctionSelector('quoteExactInputSingle((address,address,uint256,uint24,uint160))'),
      ),
    ).toBe(true)
  })

  it('refuses a QuoterV2 quote that stopped at the open price limit as a partial fill', () => {
    const at = (after: bigint) =>
      encodeFunctionResult({
        abi: quoterV2Abi,
        functionName: 'quoteExactInputSingle',
        result: [7n, after, 1, 90_000n],
      })
    expect(decodeQuote(r, at(MIN_SQRT_RATIO + 1n), true).partial).toBe(true)
    expect(decodeQuote(r, at(MAX_SQRT_RATIO - 1n), false).partial).toBe(true)
    expect(decodeQuote(r, at(MAX_SQRT_RATIO - 1n), true).partial).toBe(false)
    expect(decodeQuote(r, at(1n << 96n), true)).toEqual({
      amountOut: 7n,
      sqrtPriceX96After: 1n << 96n,
      partial: false,
    })
  })
})

/** The selectors of the calls inside SwapRouter02's `multicall(deadline, bytes[])`. */
function innerSelectors(data: `0x${string}`): string[] {
  const outer = decodeFunctionData({ abi: swapRouter02Abi, data })
  if (outer.functionName !== 'multicall') return []
  return outer.args[1].map((call) => call.slice(0, 10))
}

describe.each(['initial', 'gauge-caps', 'gauges-v3'])('Aerodrome Slipstream %s', (deployment) => {
  const r = route(deployment)

  it('calls exactInputSingle with the deadline in the struct, paid to the account', () => {
    const tx = swapCall(intent(r))
    expect(tx.to).toBe(r.router)
    expect(tx.data.startsWith(SELECTOR.slipSwap)).toBe(true)
    expect(decodeSwap(r, tx.data)).toMatchObject({
      recipient: ACCOUNT,
      deadline: 1_760_000_300n,
      unwrap: null,
    })
  })

  it('pays ETH out through multicall([swap to the router, unwrapWETH9(minOut, account)])', () => {
    const tx = swapCall(intent(r, { ethOut: true }))
    expect(tx.data.startsWith(SELECTOR.slipMulticall)).toBe(true)
    const swap = decodeSwap(r, tx.data)!
    // Slipstream's exactInputInternal: `if (recipient == address(0)) recipient = address(this)`.
    expect(swap.recipient).toBe('0x0000000000000000000000000000000000000000')
    expect(swap.unwrap).toEqual({ amountMinimum: swap.amountOutMinimum, recipient: ACCOUNT })
  })

  it('quotes through its own QuoterV2 by tick spacing', () => {
    const q = quoteCall(r, POOL, WETH, 1n)
    expect(q.to).toBe(r.quoter)
    expect(
      q.data.startsWith(
        toFunctionSelector('quoteExactInputSingle((address,address,uint256,int24,uint160))'),
      ),
    ).toBe(true)
  })

  it('refuses a quote that stopped at the open price limit as a partial fill', () => {
    const at = (after: bigint) =>
      encodeFunctionResult({
        abi: slipstreamQuoterV2Abi,
        functionName: 'quoteExactInputSingle',
        result: [7n, after, 1, 90_000n],
      })
    expect(decodeQuote(r, at(MAX_SQRT_RATIO - 1n), false).partial).toBe(true)
    expect(decodeQuote(r, at(MAX_SQRT_RATIO - 2n), false).partial).toBe(false)
  })
})

describe('Aero Slipstream (coded, held)', () => {
  const r = TRADE_ROUTES.find((x) => x.venue === 'aero-slipstream')!

  it('addresses the Metaquoter with the pool and an open price limit', () => {
    expect(r.hold).not.toBeNull()
    const q = quoteCall(r, POOL, WETH, 5n)
    expect(q.to).toBe(r.quoter)
    const { args } = decodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'quoteExactInputSingleV3',
          stateMutability: 'nonpayable',
          inputs: [
            { type: 'address' },
            { type: 'address' },
            { type: 'uint256' },
            { type: 'uint160' },
          ],
          outputs: [],
        },
      ],
      data: q.data,
    })
    expect(args).toEqual([
      expect.stringMatching(/^0xd0b53d92/i),
      expect.stringMatching(/^0x4200/),
      5n,
      MIN_SQRT_RATIO + 1n,
    ])
  })

  it('refuses a quote that stopped at the price limit as a partial fill', () => {
    const abi = [
      {
        type: 'function',
        name: 'quoteExactInputSingleV3',
        stateMutability: 'nonpayable',
        inputs: [],
        outputs: [{ type: 'uint256' }, { type: 'uint160' }, { type: 'uint32' }],
      },
    ] as const
    const at = (after: bigint) =>
      encodeFunctionResult({ abi, functionName: 'quoteExactInputSingleV3', result: [7n, after, 3] })
    expect(decodeQuote(r, at(MIN_SQRT_RATIO + 1n), true).partial).toBe(true)
    expect(decodeQuote(r, at(MIN_SQRT_RATIO + 2n), true)).toEqual({
      amountOut: 7n,
      sqrtPriceX96After: MIN_SQRT_RATIO + 2n,
      partial: false,
    })
  })
})

describe('approval', () => {
  it('approves the router for exactly the input, to the token', () => {
    const tx = approveCall(USDC, route('uniswap-v3').router, 100_000_000n)
    expect(tx).toMatchObject({ to: USDC, value: 0n })
    expect(tx.data.startsWith(SELECTOR.approve)).toBe(true)
    expect(BigInt(`0x${tx.data.slice(-64)}`)).toBe(100_000_000n)
  })
})
