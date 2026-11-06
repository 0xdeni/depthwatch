/**
 * The stock list (docs/design/stocks.md §5): the stocks the last snapshot pass read, as core's
 * `StockInfo`. The snapshot step replaces it at every pass, so the API knows which tokens are
 * stocks from this table alone. A stock without a feed has every feed column NULL.
 */
import type { Address, StockFeedInfo, StockInfo } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import { colNumber, colText, colTextOrNull, normalizeAddress, type Row, toCount } from '../sql.js'

/** A stock of the stored list, with the time the list was written. */
export interface StockListEntry extends StockInfo {
  /** Unix seconds of the `replaceAll` that wrote it. */
  updatedAt: number
}

const COLUMNS = `token, symbol, name, decimals, ticker, feed, feed_decimals, heartbeat_seconds,
  deviation_threshold_bps, feed_hours, updated_at`

const INSERT = `INSERT INTO stocks (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const FEED_HOURS: ReadonlySet<string> = new Set<StockFeedInfo['hours']>(['24/5', '24/7'])

function rowToFeed(row: Row): StockFeedInfo | null {
  const address = colTextOrNull(row, 'feed')
  if (address === null) return null
  const hours = colText(row, 'feed_hours')
  if (!FEED_HOURS.has(hours)) throw new Error(`db: column "feed_hours" holds '${hours}'`)
  return {
    address: address as Address,
    decimals: colNumber(row, 'feed_decimals'),
    heartbeatSeconds: colNumber(row, 'heartbeat_seconds'),
    deviationThresholdBps: colNumber(row, 'deviation_threshold_bps'),
    hours: hours as StockFeedInfo['hours'],
  }
}

export function rowToStock(row: Row): StockListEntry {
  return {
    token: {
      address: colText(row, 'token') as Address,
      symbol: colText(row, 'symbol'),
      name: colText(row, 'name'),
      decimals: colNumber(row, 'decimals'),
    },
    ticker: colText(row, 'ticker'),
    feed: rowToFeed(row),
    updatedAt: colNumber(row, 'updated_at'),
  }
}

export class StocksRepo {
  constructor(private readonly ctx: SqlContext) {}

  /**
   * Drops the stored list and writes `stocks` (the snapshot step writes the whole list at every
   * pass); `updatedAt` defaults to the database clock. A token listed twice throws (the primary
   * key) and nothing is written. Returns the number written.
   */
  replaceAll(stocks: readonly StockInfo[], updatedAt?: number): number {
    return this.ctx.transaction(() => {
      const at = updatedAt ?? this.ctx.now()
      this.ctx.run('DELETE FROM stocks')
      for (const { token, ticker, feed } of stocks) {
        this.ctx.run(INSERT, [
          normalizeAddress(token.address),
          token.symbol,
          token.name,
          token.decimals,
          ticker,
          feed === null ? null : normalizeAddress(feed.address),
          feed?.decimals,
          feed?.heartbeatSeconds,
          feed?.deviationThresholdBps,
          feed?.hours,
          at,
        ])
      }
      return stocks.length
    })
  }

  /** Every stored stock, by ticker then address. */
  list(): StockListEntry[] {
    return this.ctx.all(`SELECT ${COLUMNS} FROM stocks ORDER BY ticker, token`).map(rowToStock)
  }

  /** The stored stock of a token address (any case), or undefined when the token is no stock. */
  get(token: string): StockListEntry | undefined {
    const row = this.ctx.get(`SELECT ${COLUMNS} FROM stocks WHERE token = ?`, [
      normalizeAddress(token),
    ])
    return row ? rowToStock(row) : undefined
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM stocks')
    return row ? toCount(colNumber(row, 'n')) : 0
  }
}
