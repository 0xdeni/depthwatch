/**
 * Test helper: the swap a router's calldata asks for, decoded with the routers' own ABIs from
 * `@depthwatch/chain/addresses` (any trailing data suffix ignored), every address lowercase.
 */
import {
  slipstreamSwapRouterAbi,
  swapRouter02Abi,
  type TradeRoute,
} from '@depthwatch/chain/addresses'
import type { Address } from '@depthwatch/core'
import { decodeFunctionData, type Hex } from 'viem'

export interface DecodedSwap {
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  amountOutMinimum: bigint
  recipient: Address
  deadline?: bigint
}

/** The swap a router's calldata asks for (after any suffix), or null when it is not one. */
export function decodeSwap(route: TradeRoute, data: Hex) {
  const abi = route.routerAbi === 'swap-router-02' ? swapRouter02Abi : slipstreamSwapRouterAbi
  const top = decodeFunctionData({ abi, data })
  const inner: Hex[] =
    top.functionName === 'multicall'
      ? ((top.args.length === 2 ? top.args[1] : top.args[0]) as Hex[])
      : [data]
  let swap: DecodedSwap | null = null
  let unwrap: { amountMinimum: bigint; recipient: Address } | null = null
  for (const call of inner) {
    const decoded = decodeFunctionData({ abi, data: call })
    if (decoded.functionName === 'exactInputSingle') swap = decoded.args[0] as DecodedSwap
    if (decoded.functionName === 'unwrapWETH9') {
      const [amountMinimum, recipient] = decoded.args as [bigint, Address]
      unwrap = { amountMinimum, recipient: recipient.toLowerCase() as Address }
    }
  }
  if (!swap) return null
  return {
    ...swap,
    tokenIn: swap.tokenIn.toLowerCase() as Address,
    tokenOut: swap.tokenOut.toLowerCase() as Address,
    recipient: swap.recipient.toLowerCase() as Address,
    multicallDeadline:
      top.functionName === 'multicall' && top.args.length === 2 ? (top.args[0] as bigint) : null,
    unwrap,
  }
}
