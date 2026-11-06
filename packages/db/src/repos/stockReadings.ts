/**
 * Stock readings (docs/design/stocks.md §5): one per stock and snapshot block, each with the pass
 * depth the snapshot step computed over that pass's pools of the stock. Never pruned: the readings
 * are the only record that outlives the snapshots.
 *
 * bigints are decimal TEXT; `paused_features` holds the feature names comma-separated in ordinal
 * order ('' for none, NULL when the call failed); `pass_depth_json` is a StockPassDepth (no bigint).
 * `transfersPaused` is not stored: it is core's `isTransferPaused` of the stored features.
 */
import {
  type Address,
  isTransferPaused,
  PAUSABLE_FEATURES,
  type PausableFeature,
  type ReferenceStatus,
  type StockPassDepth,
  type StockReading,
} from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import {
  colBigint,
  colBigintOrNull,
  colJsonOrNull,
  colNumber,
  colNumberOrNull,
  colText,
  colTextOrNull,
  normalizeAddress,
  type Row,
  toCount,
} from '../sql.js'

/** A reading as the snapshot step stores it: with its pass depth (null when none was computed). */
export interface StockReadingRecord {
  reading: StockReading
  passDepth: StockPassDepth | null
}

const COLUMNS = `token, block_number, timestamp, status, reference_usd, feed_age_seconds,
  feed_round_id, feed_answer, feed_updated_at, oracle_multiplier, oracle_paused, token_multiplier,
  paused_features, error, pass_depth_json`

/** One reading per stock and block (the primary key): a stored one is kept. */
const INSERT = `INSERT OR IGNORE INTO stock_readings (${COLUMNS})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/** Newest first: by timestamp, then block (five Base blocks share a second since Denim). */
const NEWEST_FIRST = 'timestamp DESC, CAST(block_number AS INTEGER) DESC'

/**
 * A stock's newest reading: the (token, timestamp) index walks the token's rows newest first and
 * the limit stops it in the newest second, so the cost does not grow with the never-pruned table.
 */
const LATEST = `SELECT ${COLUMNS} FROM stock_readings WHERE token = ?
  ORDER BY ${NEWEST_FIRST} LIMIT 1`

const STATUSES: ReadonlySet<string> = new Set<ReferenceStatus>([
  'live',
  'held',
  'paused',
  'invalid',
  'unread',
  'no-feed',
])

function encodeFeatures(features: readonly PausableFeature[] | null): string | null {
  return features === null ? null : features.join(',')
}

function decodeFeatures(row: Row): PausableFeature[] | null {
  const text = colTextOrNull(row, 'paused_features')
  if (text === null) return null
  const names = new Set(text === '' ? [] : text.split(','))
  for (const name of names) {
    if (!(PAUSABLE_FEATURES as readonly string[]).includes(name))
      throw new Error(`db: column "paused_features" holds '${name}'`)
  }
  return PAUSABLE_FEATURES.filter((feature) => names.has(feature))
}

function colBoolOrNull(row: Row, col: string): boolean | null {
  const value = colNumberOrNull(row, col)
  return value === null ? null : value !== 0
}

export function rowToStockReading(row: Row): StockReading {
  const status = colText(row, 'status')
  if (!STATUSES.has(status)) throw new Error(`db: column "status" holds '${status}'`)
  const pausedFeatures = decodeFeatures(row)
  return {
    token: colText(row, 'token') as Address,
    blockNumber: colBigint(row, 'block_number'),
    timestamp: colNumber(row, 'timestamp'),
    referenceStatus: status as ReferenceStatus,
    referenceUsd: colNumberOrNull(row, 'reference_usd'),
    feedAgeSeconds: colNumberOrNull(row, 'feed_age_seconds'),
    feedRoundId: colBigintOrNull(row, 'feed_round_id'),
    feedAnswer: colBigintOrNull(row, 'feed_answer'),
    feedUpdatedAt: colNumberOrNull(row, 'feed_updated_at'),
    oracleMultiplierWad: colBigintOrNull(row, 'oracle_multiplier'),
    oraclePaused: colBoolOrNull(row, 'oracle_paused'),
    tokenMultiplierWad: colBigintOrNull(row, 'token_multiplier'),
    pausedFeatures,
    transfersPaused: isTransferPaused(pausedFeatures),
    error: colTextOrNull(row, 'error'),
  }
}

export function rowToStockReadingRecord(row: Row): StockReadingRecord {
  return {
    reading: rowToStockReading(row),
    passDepth: colJsonOrNull<StockPassDepth>(row, 'pass_depth_json'),
  }
}

export class StockReadingsRepo {
  constructor(private readonly ctx: SqlContext) {}

  /**
   * Appends one reading and returns true, or false when the stock already has a reading at that
   * block (a second writer's copy), which is kept as it is.
   */
  insert({ reading, passDepth }: StockReadingRecord): boolean {
    const { changes } = this.ctx.run(INSERT, [
      normalizeAddress(reading.token),
      reading.blockNumber,
      reading.timestamp,
      reading.referenceStatus,
      reading.referenceUsd,
      reading.feedAgeSeconds,
      reading.feedRoundId,
      reading.feedAnswer,
      reading.feedUpdatedAt,
      reading.oracleMultiplierWad,
      reading.oraclePaused,
      reading.tokenMultiplierWad,
      encodeFeatures(reading.pausedFeatures),
      reading.error,
      passDepth === null ? null : JSON.stringify(passDepth),
    ])
    return changes > 0
  }

  /** Inserts every reading in one transaction; returns how many were stored (see `insert`). */
  insertMany(records: readonly StockReadingRecord[]): number {
    if (records.length === 0) return 0
    return this.ctx.transaction(() => records.filter((record) => this.insert(record)).length)
  }

  /** The newest reading of a stock (any case), or undefined when it has none. */
  latestFor(token: string): StockReading | undefined {
    const row = this.ctx.get(LATEST, [normalizeAddress(token)])
    return row ? rowToStockReading(row) : undefined
  }

  /**
   * The newest reading of each stock (any case), one indexed lookup per stock (`latestFor`): a
   * window over every row of the stocks would grow with the table. Stocks without readings are
   * absent.
   */
  latestForMany(tokens: readonly string[]): Map<Address, StockReading> {
    const out = new Map<Address, StockReading>()
    for (const token of new Set(tokens.map(normalizeAddress))) {
      const reading = this.latestFor(token)
      if (reading !== undefined) out.set(reading.token, reading)
    }
    return out
  }

  /**
   * A stock's readings with `fromTs <= timestamp` (and `timestamp <= toTs` when given), with their
   * pass depth, ascending by timestamp then block.
   */
  seriesFor(token: string, fromTs: number, toTs?: number): StockReadingRecord[] {
    const bounded = toTs === undefined ? '' : ' AND timestamp <= ?'
    const params = toTs === undefined ? [fromTs] : [fromTs, toTs]
    const rows = this.ctx.all(
      `SELECT ${COLUMNS} FROM stock_readings WHERE token = ? AND timestamp >= ?${bounded}
        ORDER BY timestamp, CAST(block_number AS INTEGER)`,
      [normalizeAddress(token), ...params],
    )
    return rows.map(rowToStockReadingRecord)
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM stock_readings')
    return row ? toCount(colNumber(row, 'n')) : 0
  }
}
