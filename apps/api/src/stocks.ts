/**
 * The bodies of `GET /api/stocks` and `GET /api/stocks/:token` (docs/design/stocks-api.md §1):
 * the stored stock list, each stock's newest reading, and its scored pools as `/api/tokens/:address`
 * lists them, each with its newest snapshot's reference and whether a newer reading of its stocks
 * pauses it (`newerReadingPauses`). Every number is core's (`summarizeStock`, `stockSides`,
 * `countsInStockSums`, docs/METRICS.md "Stock aggregates"); nothing is derived here.
 */
import {
  type Address,
  countsInStockSums,
  newerReadingPauses,
  type PoolReference,
  type SharedSymbols,
  type StockPoolInput,
  type StockReading,
  stockSides,
  summarizeStock,
  toJsonSafe,
} from '@depthwatch/core'
import type { Database, ScoredPoolRow, StockListEntry } from '@depthwatch/db'
import type { PoolSummary, StockDetail } from './dto.js'
import { MAX_LIMIT } from './query.js'
import type { StockPoolRow, StockSummary } from './stockDto.js'
import { toPoolSummary } from './summary.js'
import { labelToken } from './tokenLabels.js'

/** A scored pool of a stock: its row in the pool lists and core's input for the aggregates. */
interface StockPool {
  summary: PoolSummary
  input: StockPoolInput
}

const lower = (address: string): Address => address.toLowerCase() as Address

/** The newest reading of each stock of the list, by lowercase address. */
type Readings = ReadonlyMap<Address, StockReading>

/**
 * Core's view of a listed pool: the summary's figures, the newest snapshot's reference, and
 * whether a newer reading of either token, when it is a stock, finds its transfers paused.
 */
function poolInput(
  row: ScoredPoolRow,
  summary: PoolSummary,
  reference: PoolReference | null,
  readings: Readings,
): StockPoolInput {
  const token0 = lower(summary.pool.token0.address)
  const token1 = lower(summary.pool.token1.address)
  const pausedByNewerReading = newerReadingPauses(row.latest?.blockNumber ?? null, [
    readings.get(token0),
    readings.get(token1),
  ])
  return {
    poolId: summary.pool.id,
    dex: summary.pool.dex,
    token0,
    token1,
    tvlUsd: summary.tvlUsd,
    depth2UpUsd: summary.depth2UpUsd,
    depth2DownUsd: summary.depth2DownUsd,
    spread10kBps: summary.spread10kBps,
    staleQuote: summary.staleQuote,
    volume24hUsd: summary.volume24hUsd,
    reference,
    pausedByNewerReading,
  }
}

/** Every scored pool holding `token`, deepest first (`scores.topBy('depth')`, page by page). */
function stockPools(
  db: Database,
  token: Address,
  shared: SharedSymbols,
  readings: Readings,
): StockPool[] {
  const rows: ScoredPoolRow[] = []
  for (let offset = 0; ; offset += MAX_LIMIT) {
    const page = db.scores.topBy('depth', { token, limit: MAX_LIMIT, offset })
    rows.push(...page.items)
    if (page.items.length < MAX_LIMIT || rows.length >= page.total) break
  }
  const references = db.snapshots.latestReferences(rows.map((row) => row.pool.id))
  return rows.map((row) => {
    const summary = toPoolSummary(row, shared)
    const reference = references.get(row.pool.id) ?? null
    return { summary, input: poolInput(row, summary, reference, readings) }
  })
}

/** The newest reading of every listed stock: a pool of two stocks is paused by either's. */
function newestReadings(db: Database, entries: readonly StockListEntry[]): Readings {
  return db.stockReadings.latestForMany(entries.map((entry) => entry.token.address))
}

function toStockSummary(
  entry: StockListEntry,
  pools: readonly StockPool[],
  reading: StockReading | undefined,
  shared: SharedSymbols,
): StockSummary {
  const { token: _token, ...aggregate } = summarizeStock(
    entry.token.address,
    pools.map((p) => p.input),
  )
  return {
    stock: { token: labelToken(entry.token, shared), ticker: entry.ticker, feed: entry.feed },
    reading: reading === undefined ? null : toJsonSafe(reading),
    ...aggregate,
    updatedAt: entry.updatedAt,
  }
}

function toPoolRow(stock: Address, { summary, input }: StockPool): StockPoolRow {
  const { buyUsd, sellUsd } = stockSides(
    stock,
    input.token0,
    input.depth2UpUsd,
    input.depth2DownUsd,
  )
  return {
    pool: summary,
    stockIs: input.token0 === stock ? 'token0' : 'token1',
    depth2BuyUsd: buyUsd,
    depth2SellUsd: sellUsd,
    counted: countsInStockSums(input),
    reference: input.reference,
  }
}

/** Larger first, an unknown value last. */
function byKnownDesc(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const thinnerSide = (row: StockPoolRow): number | null =>
  row.depth2BuyUsd === null || row.depth2SellUsd === null
    ? null
    : Math.min(row.depth2BuyUsd, row.depth2SellUsd)

/** The counted pools first, then the larger thinner side (an unknown one last), then the pool id. */
export function comparePoolRows(a: StockPoolRow, b: StockPoolRow): number {
  if (a.counted !== b.counted) return a.counted ? -1 : 1
  return byKnownDesc(thinnerSide(a), thinnerSide(b)) || byText(a.pool.pool.id, b.pool.pool.id)
}

const stockDepth = (s: StockSummary): number | null =>
  s.depth2BuyUsd === null || s.depth2SellUsd === null ? null : s.depth2BuyUsd + s.depth2SellUsd

/** The larger `depth2BuyUsd + depth2SellUsd` first (an unknown one last), then ticker, address. */
export function compareStocks(a: StockSummary, b: StockSummary): number {
  return (
    byKnownDesc(stockDepth(a), stockDepth(b)) ||
    byText(a.stock.ticker, b.stock.ticker) ||
    byText(a.stock.token.address, b.stock.token.address)
  )
}

/** `GET /api/stocks`: every stored stock, with pools or not, in `compareStocks` order. */
export function listStocks(db: Database): StockSummary[] {
  const entries = db.stocks.list()
  const shared = db.tokens.sharedSymbols()
  const readings = newestReadings(db, entries)
  return entries
    .map((entry) => {
      const token = lower(entry.token.address)
      const pools = stockPools(db, token, shared, readings)
      return toStockSummary(entry, pools, readings.get(token), shared)
    })
    .sort(compareStocks)
}

/** `GET /api/stocks/:token` for a lowercase address; undefined when the stock list lacks it. */
export function stockDetail(db: Database, token: Address): StockDetail | undefined {
  const entry = db.stocks.get(token)
  if (entry === undefined) return undefined
  const shared = db.tokens.sharedSymbols()
  const stock = lower(entry.token.address)
  const readings = newestReadings(db, db.stocks.list())
  const pools = stockPools(db, stock, shared, readings)
  const summary = toStockSummary(entry, pools, readings.get(stock), shared)
  return { ...summary, pools: pools.map((p) => toPoolRow(stock, p)).sort(comparePoolRows) }
}
