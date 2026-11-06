/**
 * Fixture answers of one stock's reads at one block (`ChainReader.readStocks`, internal/stocks.ts):
 * its feed proxy's `latestRoundData()`, `decimals()` and `description()`, the oracle registry's
 * `getOracleParams(stock)`, and the token's `multiplier()` and `pausedFeatures()`, each encoded with
 * `encodeFunctionResult`. A stock without a feed (`feed: null`) gets the token's two calls only, as
 * the reader sends no more for it. `revert` names calls that revert; `malformed` names calls that
 * answer bytes that do not decode (a multi-word answer cut to its first word, a one-word answer to
 * one byte), which the reader treats like a revert.
 */
import type { Address, Hex } from '@depthwatch/core'
import { type Abi, encodeFunctionData, encodeFunctionResult, size, slice } from 'viem'
import { b20Abi } from '../abi/b20.js'
import { chainlinkFeedAbi } from '../abi/chainlinkFeed.js'
import { coinbaseOracleRegistryAbi } from '../abi/coinbaseOracleRegistry.js'
import type { StockReadCall } from '../internal/stocks.js'
import { STOCK_PROTOCOL, type StockFeed } from '../stocks.js'
import type { Fixture } from '../transport/fixture.js'
import { registerRawCall, registerRevert } from './builders.js'

const WAD = 10n ** 18n

export interface StockFixtureSpec {
  /** The stock token. */
  stock: Address
  /** The stock's feed as the stock list records it; null for a stock without one. */
  feed: StockFeed | null
  block: bigint
  /** `latestRoundData()`'s answer, USD per token at the feed's decimals. */
  answer: bigint
  /** `latestRoundData()`'s `updatedAt` (and `startedAt`), Unix seconds. */
  updatedAt: number
  /** Default 1 (also `answeredInRound`). */
  roundId?: bigint
  /** `decimals()`; default the feed's recorded decimals. */
  decimals?: number
  /** `description()`; default `Coinbase <ticker>`. */
  description?: string
  /** Default `STOCK_PROTOCOL.oracleRegistry`; pass the stock list's for a synthetic one. */
  oracleRegistry?: Address
  /** `getOracleParams`' paused flag; default false. */
  oraclePaused?: boolean
  /** The token's `multiplier()` and the oracle registry's multiplier (WAD); default 10^18. */
  multiplierWad?: bigint
  /** `pausedFeatures()` as B20 ordinals; default none. */
  pausedOrdinals?: readonly number[]
  revert?: readonly StockReadCall[]
  malformed?: readonly StockReadCall[]
}

interface Answer {
  name: StockReadCall
  to: Address
  abi: Abi
  args?: readonly unknown[]
  result: unknown
}

function answersOf(spec: StockFixtureSpec): Answer[] {
  const multiplier = spec.multiplierWad ?? WAD
  const token: Answer[] = [
    { name: 'multiplier', to: spec.stock, abi: b20Abi, result: multiplier },
    {
      name: 'pausedFeatures',
      to: spec.stock,
      abi: b20Abi,
      result: [...(spec.pausedOrdinals ?? [])],
    },
  ]
  const { feed } = spec
  if (feed === null) return token
  const roundId = spec.roundId ?? 1n
  const updatedAt = BigInt(spec.updatedAt)
  const proxy = { to: feed.feed, abi: chainlinkFeedAbi }
  return [
    {
      name: 'latestRoundData',
      ...proxy,
      result: [roundId, spec.answer, updatedAt, updatedAt, roundId],
    },
    { name: 'decimals', ...proxy, result: spec.decimals ?? feed.decimals },
    { name: 'description', ...proxy, result: spec.description ?? `Coinbase ${feed.ticker}` },
    {
      name: 'getOracleParams',
      to: spec.oracleRegistry ?? STOCK_PROTOCOL.oracleRegistry,
      abi: coinbaseOracleRegistryAbi,
      args: [spec.stock],
      result: [multiplier, spec.oraclePaused ?? false],
    },
    ...token,
  ]
}

/** Bytes that do not decode as `returnData`'s outputs: its first word, or its first byte. */
const malformedOf = (returnData: Hex): Hex =>
  size(returnData) > 32 ? slice(returnData, 0, 32) : slice(returnData, 0, 1)

/** Registers one stock's answers at `spec.block`; see the module comment. */
export function addStockFixture(fixture: Fixture, spec: StockFixtureSpec): void {
  const blocks = [spec.block]
  for (const answer of answersOf(spec)) {
    const call = { to: answer.to, abi: answer.abi, functionName: answer.name, args: answer.args }
    if (spec.revert?.includes(answer.name)) {
      registerRevert(fixture, { ...call, blocks } as never)
      continue
    }
    const data = encodeFunctionData(call as never)
    const encoded = encodeFunctionResult({ ...call, result: answer.result } as never)
    const returnData = spec.malformed?.includes(answer.name) ? malformedOf(encoded) : encoded
    registerRawCall(fixture, { to: answer.to, data, returnData, blocks })
  }
}
