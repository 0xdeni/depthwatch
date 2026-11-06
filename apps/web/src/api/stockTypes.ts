/**
 * Wire shapes of the stock routes (`GET /api/stocks`, `GET /api/stocks/:token`), mirrored from
 * `apps/api/src/stockDto.ts` and the two responses of `apps/api/src/dto.ts`, in their own file
 * because `types.ts` is long; keep them in lock-step with the API's (docs/design/stocks-api.md §1).
 * `StockApi` is the client's half: the two calls `ApiClient` adds for them.
 *
 * Not an oracle: `reading.referenceUsd` is Chainlink's answer passed on with its status and age,
 * a pool's `poolUsd` that one pool's mid; Depthwatch publishes no stock price of its own.
 */
import type {
  Jsonified,
  PoolReference,
  StockAggregate,
  StockFeedInfo,
  StockReading,
} from '@depthwatch/core'
import type { PoolSummary, TokenDto } from './types.js'

/** A stock of the stock list. The address is the identity: a token's symbol can change on chain. */
export interface StockDto {
  token: TokenDto
  /** The ticker of the feed's description, "Coinbase <ticker>". */
  ticker: string
  /** Null when the stock list records no feed for the stock (`no-feed`). */
  feed: StockFeedInfo | null
}

/** A reading on the wire: its block, round, answer and multipliers are decimal strings. */
export type StockReadingDto = Jsonified<StockReading>

/** One stock across its scored pools (docs/METRICS.md, "Stock aggregates"), with its reading. */
export interface StockSummary extends Omit<StockAggregate, 'token'> {
  stock: StockDto
  /** The newest stored reading; null before the first one. */
  reading: StockReadingDto | null
  /** Unix seconds the stock list was last written: the block time of the newest snapshot pass. */
  updatedAt: number
}

/** One scored pool of a stock, oriented to the stock. */
export interface StockPoolRow {
  pool: PoolSummary
  stockIs: 'token0' | 'token1'
  /** The ±2 % side whose input is the quote: buying the stock. */
  depth2BuyUsd: number | null
  /** The ±2 % side whose input is the stock: selling it. */
  depth2SellUsd: number | null
  /**
   * Not a stale quote, and the stock's transfers paused neither at the pool's snapshot nor at a
   * newer reading: in the stock's spread, and with both sides known in its depth sums.
   */
  counted: boolean
  /** The newest snapshot's reference; null for one stored before schema version 8. */
  reference: PoolReference | null
}

/** `GET /api/stocks`: every stock, by `depth2BuyUsd + depth2SellUsd` descending, then ticker. */
export interface StocksResponse {
  items: StockSummary[]
}

/** `GET /api/stocks/:token`: the summary plus every scored pool, the counted ones first. */
export type StockDetail = StockSummary & { pools: StockPoolRow[] }

/**
 * The stock routes of `ApiClient` (types.ts), answered by the HTTP, mock and static clients with
 * the API's semantics: a malformed address is a 400 `invalid token address: expected 0x + 40 hex
 * chars`, a token the stock list lacks a 404 `stock not found`.
 */
export interface StockApi {
  /** `GET /api/stocks`. */
  stocks(): Promise<StocksResponse>
  /** `GET /api/stocks/:token`, any case: the address is lowercased first. */
  stock(address: string): Promise<StockDetail>
}
