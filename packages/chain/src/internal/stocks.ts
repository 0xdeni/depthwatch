/**
 * `ChainReader.readStocks`: every stock of the stock list read at one block in one Multicall3
 * batch (docs/METRICS.md, "The reading"; docs/design/stocks.md §3). Per stock with a feed, six
 * calls: the feed proxy's `latestRoundData()`, `decimals()` and `description()`, the oracle
 * registry's `getOracleParams(token)`, and the token's own `multiplier()` and `pausedFeatures()`;
 * a stock without a feed gets the last two only. Ten stocks are 60 calls, one request at the
 * default 500 calls per `aggregate3`.
 *
 * Every call may fail (`allowFailure`) and is decoded on its own (viem's multicall runs
 * `decodeFunctionResult` per call), so a revert, an answer that does not decode as the ABI says,
 * or a value of the wrong shape nulls only that call's fields and is named in `error`. Core judges
 * the answers (`evaluateStockReading`); nothing here sets a status. A failed request (an outage, a
 * spent backoff) gives every stock `raw: null` and the request's one-line error, so a snapshot goes
 * on without its stocks; only the reader's own abort is thrown.
 */
import type { Address, StockRawRead } from '@depthwatch/core'
import { b20Abi } from '../abi/b20.js'
import { chainlinkFeedAbi } from '../abi/chainlinkFeed.js'
import { coinbaseOracleRegistryAbi } from '../abi/coinbaseOracleRegistry.js'
import type { StockList } from '../stocks.js'
import type { ReaderContext } from './context.js'
import { errorSummary } from './errorText.js'
import { redactUrls } from './logErrors.js'
import {
  asBigint,
  asNumber,
  asTuple,
  type CallResult,
  type ContractCall,
  multicallBatched,
} from './multicall.js'

/** One stock's answers at the block. */
export interface StockReadResult {
  /** The stock token (lowercase). */
  token: Address
  /** The decoded answers; null when the request itself failed. */
  raw: StockRawRead | null
  /** Each failed call with its error, or the failed request's; null when every call answered. */
  error: string | null
}

/** The calls of one stock, in the order they are sent. */
export const STOCK_READ_CALLS = Object.freeze([
  'latestRoundData',
  'decimals',
  'description',
  'getOracleParams',
  'multiplier',
  'pausedFeatures',
] as const)

export type StockReadCall = (typeof STOCK_READ_CALLS)[number]

/** The fields of `StockRawRead` one call answers, from its decoded result (throws on a bad shape). */
const DECODERS: Readonly<Record<StockReadCall, (value: unknown) => Partial<StockRawRead>>> = {
  latestRoundData(value) {
    const round = asTuple(value, 'latestRoundData')
    return {
      roundId: asBigint(round[0], 'roundId'),
      answer: asBigint(round[1], 'answer'),
      // A uint256 of seconds; one past 2^53 is no time and reads as after the block (`invalid`).
      updatedAt: Number(asBigint(round[3], 'updatedAt')),
    }
  },
  decimals: (value) => ({ decimals: asNumber(value, 'decimals') }),
  description(value) {
    if (typeof value !== 'string') throw new TypeError(`description: got ${typeof value}`)
    return { description: value }
  },
  getOracleParams(value) {
    const [multiplier, paused] = asTuple(value, 'getOracleParams')
    if (typeof paused !== 'boolean') throw new TypeError(`paused: got ${typeof paused}`)
    return { oracleMultiplierWad: asBigint(multiplier, 'multiplier'), oraclePaused: paused }
  },
  multiplier: (value) => ({ tokenMultiplierWad: asBigint(value, 'multiplier') }),
  pausedFeatures: (value) => ({
    pausedOrdinals: asTuple(value, 'pausedFeatures').map((v) => asNumber(v, 'pausedFeatures')),
  }),
}

const NOT_READ: StockRawRead = Object.freeze({
  roundId: null,
  answer: null,
  updatedAt: null,
  decimals: null,
  description: null,
  oracleMultiplierWad: null,
  oraclePaused: null,
  tokenMultiplierWad: null,
  pausedOrdinals: null,
})

interface StockCalls {
  token: Address
  names: StockReadCall[]
  calls: ContractCall[]
}

function callsOf(list: StockList, token: Address): StockCalls {
  const feed = list.feeds[token]
  const names: StockReadCall[] = []
  const calls: ContractCall[] = []
  const add = (name: StockReadCall, call: ContractCall) => {
    names.push(name)
    calls.push(call)
  }
  if (feed !== undefined) {
    const proxy = { address: feed.feed, abi: chainlinkFeedAbi }
    add('latestRoundData', { ...proxy, functionName: 'latestRoundData' })
    add('decimals', { ...proxy, functionName: 'decimals' })
    add('description', { ...proxy, functionName: 'description' })
    add('getOracleParams', {
      address: list.oracleRegistry,
      abi: coinbaseOracleRegistryAbi,
      functionName: 'getOracleParams',
      args: [token],
    })
  }
  add('multiplier', { address: token, abi: b20Abi, functionName: 'multiplier' })
  add('pausedFeatures', { address: token, abi: b20Abi, functionName: 'pausedFeatures' })
  return { token, names, calls }
}

/**
 * One call's failure in one line: viem's short message without the function name it repeats
 * ("reverted.", "returned no data", a decoding error), else `errorSummary`. viem's innermost level
 * of a revert carries no short message, and `errorSummary` would add its generic text.
 */
function callError(err: unknown): string {
  const short = (err as { shortMessage?: unknown } | null)?.shortMessage
  if (typeof short !== 'string' || short.trim() === '') return errorSummary(err)
  const line = short.replace(/\s+/g, ' ').trim()
  return redactUrls(line.replace(/^The contract function "[^"]*" /, ''))
}

/** One stock's answers from its calls' results; a failed or misshapen call nulls its fields. */
function decodeStock(stock: StockCalls, results: readonly (CallResult | undefined)[]) {
  const raw: StockRawRead = { ...NOT_READ }
  const errors: string[] = []
  stock.names.forEach((name, i) => {
    const result = results[i]
    try {
      if (result === undefined) throw new Error('no result')
      if (result.status === 'failure') throw result.error
      Object.assign(raw, DECODERS[name](result.result))
    } catch (err) {
      errors.push(`${name}: ${callError(err)}`)
    }
  })
  return { token: stock.token, raw, error: errors.length === 0 ? null : errors.join('; ') }
}

/** Every stock of `list` at `blockNumber`, in list order; see the module comment. */
export async function readStocks(
  ctx: ReaderContext,
  list: StockList,
  blockNumber: bigint,
  signal?: AbortSignal,
): Promise<StockReadResult[]> {
  const stocks = list.tokens.map((t) => callsOf(list, t.address))
  const calls = stocks.flatMap((s) => s.calls)
  let results: CallResult[]
  try {
    results = await multicallBatched(ctx, calls, blockNumber, {
      what: `eth_call aggregate3 ×${calls.length} @ ${blockNumber} (stocks)`,
    })
  } catch (err) {
    if (signal?.aborted) throw signal.reason
    const error = errorSummary(err)
    return stocks.map((s) => ({ token: s.token, raw: null, error }))
  }
  let offset = 0
  return stocks.map((stock) => {
    const own = results.slice(offset, offset + stock.calls.length)
    offset += stock.calls.length
    return decodeStock(stock, own)
  })
}
