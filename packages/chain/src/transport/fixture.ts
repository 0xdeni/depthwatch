/**
 * Deterministic JSON-RPC transport for tests and demo mode. Answers come from a `Fixture`:
 *
 * 1. `calls` — exact answers keyed by `fixtureKey(method, params)` (see ./key.ts). A value of the
 *    form `{ $error: { code?, message, data? } }` makes the request fail like an RPC error.
 * 2. `eth_call` to Multicall3 `aggregate3` is decomposed: each inner call is answered from `calls`
 *    as if it had been sent alone (`eth_call` with `[{ to, data }, block]`), so fixtures only need
 *    per-contract entries. Inner `$error` entries become `success = false` results.
 * 3. `logs` (optional) — a raw log store that answers any `eth_getLogs` by address/topics/range.
 * 4. `clock` (optional) — answers `eth_blockNumber` / `eth_getBlockByNumber` for any block ≤ latest
 *    by extrapolating `secondsPerBlock` backwards from the latest block, or, with `eras`, from that
 *    block schedule (Base's: 2 s blocks, then 200 ms from Denim on), `timestampMs` included.
 * 5. `history` (optional) — answers that change at given blocks (contract code that appears at a
 *    deployment block, a view whose result changes): a request whose last param is a block gets the
 *    entry with the largest `fromBlock` at or below that block (`latest` and other tags: the clock's
 *    latest block). Keyed by `fixtureKey(method, params without the block)`; exact `calls` win.
 *
 * Anything else throws a `FixtureMissError` naming the method and params so the missing entry can
 * be registered. The transport never retries.
 *
 * `opts.multicall3` is the address whose `aggregate3` calls are decomposed (default: Base's
 * Multicall3); pass the same override given to `createChainReader({ addresses })`.
 */
import type { Address, Hex } from '@depthwatch/core'
import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  hexToBigInt,
  keccak256,
  numberToHex,
  stringToHex,
  type Transport,
} from 'viem'
import { multicall3Abi } from '../abi/multicall3.js'
import { BASE_ADDRESSES } from '../addresses.js'
import { scheduledTimeMs, scheduledTimestamp } from '../schedule.js'
import { fixtureKey } from './key.js'

export interface FixtureLog {
  address: Address
  topics: Hex[]
  data: Hex
  blockNumber: Hex
  blockHash: Hex
  transactionHash: Hex
  transactionIndex: Hex
  logIndex: Hex
  removed: boolean
}

export interface FixtureClock {
  /** Decimal string so the fixture stays JSON-serialisable. */
  latestBlock: string
  /** Unix seconds of the latest block. */
  latestTimestamp: number
  secondsPerBlock: number
  /**
   * A `BlockSchedule` (schedule.ts) with decimal `fromBlock`s: when set, every block's time follows
   * it instead of `secondsPerBlock` (`latestTimestamp` must be the latest block's on it).
   */
  eras?: Array<{ fromBlock: string; fromMs: number; msPerBlock: number }>
}

export interface FixtureErrorEntry {
  $error: { code?: number; message: string; data?: Hex }
}

/** One answer of a `history` entry list, valid from `fromBlock` (decimal string) on. */
export interface FixtureHistoryEntry {
  fromBlock: string
  value: unknown
}

export interface Fixture {
  calls: Record<string, unknown>
  logs?: FixtureLog[]
  clock?: FixtureClock
  history?: Record<string, FixtureHistoryEntry[]>
}

export function createFixture(): Fixture {
  return { calls: {} }
}

export function isFixtureError(value: unknown): value is FixtureErrorEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$error' in value &&
    typeof (value as { $error: unknown }).$error === 'object'
  )
}

export class FixtureMissError extends Error {
  override readonly name = 'FixtureMissError'
  constructor(
    readonly method: string,
    readonly params: unknown,
    readonly key: string,
  ) {
    super(
      `Fixture has no answer for ${method} ${safeJson(params)} (key ${key}). ` +
        'Register it with registerCall/registerRequest from @depthwatch/chain fixtures.',
    )
  }
}

/** An RPC-style error (has `code`) so viem maps it like a JSON-RPC failure. */
export class FixtureRpcError extends Error {
  override readonly name = 'FixtureRpcError'
  readonly code: number
  readonly data: Hex | undefined
  constructor(entry: FixtureErrorEntry['$error']) {
    super(entry.message)
    this.code = entry.code ?? -32000
    this.data = entry.data
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

const AGGREGATE3_SELECTOR = '0x82ad56cb'

type CallParams = [{ to?: Address; data?: Hex }, unknown]

export interface FixtureTransportOptions {
  multicall3?: Address
}

export type FixtureRequestHandler = (args: { method: string; params?: unknown }) => Promise<unknown>

export function createFixtureTransport(
  fixture: Fixture,
  opts: FixtureTransportOptions = {},
): Transport {
  const request = createFixtureRequestHandler(fixture, opts)
  return custom({ request }, { key: 'fixture', name: 'Fixture Transport', retryCount: 0 })
}

/** The raw answering function behind createFixtureTransport (fixtures/fakeRpc.ts serves it over HTTP). */
export function createFixtureRequestHandler(
  fixture: Fixture,
  opts: FixtureTransportOptions = {},
): FixtureRequestHandler {
  const multicall3 = (opts.multicall3 ?? BASE_ADDRESSES.multicall3).toLowerCase()
  /** The exact `calls` entry, else the `history` entry in force at the request's block. */
  const find = (method: string, params: unknown): { value: unknown } | undefined => {
    const key = fixtureKey(method, params)
    if (key in fixture.calls) return { value: fixture.calls[key] }
    return historyAnswer(fixture, method, params)
  }
  const lookup = (method: string, params: unknown): unknown => {
    const found = find(method, params)
    if (found === undefined) throw new FixtureMissError(method, params, fixtureKey(method, params))
    if (isFixtureError(found.value)) throw new FixtureRpcError(found.value.$error)
    return found.value
  }
  const has = (method: string, params: unknown): boolean =>
    fixtureKey(method, params) in fixture.calls

  const answerMulticall = (params: CallParams): Hex => {
    const [request, block] = params
    const decoded = decodeFunctionData({ abi: multicall3Abi, data: request.data as Hex })
    if (decoded.functionName !== 'aggregate3')
      throw new FixtureMissError('eth_call', params, fixtureKey('eth_call', params))
    const results = decoded.args[0].map((call) => {
      const inner: CallParams = [
        { to: call.target.toLowerCase() as Address, data: call.callData },
        block,
      ]
      const found = find('eth_call', inner)
      if (found === undefined)
        throw new FixtureMissError('eth_call', inner, fixtureKey('eth_call', inner))
      const value = found.value
      if (isFixtureError(value)) {
        if (!call.allowFailure) throw new FixtureRpcError(value.$error)
        return { success: false, returnData: value.$error.data ?? ('0x' as Hex) }
      }
      return { success: true, returnData: value as Hex }
    })
    return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: results })
  }

  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    if (has(method, params)) return lookup(method, params)
    switch (method) {
      case 'eth_chainId':
        return '0x2105'
      case 'eth_call': {
        const p = params as CallParams
        const to = p[0]?.to?.toLowerCase()
        const data = p[0]?.data ?? '0x'
        if (to === multicall3 && data.startsWith(AGGREGATE3_SELECTOR)) return answerMulticall(p)
        return lookup(method, params)
      }
      case 'eth_getLogs':
        if (fixture.logs) return filterLogs(fixture.logs, (params as [LogsFilter])[0])
        return lookup(method, params)
      case 'eth_blockNumber':
        if (fixture.clock) return numberToHex(BigInt(fixture.clock.latestBlock))
        return lookup(method, params)
      case 'eth_getBlockByNumber':
        if (fixture.clock) return synthesizeBlock(fixture.clock, (params as [string])[0])
        return lookup(method, params)
      default:
        return lookup(method, params)
    }
  }
  return request
}

/** The block a request's last param names (a tag reads as the clock's latest block). */
function requestBlock(fixture: Fixture, param: unknown): bigint | undefined {
  if (typeof param !== 'string') return undefined
  if (param.startsWith('0x')) return hexToBigInt(param as Hex)
  if (param === 'earliest') return 0n
  return fixture.clock === undefined ? (1n << 64n) - 1n : BigInt(fixture.clock.latestBlock)
}

function historyAnswer(
  fixture: Fixture,
  method: string,
  params: unknown,
): { value: unknown } | undefined {
  if (fixture.history === undefined || !Array.isArray(params) || params.length === 0)
    return undefined
  const entries = fixture.history[fixtureKey(method, params.slice(0, -1))]
  const block = requestBlock(fixture, params[params.length - 1])
  if (entries === undefined || block === undefined) return undefined
  let best: FixtureHistoryEntry | undefined
  for (const entry of entries) {
    const from = BigInt(entry.fromBlock)
    if (from <= block && (best === undefined || from > BigInt(best.fromBlock))) best = entry
  }
  return best === undefined ? undefined : { value: best.value }
}

interface LogsFilter {
  address?: Address | Address[]
  topics?: (Hex | Hex[] | null)[]
  fromBlock?: Hex | string
  toBlock?: Hex | string
}

function blockBound(value: string | undefined, fallback: bigint): bigint {
  if (value === undefined || !value.startsWith('0x')) return fallback
  return hexToBigInt(value as Hex)
}

export function filterLogs(logs: readonly FixtureLog[], filter: LogsFilter): FixtureLog[] {
  const from = blockBound(filter.fromBlock, 0n)
  const to = blockBound(filter.toBlock, (1n << 64n) - 1n)
  const addresses =
    filter.address === undefined
      ? null
      : new Set((Array.isArray(filter.address) ? filter.address : [filter.address]).map(lower))
  const topics = filter.topics ?? []
  return logs
    .filter((log) => {
      const bn = hexToBigInt(log.blockNumber)
      if (bn < from || bn > to) return false
      if (addresses && !addresses.has(lower(log.address))) return false
      return topics.every((want, i) => {
        if (want === null || want === undefined) return true
        const have = log.topics[i]
        if (have === undefined) return false
        const options = Array.isArray(want) ? want : [want]
        return options.some((w) => lower(w) === lower(have))
      })
    })
    .sort((a, b) => {
      const d = hexToBigInt(a.blockNumber) - hexToBigInt(b.blockNumber)
      if (d !== 0n) return d < 0n ? -1 : 1
      return Number(hexToBigInt(a.logIndex) - hexToBigInt(b.logIndex))
    })
}

function lower(s: string): string {
  return s.toLowerCase()
}

const BLOCK_HASH_CACHE_LIMIT = 100_000
const blockHashCache = new Map<bigint, Hex>()

/** Deterministic block hash for synthetic blocks (memoised, bounded). */
export function syntheticBlockHash(number: bigint): Hex {
  const cached = blockHashCache.get(number)
  if (cached !== undefined) return cached
  const hash = keccak256(stringToHex(`depthwatch-synthetic-block-${number}`))
  if (blockHashCache.size >= BLOCK_HASH_CACHE_LIMIT) blockHashCache.clear()
  blockHashCache.set(number, hash)
  return hash
}

function synthesizeBlock(clock: FixtureClock, tag: string): Record<string, unknown> | null {
  const latest = BigInt(clock.latestBlock)
  let number: bigint
  if (tag === 'earliest') number = 0n
  else if (tag.startsWith('0x')) number = hexToBigInt(tag as Hex)
  else number = latest
  if (number > latest) return null
  const schedule = clock.eras?.map((era) => ({ ...era, fromBlock: BigInt(era.fromBlock) }))
  const timestamp =
    schedule === undefined
      ? clock.latestTimestamp - Number(latest - number) * clock.secondsPerBlock
      : scheduledTimestamp(schedule, number)
  return {
    ...(schedule === undefined
      ? {}
      : { timestampMs: numberToHex(scheduledTimeMs(schedule, number)) }),
    number: numberToHex(number),
    hash: syntheticBlockHash(number),
    parentHash: syntheticBlockHash(number === 0n ? 0n : number - 1n),
    timestamp: numberToHex(timestamp),
    nonce: '0x0000000000000000',
    difficulty: '0x0',
    totalDifficulty: '0x0',
    gasLimit: '0x4000000',
    gasUsed: '0x0',
    baseFeePerGas: '0x1',
    miner: '0x4200000000000000000000000000000000000011',
    extraData: '0x',
    logsBloom: `0x${'0'.repeat(512)}`,
    mixHash: `0x${'0'.repeat(64)}`,
    receiptsRoot: `0x${'0'.repeat(64)}`,
    sha3Uncles: `0x${'0'.repeat(64)}`,
    stateRoot: `0x${'0'.repeat(64)}`,
    transactionsRoot: `0x${'0'.repeat(64)}`,
    size: '0x200',
    transactions: [],
    uncles: [],
  }
}
