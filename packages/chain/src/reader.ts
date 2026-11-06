/**
 * `createChainReader`: composes the per-DEX adapters over viem public clients for Base.
 * Token metadata and block timestamps are cached per reader; every contract read goes through
 * Multicall3 (≤ `maxCallsPerMulticall` calls per aggregate3, at most `maxConcurrentMulticalls`
 * aggregate3 requests of one read in flight) on the main client, and every log
 * scan through chunked `eth_getLogs` on the logs client (`logsRpcUrl` / `logsTransport`, default:
 * the main endpoint), with range splitting (see internal/logs.ts). Every request, on either
 * client, is retried on rate limits and transient failures by one bounded backoff
 * (internal/backoff.ts).
 * Swap timestamps follow the block schedule once a few headers on the main client confirm it, else
 * anchor headers (internal/timestamps.ts).
 */
import {
  type Address,
  BASE_CHAIN_ID,
  type Dex,
  type LpHolding,
  type PoolMeta,
  type PoolState,
  type Position,
  type SwapEvent,
  type TokenInfo,
} from '@depthwatch/core'
import { createPublicClient, http, type Transport } from 'viem'
import { base } from 'viem/chains'
import { ADAPTERS } from './adapters/index.js'
import { type ChainAddresses, resolveAddresses } from './addresses.js'
import type { BackoffEvent } from './internal/backoff.js'
import { blockAtOrAfter, blockReads } from './internal/blocks.js'
import type { LogRetryPolicy, ReaderContext } from './internal/context.js'
import { readStocks, type StockReadResult } from './internal/stocks.js'
import { type ReadSwapsOptions, readSwapScans } from './internal/swapScans.js'
import { DEFAULT_TIMESTAMP_SPAN, fillTimestamps } from './internal/timestamps.js'
import { readTokens as readTokensWithCache } from './internal/tokens.js'
import type { PoolOverview } from './internal/types.js'
import { BASE_BLOCK_SCHEDULE, type BlockSchedule } from './schedule.js'
import { type SeedPoolsOptions, type SeedResult, seedPools } from './seed/index.js'
import { BASE_STOCKS, resolveStockList, type StockList } from './stocks.js'
import {
  abortableSleep,
  observeTransport,
  type RpcEndpoint,
  type RpcRequestEvent,
} from './transport/observed.js'

export { TIMESTAMP_CACHE_LIMIT } from './internal/blocks.js'
export type { LogRetryEvent, LogRetryPolicy } from './internal/context.js'
export {
  type ReadSwapsOptions,
  type SwapScanProgress,
  swapScanGroups,
  swapScanOf,
} from './internal/swapScans.js'
export { DEFAULT_TIMESTAMP_SPAN } from './internal/timestamps.js'
export type { PoolOverview } from './internal/types.js'

export const DEFAULT_RPC_URL = 'https://mainnet.base.org'
export const DEFAULT_LOG_CHUNK_SIZE = 10_000n
export const DEFAULT_MAX_CALLS_PER_MULTICALL = 500
/**
 * Aggregate3 requests one batched read keeps in flight: a first positions read touches every
 * token of a position manager (2–3 calls each), thousands of groups that would otherwise all be
 * sent at once to an endpoint that already answers 429 at a handful of parallel requests.
 */
export const DEFAULT_MAX_CONCURRENT_MULTICALLS = 4
/**
 * Smallest span a rejected `eth_getLogs` range is split to (or `logChunkSize`, when that is
 * smaller). Below it the reader throws `LogRangeLimitError`: at 100 blocks a first discovery of
 * Base (about 52 M blocks for Uniswap v3's factory at Denim's activation, block 53 556 127) would
 * already take about 520 000 requests per factory, and the chain has grown 432 000 blocks a day
 * since (200 ms blocks), 4 320 more requests per factory a day, so a smaller limit means a
 * different endpoint, or a chunk size set to the provider's limit for short scans.
 */
export const DEFAULT_MIN_LOG_RANGE = 100n
/**
 * Backoff for every rate-limited / transient request (HTTP 429, 5xx, timeouts): `eth_getLogs`,
 * the main endpoint's multicalls and block reads, the creation-block search. 1, 2, 4, 8, 16, 30,
 * 30, 30 s, about two minutes in all before the request fails (internal/backoff.ts).
 */
export const DEFAULT_LOG_RETRY: Readonly<
  Pick<LogRetryPolicy, 'retries' | 'baseDelayMs' | 'maxDelayMs'>
> = Object.freeze({ retries: 8, baseDelayMs: 1_000, maxDelayMs: 30_000 })
/**
 * `eth_getLogs` over a URL (`logsRpcUrl`, or `rpcUrl` when no logs endpoint is given) gets its own
 * HTTP transport: no viem-level retries (the backoff above owns them, so a rate-limited endpoint is
 * not hit again at once) and a 30 s timeout, since a 2 000-block `eth_getLogs` on a busy public
 * node can take longer than viem's 10 s default. The reasoning dates from Base's 2 s blocks, when
 * 2 000 blocks were 67 minutes of chain; since Denim they are 400 s (200 ms blocks), but a
 * backfill still reads the older ranges and a larger `logChunkSize` spans more.
 */
export const LOGS_HTTP_TIMEOUT_MS = 30_000
/**
 * The main endpoint's HTTP transport (built from `rpcUrl`) gets no viem-level retries either: its
 * multicalls and block reads go through the same backoff, so a 429 waits 1 s, 2 s, … instead of
 * three quick retries that a rate-limited endpoint refuses too.
 */
export const MAIN_HTTP_RETRY_COUNT = 0

export interface ChainReader {
  readonly chainId: typeof BASE_CHAIN_ID
  /** Resolved addresses (defaults merged with overrides, every address lowercased). */
  readonly addresses: ChainAddresses
  /** The stock list (default BASE_STOCKS), every address lowercased (`resolveStockList`). */
  readonly stocks: StockList
  getLatestBlock(): Promise<{ number: bigint; timestamp: number }>
  getBlockTimestamp(blockNumber: bigint): Promise<number>
  /**
   * First block ≤ `toBlock` whose timestamp is ≥ `timestamp` (Unix seconds), else `toBlock + 1n`:
   * the schedule's block once two headers confirm it, else a binary search (internal/blocks.ts).
   */
  blockAtOrAfter(timestamp: number, toBlock: bigint): Promise<bigint>
  /** Factory/PoolManager log scan in chunks; token metadata resolved and cached. */
  discoverPools(dex: Dex, fromBlock: bigint, toBlock: bigint): Promise<PoolMeta[]>
  /**
   * Discovery without logs: the pools of a token list (default: the reference tokens) asked from
   * each DEX at one block (default: latest), creation blocks found by binary search over archive
   * state (see seed/index.ts). The PoolMeta equal what `discoverPools` yields for the same pools.
   */
  seedPools(opts?: SeedPoolsOptions): Promise<SeedResult>
  /**
   * Stored pools' PoolMeta read again at the head as discovery builds them (stored tokens, tick
   * spacing and creation block kept), for DEXes whose PoolMeta holds a reading the state reads
   * check (Aero Slipstream: `hooks`). Other DEXes' pools, and pools no factory reports, are left out.
   */
  refreshPoolMetas(pools: readonly PoolMeta[]): Promise<PoolMeta[]>
  readTokens(addresses: Address[]): Promise<TokenInfo[]>
  /**
   * Every stock's feed, oracle-registry and token answers at `blockNumber`, one multicall, in list
   * order (internal/stocks.ts): a failed call nulls its fields, a failed request every `raw`.
   */
  readStocks(blockNumber: bigint): Promise<StockReadResult[]>
  /** One multicall-batched pass over all pools at `blockNumber` (default: latest). */
  readOverview(pools: PoolMeta[], blockNumber?: bigint): Promise<PoolOverview[]>
  /**
   * Full pool state; concentrated pools get a tick walk covering ≥ max(2·bandPct, 10) % each side.
   * An Aero pool whose configuration changed (fee module, swap hook, initial fee) throws
   * `PoolConfigChangedError` (internal/poolErrors.ts).
   */
  readState(pool: PoolMeta, opts: { bandPct: number; blockNumber?: bigint }): Promise<PoolState>
  /** Positions touched in the range, with current liquidity/owner. Aerodrome v2 and Aero v2: []. */
  readPositions(pool: PoolMeta, opts: { fromBlock: bigint; toBlock: bigint }): Promise<Position[]>
  /**
   * Swap events, timed by the block schedule once headers confirm it, else between anchor headers
   * every `timestampSpan` blocks (internal/timestamps.ts). One log scan per `Swap` event source
   * (Uniswap v3 and both Slipstreams share one filter, Aerodrome v2 and Aero v2 another; see
   * internal/swapScans.ts); `onProgress` hears every chunk and backoff of them.
   */
  readSwaps(
    pools: PoolMeta[],
    fromBlock: bigint,
    toBlock: bigint,
    opts?: ReadSwapsOptions,
  ): Promise<SwapEvent[]>
  /**
   * Aerodrome v2 and Aero v2 only (other DEX kinds throw): LP-token balance, gauge-staked balance
   * (gauge from `Voter.gauges(pool)` or, for Aero v2, `FactoryRegistry.targetToGauge(pool)`; 0n
   * without one) and total supply per address, multicall-batched at `blockNumber` (default:
   * latest). Addresses are lowercased and deduplicated, input order kept.
   */
  readLpHoldings(
    pool: PoolMeta,
    addresses: readonly Address[],
    blockNumber?: bigint,
  ): Promise<LpHolding[]>
  /**
   * Slipstream (Aerodrome and Aero) only: positions owned by the pool's CLGauge (`CLPool.gauge()`)
   * are rewritten to the candidate for which `CLGauge.stakedContains(candidate, tokenId)` holds
   * (first match wins); every other position passes through unchanged. Other pools: positions
   * unchanged, nothing is read.
   */
  resolveStakedOwners(
    pool: PoolMeta,
    positions: readonly Position[],
    candidates: readonly Address[],
    blockNumber?: bigint,
  ): Promise<Position[]>
  /**
   * Addresses that hold the pool's positions on behalf of depositors (lowercase), at `blockNumber`
   * (default: latest): a Slipstream (Aerodrome or Aero) pool's CLGauge (`CLPool.gauge()`), which
   * owns every staked NFT. [] for a pool without a gauge and for the other DEXes (nothing is read).
   */
  readCustodians(pool: PoolMeta, blockNumber?: bigint): Promise<Address[]>
}

export interface CreateChainReaderOptions {
  /** Main endpoint: every read but `eth_getLogs` (default https://mainnet.base.org). */
  rpcUrl?: string
  /** Main transport; wins over `rpcUrl`. */
  transport?: Transport
  /** Endpoint for `eth_getLogs` only (default: `rpcUrl`, or `transport` when that is given). */
  logsRpcUrl?: string
  /** Transport for `eth_getLogs` only; wins over `logsRpcUrl`. */
  logsTransport?: Transport
  addresses?: Partial<ChainAddresses>
  /** The stock list `readStocks` reads (default BASE_STOCKS; validated as `addresses` is). */
  stocks?: StockList
  /** Blocks per `eth_getLogs` request (default 10 000). */
  logChunkSize?: number | bigint
  /** Smallest span a rejected range is split to (default 100, see DEFAULT_MIN_LOG_RANGE). */
  minLogRange?: number | bigint
  /**
   * The backoff policy of every rate-limited / transient request: `eth_getLogs`, the main
   * endpoint's multicalls and block reads, `seedPools`'s creation-block search (defaults:
   * DEFAULT_LOG_RETRY, real timers). `onRetry` hears the `eth_getLogs` backoffs.
   */
  logRetry?: Partial<LogRetryPolicy>
  /** Each backoff of a main-endpoint request (multicall / `eth_call`, block, `eth_getCode`). */
  onCallRetry?: (event: BackoffEvent) => void
  /** Calls per Multicall3 aggregate3 (default 500). */
  maxCallsPerMulticall?: number
  /** Aggregate3 requests of one batched read in flight at once (default 4). */
  maxConcurrentMulticalls?: number
  /** Blocks between swap-timestamp anchors (default 10 000, see DEFAULT_TIMESTAMP_SPAN). */
  timestampSpan?: number | bigint
  /** Block times once headers confirm them (default BASE_BLOCK_SCHEDULE; null: headers only). */
  blockSchedule?: BlockSchedule | null
  /**
   * Hears every JSON-RPC request as it is sent (each retry again), with its endpoint: `logs` for
   * `eth_getLogs`, `main` for everything else (transport/observed.ts).
   */
  onRequest?: (event: RpcRequestEvent) => void
  /**
   * Stops the reader: once it aborts, in-flight requests over the URL transports are cancelled,
   * backoff waits end and every later request fails at once with the signal's reason, which the
   * backoff never retries.
   */
  signal?: AbortSignal
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** `fetch` options of the URL transports: the reader's abort signal, when there is one. */
function fetchOptionsOf(opts: CreateChainReaderOptions): { signal: AbortSignal } | undefined {
  return opts.signal === undefined ? undefined : { signal: opts.signal }
}

/** The logs transport, or undefined when `eth_getLogs` shares a caller-supplied main transport. */
function logsTransportOf(opts: CreateChainReaderOptions): Transport | undefined {
  if (opts.logsTransport !== undefined) return opts.logsTransport
  const url = opts.logsRpcUrl ?? (opts.transport === undefined ? opts.rpcUrl : undefined)
  if (url === undefined && opts.transport !== undefined) return undefined
  return http(url ?? DEFAULT_RPC_URL, {
    retryCount: 0,
    timeout: LOGS_HTTP_TIMEOUT_MS,
    fetchOptions: fetchOptionsOf(opts),
  })
}

/** A shared transport counts `eth_getLogs` against the logs endpoint, the rest against main. */
const endpointOfMethod = (method: string): RpcEndpoint =>
  method === 'eth_getLogs' ? 'logs' : 'main'

function groupByDex(pools: PoolMeta[]): Map<Dex, { pool: PoolMeta; index: number }[]> {
  const groups = new Map<Dex, { pool: PoolMeta; index: number }[]>()
  pools.forEach((pool, index) => {
    const g = groups.get(pool.dex) ?? []
    g.push({ pool, index })
    groups.set(pool.dex, g)
  })
  return groups
}

export function createChainReader(opts: CreateChainReaderOptions = {}): ChainReader {
  const addresses = resolveAddresses(opts.addresses)
  const stocks = resolveStockList(opts.stocks ?? BASE_STOCKS)
  const { onRequest, signal } = opts
  const logsInner = logsTransportOf(opts)
  const transport = observeTransport(
    opts.transport ??
      http(opts.rpcUrl ?? DEFAULT_RPC_URL, {
        retryCount: MAIN_HTTP_RETRY_COUNT,
        fetchOptions: fetchOptionsOf(opts),
      }),
    { endpoint: logsInner === undefined ? endpointOfMethod : 'main', onRequest, signal },
  )
  const client = createPublicClient({ chain: base, transport })
  const logsTransport =
    logsInner === undefined
      ? undefined
      : observeTransport(logsInner, { endpoint: 'logs', onRequest, signal })
  const timestampSpan = BigInt(opts.timestampSpan ?? DEFAULT_TIMESTAMP_SPAN)
  const schedule = opts.blockSchedule === undefined ? BASE_BLOCK_SCHEDULE : opts.blockSchedule
  const retrySleep = opts.logRetry?.sleep
  const ctx: ReaderContext = {
    client,
    logsClient:
      logsTransport === undefined
        ? client
        : createPublicClient({ chain: base, transport: logsTransport }),
    addresses,
    logChunkSize: BigInt(opts.logChunkSize ?? DEFAULT_LOG_CHUNK_SIZE),
    minLogRange: BigInt(opts.minLogRange ?? DEFAULT_MIN_LOG_RANGE),
    logRangeCap: undefined,
    logRetry: {
      ...DEFAULT_LOG_RETRY,
      onRetry: undefined,
      ...opts.logRetry,
      sleep: signal === undefined ? (retrySleep ?? wait) : abortableSleep(signal, retrySleep),
    },
    onCallRetry: opts.onCallRetry,
    maxCallsPerMulticall: opts.maxCallsPerMulticall ?? DEFAULT_MAX_CALLS_PER_MULTICALL,
    maxConcurrentMulticalls: opts.maxConcurrentMulticalls ?? DEFAULT_MAX_CONCURRENT_MULTICALLS,
    tokenCache: new Map(),
    timestampCache: new Map(),
    nfpmCache: new Map(),
    v4TransferCache: new Map(),
  }
  if (ctx.logChunkSize <= 0n) throw new RangeError('logChunkSize must be positive')
  if (ctx.minLogRange <= 0n) throw new RangeError('minLogRange must be positive')
  if (ctx.logRetry.retries < 0) throw new RangeError('logRetry.retries must be ≥ 0')
  if (ctx.maxCallsPerMulticall <= 0) throw new RangeError('maxCallsPerMulticall must be positive')
  if (!Number.isInteger(ctx.maxConcurrentMulticalls) || ctx.maxConcurrentMulticalls <= 0)
    throw new RangeError('maxConcurrentMulticalls must be a positive integer')
  if (timestampSpan <= 0n) throw new RangeError('timestampSpan must be positive')

  const { getLatestBlock, getBlockTimestamp } = blockReads(ctx)

  async function resolveBlock(blockNumber: bigint | undefined): Promise<bigint> {
    return blockNumber ?? (await getLatestBlock()).number
  }

  return {
    chainId: BASE_CHAIN_ID,
    addresses,
    stocks,
    getLatestBlock,
    getBlockTimestamp,
    blockAtOrAfter: (timestamp, toBlock) =>
      blockAtOrAfter(timestamp, toBlock, getBlockTimestamp, schedule),
    discoverPools: (dex, fromBlock, toBlock) => ADAPTERS[dex].discover(ctx, fromBlock, toBlock),
    async seedPools(seedOpts = {}) {
      return seedPools(ctx, await resolveBlock(seedOpts.blockNumber), seedOpts)
    },
    async refreshPoolMetas(pools) {
      const metas = await Promise.all(
        [...groupByDex([...pools])].map(
          ([dex, entries]) =>
            ADAPTERS[dex].refreshMetas?.(
              ctx,
              entries.map((e) => e.pool),
            ) ?? [],
        ),
      )
      return metas.flat()
    },
    readTokens: (tokens) => readTokensWithCache(ctx, tokens),
    readStocks: (blockNumber) => readStocks(ctx, stocks, blockNumber, signal),
    async readOverview(pools, blockNumber) {
      if (pools.length === 0) return []
      const block = await resolveBlock(blockNumber)
      const out: PoolOverview[] = new Array(pools.length)
      await Promise.all(
        [...groupByDex(pools)].map(async ([dex, entries]) => {
          const views = await ADAPTERS[dex].overview(
            ctx,
            entries.map((e) => e.pool),
            block,
          )
          views.forEach((view, i) => {
            const entry = entries[i]
            if (entry) out[entry.index] = view
          })
        }),
      )
      return out
    },
    async readState(pool, { bandPct, blockNumber }) {
      const block = await resolveBlock(blockNumber)
      const timestamp = await getBlockTimestamp(block)
      return ADAPTERS[pool.dex].state(ctx, pool, { bandPct, blockNumber: block, timestamp })
    },
    readPositions: (pool, range) => ADAPTERS[pool.dex].positions(ctx, pool, range),
    async readSwaps(pools, fromBlock, toBlock, swapOpts) {
      if (pools.length === 0 || toBlock < fromBlock) return []
      const events = await readSwapScans(ctx, pools, fromBlock, toBlock, swapOpts)
      await fillTimestamps(events, toBlock, timestampSpan, getBlockTimestamp, schedule)
      return events
    },
    readLpHoldings(pool, addresses, blockNumber) {
      const read = ADAPTERS[pool.dex].lpHoldings
      if (!read)
        return Promise.reject(
          new Error(`readLpHoldings: ${pool.dex} has no fungible LP token (pool ${pool.id})`),
        )
      return read(ctx, pool, addresses, blockNumber)
    },
    resolveStakedOwners(pool, positions, candidates, blockNumber) {
      const resolve = ADAPTERS[pool.dex].stakedOwners
      if (!resolve) return Promise.resolve([...positions])
      return resolve(ctx, pool, positions, candidates, blockNumber)
    },
    readCustodians(pool, blockNumber) {
      const read = ADAPTERS[pool.dex].custodians
      if (!read) return Promise.resolve([])
      return read(ctx, pool, blockNumber)
    },
  }
}
