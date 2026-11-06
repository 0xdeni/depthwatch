/**
 * The snapshot step's stocks (docs/design/stocks.md §4; docs/METRICS.md, "Reference deviation",
 * "Stock tradability" and "Stock aggregates"), at the pass's block:
 *
 * 1. `readStockPass`: every stock of the chain's stock list (`ChainReader.stocks`, with pools or
 *    without) read in one multicall (`ChainReader.readStocks`, run beside the state reads), each
 *    judged by core's `evaluateStockReading`. A failed request is one `stock reads failed` line
 *    and an `unread` reading for every stock; a failed call is a `stock calls failed` line for
 *    its stock, whose reading core judges from the answers it has. Nothing here fails the
 *    snapshot: only a stop (the pipeline's signal) is thrown. An empty list sends no request.
 * 2. `withReference`: a snapshotted pool holding a stock gets core's `poolReference`, from the
 *    snapshot's own mid, USD prices, ±2 % sides and fee. Its quote is independent of the stock
 *    when the quote's price route (`via`) avoids every pool of the pass's overviews holding the
 *    stock, tracked or not, since every overview is an edge of the price graph.
 * 3. `stockReadingRecords`: per stock, core's `summarizeStock` over the pass's snapshots of its
 *    pools (volume unknown) gives the `StockPassDepth` stored with the reading, so the readings
 *    keep the depth of each pass after the snapshots are pruned.
 *
 * Not an oracle: `referenceUsd` is the feed's answer as read and `poolUsd` one pool's mid in
 * dollars; nothing here combines pools into a stock price.
 */
import { type PoolOverview, type StockReadResult, stockInfos } from '@depthwatch/chain'
import {
  type Address,
  evaluateStockReading,
  isStaleQuote,
  type PoolMeta,
  type PoolReference,
  type PoolSnapshot,
  poolReference,
  quoteRouteAvoids,
  type ReferenceStatus,
  type StockEntry,
  type StockInfo,
  type StockPoolInput,
  type StockReading,
  stockPassDepth,
  summarizeStock,
} from '@depthwatch/core'
import { type StockReadingRecord, snapshotDepthSides, snapshotSummaryFields } from '@depthwatch/db'
import { errorMessage, type Logger } from '../log.js'
import type { PipelineContext } from './context.js'
import type { PriceMap } from './prices.js'

/** The stock list and each stock's reading at the pass's block. */
export interface StockPass {
  /** The chain's stock list as core's `StockInfo`, in list order: the rows of the `stocks` table. */
  infos: StockInfo[]
  /** One reading per stock, in list order. */
  readings: StockReading[]
  /** Each stock with its reading, by lowercase token address (`poolReference`'s `stocks`). */
  entries: ReadonlyMap<Address, StockEntry>
}

/** Statuses in the order core tests them, for the summary line. */
const STATUS_ORDER: readonly ReferenceStatus[] = [
  'live',
  'held',
  'paused',
  'invalid',
  'unread',
  'no-feed',
]

const lower = (address: string): Address => address.toLowerCase() as Address

/** `ChainReader.readStocks`, any error it throws but a stop answered as a failed request. */
async function readResults(
  ctx: Pick<PipelineContext, 'chain' | 'signal'>,
  infos: readonly StockInfo[],
  blockNumber: bigint,
): Promise<Map<Address, StockReadResult>> {
  let results: StockReadResult[]
  try {
    results = await ctx.chain.readStocks(blockNumber)
  } catch (error) {
    // A stop ends the step with the signal's reason, as every step does (`throwIfStopped`).
    if (ctx.signal?.aborted) throw ctx.signal.reason
    const message = errorMessage(error)
    results = infos.map((info) => ({ token: info.token.address, raw: null, error: message }))
  }
  return new Map(results.map((result) => [lower(result.token), result]))
}

/** One line for a failed request, one per stock with failed calls, then the statuses. */
function logReads(
  log: Logger,
  block: bigint,
  infos: readonly StockInfo[],
  results: ReadonlyMap<Address, StockReadResult>,
  readings: readonly StockReading[],
): void {
  const unread = infos.filter(
    (info) => (results.get(lower(info.token.address))?.raw ?? null) === null,
  )
  const [first] = unread
  if (first !== undefined)
    log.warn('stock reads failed', {
      stocks: unread.length,
      block,
      error: results.get(lower(first.token.address))?.error ?? 'not read',
    })
  for (const info of infos) {
    const result = results.get(lower(info.token.address))
    if (result !== undefined && result.raw !== null && result.error !== null)
      log.warn('stock calls failed', { stock: info.token.symbol, error: result.error })
  }
  const counts = STATUS_ORDER.map(
    (status) => [status, readings.filter((r) => r.referenceStatus === status).length] as const,
  )
  log.info('read stocks', {
    stocks: readings.length,
    block,
    statuses: counts
      .filter(([, n]) => n > 0)
      .map(([status, n]) => `${status}:${n}`)
      .join(','),
  })
}

/** Every stock of the chain's stock list at `block` (see the module comment). */
export async function readStockPass(
  ctx: Pick<PipelineContext, 'chain' | 'log' | 'signal'>,
  block: { number: bigint; timestamp: number },
): Promise<StockPass> {
  const infos = stockInfos(ctx.chain.stocks)
  if (infos.length === 0) return { infos, readings: [], entries: new Map() }
  const results = await readResults(ctx, infos, block.number)
  const at = { blockNumber: block.number, timestamp: block.timestamp }
  const entries = new Map<Address, StockEntry>()
  const readings = infos.map((info) => {
    const result = results.get(lower(info.token.address))
    const reading = evaluateStockReading(info, result?.raw ?? null, at, result?.error ?? undefined)
    entries.set(lower(info.token.address), { info, reading })
    return reading
  })
  logReads(ctx.log, block.number, infos, results, readings)
  return { infos, readings, entries }
}

/** The ids of the pass's overviews that hold each stock, by lowercase stock address. */
export function stockPoolsOf(
  views: readonly Pick<PoolOverview, 'pool'>[],
  stocks: ReadonlyMap<Address, unknown>,
): Map<Address, Set<string>> {
  const out = new Map<Address, Set<string>>()
  for (const { pool } of views) {
    for (const token of [pool.token0.address, pool.token1.address]) {
      const stock = lower(token)
      if (!stocks.has(stock)) continue
      const ids = out.get(stock) ?? new Set<string>()
      ids.add(pool.id)
      out.set(stock, ids)
    }
  }
  return out
}

/** What a snapshot's reference is computed against: the pass's stocks and price graph. */
export interface ReferenceInputs {
  /** `StockPass.entries`. */
  stocks: ReadonlyMap<Address, StockEntry>
  /** The pass's final USD prices, whose `via` is each quote's route. */
  prices: PriceMap
  /** `stockPoolsOf(views, stocks)`: every overview of the pass holding each stock. */
  stockPools: ReadonlyMap<Address, ReadonlySet<string>>
}

const NO_POOLS: ReadonlySet<string> = new Set()

/**
 * The snapshot's reference (core's `poolReference`), null for a pool without a stock. In a pool of
 * two stocks the stock is token0's, as core takes it.
 */
export function snapshotReference(
  snapshot: PoolSnapshot,
  pool: Pick<PoolMeta, 'token0' | 'token1' | 'hooks'>,
  inputs: ReferenceInputs,
): PoolReference | null {
  const token0 = lower(pool.token0.address)
  const token1 = lower(pool.token1.address)
  const stock = inputs.stocks.has(token0) ? token0 : inputs.stocks.has(token1) ? token1 : null
  if (stock === null) return null
  const quote = stock === token0 ? token1 : token0
  const via = inputs.prices.get(quote)?.via ?? []
  return poolReference({
    pool,
    price: snapshot.price,
    token0Usd: snapshot.token0Usd,
    token1Usd: snapshot.token1Usd,
    ...snapshotDepthSides(snapshot),
    feePips: snapshot.feePips,
    quoteIndependent: quoteRouteAvoids(via, inputs.stockPools.get(stock) ?? NO_POOLS),
    stocks: inputs.stocks,
  })
}

/**
 * The snapshot with its `reference` set: computed from the built snapshot, since it needs the
 * snapshot's own ±2 % sides (`buildSnapshot` itself stores `null`).
 */
export function withReference(
  snapshot: PoolSnapshot,
  pool: Pick<PoolMeta, 'token0' | 'token1' | 'hooks'>,
  inputs: ReferenceInputs,
): PoolSnapshot {
  return { ...snapshot, reference: snapshotReference(snapshot, pool, inputs) }
}

/** A snapshot of the pass as `summarizeStock` takes it; its 24 h volume is not known here. */
export function stockPoolInput(
  snapshot: PoolSnapshot,
  pool: Pick<PoolMeta, 'dex' | 'token0' | 'token1'>,
): StockPoolInput {
  return {
    poolId: snapshot.poolId,
    dex: pool.dex,
    token0: lower(pool.token0.address),
    token1: lower(pool.token1.address),
    tvlUsd: snapshot.tvlUsd,
    ...snapshotDepthSides(snapshot),
    spread10kBps: snapshotSummaryFields(snapshot).spread10kBps,
    staleQuote: isStaleQuote(snapshot.priceDeviationBps),
    volume24hUsd: null,
    reference: snapshot.reference,
  }
}

/**
 * Each reading with its pass depth: core's `summarizeStock` over the pass's snapshots of the
 * stock's pools (`pools` gives each snapshot's DEX and tokens), reduced by `stockPassDepth`. A
 * stock without a pool in the pass stores the aggregate of none (`no-pool`).
 */
export function stockReadingRecords(
  readings: readonly StockReading[],
  snapshots: readonly PoolSnapshot[],
  pools: ReadonlyMap<string, Pick<PoolMeta, 'dex' | 'token0' | 'token1'>>,
): StockReadingRecord[] {
  const inputs = snapshots.flatMap((snapshot) => {
    const pool = pools.get(snapshot.poolId)
    return pool === undefined || snapshot.reference === null ? [] : [stockPoolInput(snapshot, pool)]
  })
  return readings.map((reading) => ({
    reading,
    passDepth: stockPassDepth(summarizeStock(reading.token, inputs)),
  }))
}
