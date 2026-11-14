/**
 * Test helper: a fake EIP-1193 wallet on a fake Base, for the swap panel's tests behind viem's
 * `custom()` transport. It answers the reads the panel makes (pool identity, quoter, `slot0`, the
 * pool's live `fee()`, balances, allowances, blocks) and `eth_estimateGas`, records every
 * `eth_call` (with its block), estimate, `eth_sendTransaction` (with its gas) and
 * `wallet_sendCalls`, applies an approval to its allowances and spends a token input's allowance
 * on a swap (ERC-20 `transferFrom`; the largest uint256 is never spent). `wallet_sendCalls` behaves as an
 * ERC-4337 smart wallet: the bundle transaction always succeeds, and the user operation's own
 * outcome is in `wallet_getCallsStatus` (200, or 500 with a reverted receipt). Calldata is decoded and encoded
 * with viem against the ABIs of `@depthwatch/chain/addresses`, so a wrong selector or struct fails
 * the test the way it would fail on chain.
 */
import {
  clFactoryGetPoolAbi,
  quoterV2Abi,
  slipstreamQuoterV2Abi,
  type TradeRoute,
  tradeErc20Abi,
  tradePoolAbi,
  uniswapV3GetPoolAbi,
} from '@depthwatch/chain/addresses'
import { type Address, MAX_SQRT_RATIO, MIN_SQRT_RATIO } from '@depthwatch/core'
import {
  type Abi,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  type Hex,
  maxUint256,
  pad,
  toHex,
} from 'viem'
import type { Eip1193Provider } from '../trade/wallets.js'
import { bundleInput } from './bundle.js'
import { BLOCK, blockJson, type MinedTx, receiptJson, transactionJson } from './fakeChain.js'
import { decodeSwap } from './swapCalldata.js'

export const ACCOUNT: Address = '0x00000000000000000000000000000000000a11ce'
export const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
export const WITHDRAWAL = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65'

export interface FakePool {
  address: Address
  factory: Address
  token0: Address
  token1: Address
  fee: number
  tickSpacing: number
  sqrtPriceX96: bigint
}

export interface FakeTx {
  from: Address
  to: Address
  data: Hex
  value: bigint
  /** The gas limit the transaction was sent with; null when the wallet was left to set it. */
  gas: bigint | null
}

/** What `eth_estimateGas` answers: an estimate, a revert, an unknown method or another error. */
export type FakeEstimate = bigint | 'revert' | 'unsupported' | 'error'

export interface FakeWalletOptions {
  routes: readonly TradeRoute[]
  pools: FakePool[]
  weth: Address
  chainId?: number
  ethBalance?: bigint
  balances?: Record<string, bigint>
  /** Raw output for `amountIn` of `tokenIn` (the quoter's answer). */
  quote: (amountIn: bigint, tokenIn: Address) => bigint
  /** True: `wallet_getCapabilities` reports `dataSuffix` on 0x2105. */
  dataSuffix?: boolean
  /** `eth_getCode` of the account (default `0x`, an EOA). */
  accountCode?: Hex
  /** What every router answers to `factory()` (default: its route's factory). */
  routerFactory?: Address
  /**
   * True: `eth_sendTransaction` is mined as a contract account's wallet without the `dataSuffix`
   * capability sends it, our calldata (suffix included) inside `execute(…)` in a bundle.
   */
  wrapSent?: boolean
}

const rpcError = (code: number, message: string) => Object.assign(new Error(message), { code })

/** The answers of `eth_estimateGas` that are not an estimate, as nodes and wallets give them. */
const ESTIMATE_ERRORS = {
  revert: () =>
    Object.assign(rpcError(3, 'execution reverted: Too little received'), { data: '0x08c379a0' }),
  unsupported: () => rpcError(-32601, 'the method eth_estimateGas does not exist/is not available'),
  error: () => rpcError(-32603, 'Internal JSON-RPC error.'),
}

function decodeAny(abis: readonly Abi[], data: Hex) {
  for (const abi of abis) {
    try {
      return { abi, ...decodeFunctionData({ abi, data }) }
    } catch {}
  }
  return null
}

export function createFakeWallet(options: FakeWalletOptions) {
  const listeners = new Map<string, Set<(...args: never[]) => void>>()
  const state = {
    chainId: options.chainId ?? 8453,
    allowances: new Map<string, bigint>(),
    quoteFactor: 1,
    /** Methods answered with a 4001 rejection. */
    reject: new Set<string>(),
    /** True: the next mined transaction reverts. */
    revertNext: false,
    /** True: a simulated swap (an `eth_call` to a router) reverts. */
    failSimulation: false,
    /** True: a simulated swap that pays out ETH (`unwrapWETH9`) reverts; one paying WETH passes. */
    failUnwrap: false,
    /** True: the quoter stops at the open price limit (part of the input unused). */
    quoteAtLimit: false,
    /** A pool's live `fee()` (pips) when it differs from its `FakePool.fee` (the factory's key). */
    fees: new Map<Address, number>(),
    /** True: every pool's `fee()` reverts. */
    failFee: false,
    /** What `eth_estimateGas` answers. */
    estimate: 120_000n as FakeEstimate,
    /** Every `eth_estimateGas` request, as asked. */
    estimates: [] as Omit<FakeTx, 'gas'>[],
    /** `block`: the block tag or number the call was made at, as sent. */
    calls: [] as { to: Address; data: Hex; from?: Address; value?: bigint; block?: string }[],
    sent: [] as FakeTx[],
    bundles: [] as { calls: { to: Address; data: Hex; value?: Hex }[]; capabilities: unknown }[],
    methods: [] as string[],
  }
  type Status = '0x1' | '0x0'
  /** `status`: the call's own outcome; `outer`: the transaction's (always 0x1 for a bundle). */
  const mined = new Map<Hex, MinedTx & { tx: FakeTx; status: Status }>()
  const routers = new Map(options.routes.map((route) => [route.router, route]))
  const quoters = new Map(options.routes.map((route) => [route.quoter, route]))
  const factories = new Set(options.routes.map((route) => route.factory))
  const pools = new Map(options.pools.map((pool) => [pool.address, pool]))

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? [])
      (listener as (...a: unknown[]) => void)(...args)
  }

  function quoteFor(amountIn: bigint, tokenIn: Address): bigint {
    const out = options.quote(amountIn, tokenIn)
    return (out * BigInt(Math.round(state.quoteFactor * 1e6))) / 1_000_000n
  }

  function answerCall(to: Address, data: Hex): Hex {
    const pool = pools.get(to)
    if (pool) {
      if (data.startsWith('0x3850c7bd'))
        return encodeAbiParameters(
          [
            { type: 'uint160' },
            { type: 'int24' },
            { type: 'uint16' },
            { type: 'uint16' },
            { type: 'uint16' },
            { type: 'bool' },
          ],
          [pool.sqrtPriceX96, 0, 0, 1, 1, true],
        )
      const { functionName } = decodeFunctionData({ abi: tradePoolAbi, data })
      if (functionName === 'fee' && state.failFee) throw rpcError(3, 'execution reverted')
      const value =
        functionName === 'tickSpacing'
          ? pool.tickSpacing
          : functionName === 'fee'
            ? (state.fees.get(pool.address) ?? pool.fee)
            : pool[functionName]
      return encodeFunctionResult({ abi: tradePoolAbi, functionName, result: value } as never)
    }
    const quoter = quoters.get(to)
    if (quoter) {
      const abi = quoter.quoterAbi === 'quoter-v2' ? quoterV2Abi : slipstreamQuoterV2Abi
      const { args } = decodeFunctionData({ abi, data })
      const params = args[0] as { tokenIn: Address; tokenOut: Address; amountIn: bigint }
      const out = quoteFor(params.amountIn, params.tokenIn)
      const zeroForOne = params.tokenIn.toLowerCase() < params.tokenOut.toLowerCase()
      // At the open price limit, the end of a quote that could not use the whole input.
      const limit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n
      const after = state.quoteAtLimit ? limit : 1n << 96n
      return encodeFunctionResult({
        abi,
        functionName: 'quoteExactInputSingle',
        result: [out, after, 1, 90_000n],
      } as never)
    }
    if (factories.has(to)) {
      const decoded = decodeAny([uniswapV3GetPoolAbi, clFactoryGetPoolAbi], data)
      if (!decoded) throw rpcError(3, 'execution reverted')
      const [a, b, key] = decoded.args as [Address, Address, number]
      const found = options.pools.find(
        (p) =>
          p.factory === to &&
          ((p.token0 === a.toLowerCase() && p.token1 === b.toLowerCase()) ||
            (p.token0 === b.toLowerCase() && p.token1 === a.toLowerCase())) &&
          (decoded.abi === uniswapV3GetPoolAbi ? p.fee === key : p.tickSpacing === key),
      )
      return encodeAbiParameters([{ type: 'address' }], [found?.address ?? `0x${'0'.repeat(40)}`])
    }
    const route = routers.get(to)
    if (route) {
      if (data.startsWith('0xc45a0155'))
        return encodeAbiParameters([{ type: 'address' }], [options.routerFactory ?? route.factory])
      // A simulated swap: its answer is ignored; the panel only needs it not to revert.
      if (state.failSimulation) throw rpcError(3, 'execution reverted: Too little received')
      if (state.failUnwrap && decodeSwap(route, data)?.unwrap)
        throw rpcError(3, 'execution reverted: Insufficient WETH9')
      return '0x'
    }
    // An ERC-20 of the allowlist.
    const { functionName, args } = decodeFunctionData({ abi: tradeErc20Abi, data })
    if (functionName === 'balanceOf')
      return encodeAbiParameters([{ type: 'uint256' }], [options.balances?.[to] ?? 0n])
    if (functionName === 'allowance') {
      const [owner, spender] = args as [Address, Address]
      const key = `${to}:${owner.toLowerCase()}:${spender.toLowerCase()}`
      return encodeAbiParameters([{ type: 'uint256' }], [state.allowances.get(key) ?? 0n])
    }
    if (functionName === 'approve') return encodeAbiParameters([{ type: 'bool' }], [true])
    return encodeAbiParameters([{ type: 'uint256' }], [18n])
  }

  /** Mines `tx`: an approval sets the allowance; a swap logs what it pays out. */
  function mine(tx: FakeTx, input: Hex, bundle = false): Hex {
    const hash = pad(toHex(mined.size + 1), { size: 32 })
    const status = state.revertNext ? '0x0' : '0x1'
    state.revertNext = false
    const logs: unknown[] = []
    const route = routers.get(tx.to)
    if (status === '0x1' && route) {
      const swap = decodeSwap(route, tx.data)
      if (swap) {
        // A token in is taken with `transferFrom`, which spends the allowance (ETH in is value).
        const key = `${swap.tokenIn}:${tx.from}:${tx.to}`
        const allowance = state.allowances.get(key)
        if (tx.value === 0n && allowance !== undefined && allowance !== maxUint256)
          state.allowances.set(key, allowance > swap.amountIn ? allowance - swap.amountIn : 0n)
        const out = quoteFor(swap.amountIn, swap.tokenIn)
        const log = (address: Address, topics: Hex[]) =>
          logs.push({
            address,
            topics,
            data: toHex(out, { size: 32 }),
            blockNumber: toHex(BLOCK),
            logIndex: '0x0',
            transactionIndex: '0x0',
            blockHash: pad('0x1', { size: 32 }),
            transactionHash: hash,
            removed: false,
          })
        if (swap.unwrap) log(options.weth, [WITHDRAWAL, pad(route.router, { size: 32 })])
        else
          log(swap.tokenOut, [
            TRANSFER,
            pad(route.router, { size: 32 }),
            pad(tx.from, { size: 32 }),
          ])
      }
    } else if (status === '0x1') {
      const approve = decodeAny([tradeErc20Abi], tx.data)
      if (approve?.functionName === 'approve') {
        const [spender, amount] = approve.args as [Address, bigint]
        state.allowances.set(`${tx.to}:${tx.from}:${spender.toLowerCase()}`, amount)
      }
    }
    mined.set(hash, { tx, status, outer: bundle ? '0x1' : status, input, logs })
    return hash
  }

  const receipt = (hash: Hex) => {
    const entry = mined.get(hash)
    return entry ? receiptJson(hash, entry) : null
  }

  const provider: Eip1193Provider & {
    request(args: { method: string; params?: unknown }): Promise<unknown>
  } = {
    async request({ method, params }) {
      state.methods.push(method)
      if (state.reject.has(method)) throw rpcError(4001, 'User rejected the request.')
      const p = (params ?? []) as unknown[]
      switch (method) {
        case 'eth_chainId':
          return toHex(state.chainId)
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [ACCOUNT]
        case 'wallet_switchEthereumChain': {
          state.chainId = Number((p[0] as { chainId: string }).chainId)
          emit('chainChanged', toHex(state.chainId))
          return null
        }
        case 'wallet_getCapabilities':
          return options.dataSuffix ? { '0x2105': { dataSuffix: { supported: true } } } : {}
        case 'eth_blockNumber':
          return toHex(BLOCK)
        case 'eth_getBlockByNumber':
          return blockJson()
        case 'eth_getBalance':
          return toHex(options.ethBalance ?? 0n)
        case 'eth_getCode':
          return (p[0] as string).toLowerCase() === ACCOUNT ? (options.accountCode ?? '0x') : '0x'
        case 'eth_call': {
          const call = p[0] as { to: Address; data: Hex; from?: Address; value?: Hex }
          state.calls.push({
            to: call.to.toLowerCase() as Address,
            data: call.data,
            from: call.from,
            value: call.value ? BigInt(call.value) : 0n,
            block: typeof p[1] === 'string' ? p[1] : undefined,
          })
          return answerCall(call.to.toLowerCase() as Address, call.data)
        }
        case 'eth_estimateGas': {
          const raw = p[0] as { from: Address; to: Address; data: Hex; value?: Hex }
          state.estimates.push({
            from: raw.from.toLowerCase() as Address,
            to: raw.to.toLowerCase() as Address,
            data: raw.data,
            value: raw.value ? BigInt(raw.value) : 0n,
          })
          const answer = state.estimate
          if (typeof answer === 'bigint') return toHex(answer)
          throw ESTIMATE_ERRORS[answer]()
        }
        case 'eth_sendTransaction': {
          const raw = p[0] as { from: Address; to: Address; data: Hex; value?: Hex; gas?: Hex }
          const tx: FakeTx = {
            from: raw.from.toLowerCase() as Address,
            to: raw.to.toLowerCase() as Address,
            data: raw.data,
            value: raw.value ? BigInt(raw.value) : 0n,
            gas: raw.gas ? BigInt(raw.gas) : null,
          }
          state.sent.push(tx)
          const input = options.wrapSent
            ? bundleInput({ sender: tx.from, to: tx.to, value: tx.value, data: tx.data })
            : tx.data
          return mine(tx, input)
        }
        case 'wallet_sendCalls': {
          const bundle = p[0] as {
            calls: { to: Address; data: Hex; value?: Hex }[]
            capabilities: { dataSuffix?: { value: Hex } }
          }
          state.bundles.push(bundle)
          const call = bundle.calls[0]!
          const tx: FakeTx = {
            from: ACCOUNT,
            to: call.to.toLowerCase() as Address,
            data: call.data,
            value: call.value ? BigInt(call.value) : 0n,
            gas: null,
          }
          // The smart wallet appends the suffix to its user operation, which a bundle wraps.
          const input = bundleInput({
            sender: ACCOUNT,
            to: tx.to,
            value: tx.value,
            data: call.data,
            suffix: bundle.capabilities.dataSuffix?.value,
          })
          return { id: mine(tx, input, true) }
        }
        case 'wallet_getCallsStatus': {
          const r = receipt(p[0] as Hex)
          const op = mined.get(p[0] as Hex)?.status ?? '0x1'
          return {
            version: '2.0.0',
            id: p[0],
            chainId: '0x2105',
            atomic: true,
            status: op === '0x1' ? 200 : 500,
            receipts: r ? [{ ...r, status: op }] : [],
          }
        }
        case 'eth_getTransactionReceipt':
          return receipt(p[0] as Hex)
        case 'eth_getTransactionByHash': {
          const entry = mined.get(p[0] as Hex)
          return entry ? transactionJson(p[0] as Hex, entry) : null
        }
        default:
          throw rpcError(-32601, `method ${method} not supported`)
      }
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)?.add(listener)
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener)
    },
  }
  return { provider, state, emit }
}
