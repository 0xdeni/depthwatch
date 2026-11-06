/**
 * Wire shapes of the stock routes (docs/design/stocks-api.md §1). `dto.ts` declares the two
 * responses, `StocksResponse` and `StockDetail`, from these rows; `apps/web/src/api/stockTypes.ts`
 * mirrors them.
 *
 * Not an oracle: `reading.referenceUsd` is Chainlink's answer passed on with its status and age,
 * and a pool's `poolUsd` that one pool's mid; Depthwatch publishes no stock price of its own.
 */
import type {
  Jsonified,
  PoolReference,
  StockAggregate,
  StockFeedInfo,
  StockReading,
} from '@depthwatch/core'
import type { PoolSummary, TokenDto } from './dto.js'

/** A stock of the stored stock list, its token labelled as every response labels tokens. */
export interface StockDto {
  /** The stock token; its address is the identity (a symbol can change on chain). */
  token: TokenDto
  /** The ticker of the feed's `description()`, "Coinbase <ticker>". */
  ticker: string
  /** The stock's Chainlink feed; null when the stock list records none (`no-feed`). */
  feed: StockFeedInfo | null
}

/** A reading on the wire: its block, round, answer and multipliers are decimal strings. */
export type StockReadingDto = Jsonified<StockReading>

/**
 * One stock across its scored pools: core's `summarizeStock` (docs/METRICS.md, "Stock
 * aggregates") over the pools as `/api/tokens/:address` lists them, each with its newest
 * snapshot's reference, beside the stock's newest reading.
 */
export interface StockSummary extends Omit<StockAggregate, 'token'> {
  stock: StockDto
  /** The newest stored reading (docs/METRICS.md, "The reading"); null before the first one. */
  reading: StockReadingDto | null
  /** Unix seconds the stock list was last written: the block time of the newest snapshot pass. */
  updatedAt: number
}

/** One scored pool of a stock (`GET /api/stocks/:token`), oriented to the stock. */
export interface StockPoolRow {
  pool: PoolSummary
  /** Which of the pool's tokens is the stock. */
  stockIs: 'token0' | 'token1'
  /** The ±2 % side whose input is the quote (core `stockSides`): buying the stock. */
  depth2BuyUsd: number | null
  /** The ±2 % side whose input is the stock: selling it. */
  depth2SellUsd: number | null
  /**
   * Core `countsInStockSums`: the quote is not stale, and the stock's transfers are paused neither
   * at the pool's snapshot nor at a newer reading (`newerReadingPauses`).
   */
  counted: boolean
  /** The newest snapshot's reference; null for one stored before schema version 8. */
  reference: PoolReference | null
}
