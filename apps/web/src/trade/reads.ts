/**
 * What the swap panel reads on chain, all through the connected wallet's own provider (no RPC of
 * Depthwatch's, no key): the pool's identity, the live quote and the pool's price at one block,
 * balances and allowances. Quoters are only ever called with `eth_call`.
 */
import {
  clFactoryGetPoolAbi,
  isTradeToken,
  slipstreamSwapRouterAbi,
  swapRouter02Abi,
  type TradeRoute,
  tradeErc20Abi,
  tradePoolAbi,
  tradeRouteFor,
  uniswapV3GetPoolAbi,
} from '@depthwatch/chain/addresses'
import { type Address, type Fraction, sqrtPriceX96ToRawPrice } from '@depthwatch/core'
import {
  type Abi,
  type Client,
  type ContractFunctionName,
  createClient,
  custom,
  decodeFunctionResult,
  encodeFunctionData,
} from 'viem'
import { call, getBalance, getBlock } from 'viem/actions'
import { base } from 'viem/chains'
import { decodeQuote, type PoolKey, quoteCall } from './venue.js'
import type { Eip1193Provider } from './wallets.js'

/** A refusal the panel words for the reader (`trade/text.ts`). */
export class TradeStop extends Error {
  constructor(readonly reason: StopReason) {
    super(reason)
    this.name = 'TradeStop'
  }
}

export type StopReason =
  | 'no-route'
  | 'pool-mismatch'
  | 'token-not-allowed'
  | 'quote-failed'
  | 'partial-fill'
  | 'switched-off'
  | 'simulation-failed'
  | 'balance-low'
  | 'allowance-low'
  | 'refused'

/**
 * The client over the wallet's provider: reads, simulations and sends. It appends nothing:
 * send.ts adds the Builder Code to an EOA's calldata itself, the bytes it simulated.
 */
export interface WalletClients {
  plain: Client
}

export function walletClients(provider: Eip1193Provider): WalletClients {
  // No transport retries: a read failing is answered by the panel, and a signature request is sent
  // once (send.ts), never repeated behind the reader's back.
  const transport = custom(provider as Parameters<typeof custom>[0], { retryCount: 0 })
  return { plain: createClient({ chain: base, transport }) }
}

/** `slot0()` of Uniswap v3 and Slipstream pools, cut to the word both declare first. */
const slot0Abi = [
  {
    type: 'function',
    name: 'slot0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }],
  },
] as const

async function read<const abi extends Abi>(
  client: Client,
  to: Address,
  abi: abi,
  functionName: ContractFunctionName<abi>,
  args: readonly unknown[] = [],
  blockNumber?: bigint,
): Promise<unknown> {
  const data = encodeFunctionData({ abi, functionName, args } as never)
  const result = await call(client, { to, data, blockNumber })
  if (!result.data) throw new TradeStop('quote-failed')
  return decodeFunctionResult({ abi, functionName, data: result.data } as never)
}

const lower = (value: unknown) => String(value).toLowerCase() as Address

export interface PoolUnderTrade {
  address: Address
  dex: string
  token0: Address
  token1: Address
}

export interface CheckedPool {
  route: TradeRoute
  key: PoolKey
}

/**
 * The pool's identity, checked on chain before any quote: its `factory()` names the route (and
 * so the router), the router's own `factory()` is that factory, the factory's `getPool` for the
 * pool's tokens and fee (Uniswap) or tick spacing (Slipstream) is this pool, its tokens are the
 * page's and both are on the allowlist. Throws `TradeStop` otherwise.
 */
export async function checkPool(client: Client, pool: PoolUnderTrade): Promise<CheckedPool> {
  if (!isTradeToken(pool.token0) || !isTradeToken(pool.token1))
    throw new TradeStop('token-not-allowed')
  const [factory, token0, token1] = await Promise.all(
    (['factory', 'token0', 'token1'] as const).map((name) =>
      read(client, pool.address, tradePoolAbi, name).then(lower),
    ),
  )
  const route = tradeRouteFor(pool.dex as TradeRoute['venue'], factory ?? '')
  if (!route) throw new TradeStop('no-route')
  if (token0 !== pool.token0 || token1 !== pool.token1) throw new TradeStop('pool-mismatch')
  const uniswap = route.routerAbi === 'swap-router-02'
  const keyName = uniswap ? 'fee' : 'tickSpacing'
  const routerFactory = uniswap
    ? read(client, route.router, swapRouter02Abi, 'factory')
    : read(client, route.router, slipstreamSwapRouterAbi, 'factory')
  const [boundTo, keyValue] = await Promise.all([
    routerFactory.then(lower),
    read(client, pool.address, tradePoolAbi, keyName).then(Number),
  ])
  if (boundTo !== route.factory) throw new TradeStop('no-route')
  const listed = uniswap
    ? await read(client, route.factory, uniswapV3GetPoolAbi, 'getPool', [token0, token1, keyValue])
    : await read(client, route.factory, clFactoryGetPoolAbi, 'getPool', [token0, token1, keyValue])
  if (lower(listed) !== pool.address) throw new TradeStop('pool-mismatch')
  const key: PoolKey = {
    address: pool.address,
    token0: pool.token0,
    token1: pool.token1,
    fee: uniswap ? keyValue : 0,
    tickSpacing: uniswap ? 0 : keyValue,
  }
  return { route, key }
}

/** One live read of the swap: the quote and the prices it is checked against, at one block. */
export interface LiveQuote {
  blockNumber: bigint
  /** The block's timestamp, unix seconds. */
  timestamp: bigint
  amountOut: bigint
  /** The pool's raw price before the swap (token1 per token0, raw units), or null. */
  poolMid: Fraction | null
  /** Raw prices of the reference pools of the same pair, at the same block. */
  otherMids: Fraction[]
  /**
   * The pool's `fee()` at the same block, in pips (`feeOf`): the fee a swap at that block pays; it
   * can change by the block the swap lands in.
   */
  feePips: number
}

async function midOf(client: Client, pool: Address, blockNumber: bigint): Promise<Fraction | null> {
  const sqrt = (await read(client, pool, slot0Abi, 'slot0', [], blockNumber)) as bigint
  return sqrtPriceX96ToRawPrice(sqrt)
}

/**
 * The fee a swap in `pool` pays at `blockNumber`, in pips: the pool's `fee()`, which is what
 * `swap()` reads when it starts. On Uniswap v3 it is the pool's fixed tier. On a Slipstream pool
 * (aerodrome-finance/slipstream `CLPool.sol`) `swap()` sets its fee to `fee()`, and `fee()` is
 * `ICLFactory(factory).getSwapFee(address(this))`, the deployment's swap fee module, which can
 * change from one block to the next; `unstakedFee()` only splits that fee between the pool's
 * unstaked liquidity and its gauge, and costs the trader nothing more.
 */
async function feeOf(client: Client, pool: Address, blockNumber: bigint): Promise<number> {
  return Number(await read(client, pool, tradePoolAbi, 'fee', [], blockNumber))
}

/**
 * Quotes `amountIn` of `tokenIn` on the checked pool and reads the pool's price and fee and the
 * prices of `references`, all at the latest block. A reference that cannot be read is left out; a
 * quote that fails, that fills only part of the input, or whose fee cannot be read, throws
 * `TradeStop`.
 */
export async function readQuote(
  client: Client,
  checked: CheckedPool,
  tokenIn: Address,
  amountIn: bigint,
  references: readonly Address[],
): Promise<LiveQuote> {
  const block = await getBlock(client, { blockTag: 'latest' })
  if (block.number === null) throw new TradeStop('quote-failed')
  const blockNumber = block.number
  const { to, data } = quoteCall(checked.route, checked.key, tokenIn, amountIn)
  const zeroForOne = tokenIn === checked.key.token0
  const quoted = call(client, { to, data, blockNumber }).then((r) => {
    if (!r.data) throw new TradeStop('quote-failed')
    return decodeQuote(checked.route, r.data, zeroForOne)
  })
  const failed = (error: unknown): never => {
    throw error instanceof TradeStop ? error : new TradeStop('quote-failed')
  }
  const [quote, poolMid, others, feePips] = await Promise.all([
    quoted.catch(failed),
    midOf(client, checked.key.address, blockNumber).catch(() => null),
    Promise.all(references.map((ref) => midOf(client, ref, blockNumber).catch(() => null))),
    feeOf(client, checked.key.address, blockNumber).catch(failed),
  ])
  if (quote.partial) throw new TradeStop('partial-fill')
  return {
    blockNumber,
    timestamp: block.timestamp,
    amountOut: quote.amountOut,
    poolMid,
    otherMids: others.filter((mid): mid is Fraction => mid !== null),
    feePips,
  }
}

/** The account's balance of `token`, or of ETH when `token` is null. */
export async function balanceOf(
  client: Client,
  account: Address,
  token: Address | null,
): Promise<bigint> {
  if (token === null) return getBalance(client, { address: account })
  return (await read(client, token, tradeErc20Abi, 'balanceOf', [account])) as bigint
}

export async function allowanceOf(
  client: Client,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return (await read(client, token, tradeErc20Abi, 'allowance', [owner, spender])) as bigint
}

/** The latest block's timestamp, unix seconds: the deadline counts from it, not the browser. */
export async function latestTimestamp(client: Client): Promise<bigint> {
  return (await getBlock(client, { blockTag: 'latest' })).timestamp
}
