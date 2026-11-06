/**
 * Stock readings (docs/design/stocks.md §5): one per stock and block, judged by core
 * (`evaluateStockReading`) and stored with the pass depth; every field round-trips, bigints above
 * 2^64 included, and the newest reading is found by timestamp, then block.
 */
import {
  evaluateStockReading,
  makeStock,
  type StockInfo,
  type StockPassDepth,
  type StockRawRead,
  type StockReading,
  stockPassDepth,
  stockRawRead,
  summarizeStock,
} from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import type { StockReadingRecord } from './stockReadings.js'

const NVDA = makeStock('NVDAc')
const AMZN = makeStock('AMZNc')
const NOFEED = makeStock('ZZZc', { feed: null })
/** Wednesday 2026-11-04 15:00 UTC, and the Saturday after it, inside the weekly close. */
const WEDNESDAY = 1_793_804_400
const SATURDAY = 1_794_063_600
const BLOCK = 53_600_000n

function read(
  stock: StockInfo,
  timestamp: number,
  blockNumber: bigint,
  raw: StockRawRead | null = stockRawRead(stock, 19_950_000_000n, timestamp - 1_800),
  error?: string,
): StockReading {
  return evaluateStockReading(stock, raw, { blockNumber, timestamp }, error)
}

const NO_POOL: StockPassDepth = stockPassDepth(summarizeStock(NVDA.token.address, []))
const DEPTH: StockPassDepth = {
  depth2BuyUsd: 412_000,
  depth2SellUsd: 398_500.5,
  sidesKnownPools: 3,
  deepestPoolId: 'aero-slipstream:0x000000000000000000000000000000000000c8ec',
  deviationBps: 11.17,
  withinTolerance: true,
  deviationNull: null,
}

const record = (reading: StockReading, passDepth: StockPassDepth | null = DEPTH) => ({
  reading,
  passDepth,
})

describe('StockReadingsRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('round-trips a live reading, its answers above 2^64 and its pass depth', () => {
    const raw = stockRawRead(NVDA, 19_950_000_000n, WEDNESDAY - 1_800, {
      roundId: 2n ** 80n - 3n,
      oracleMultiplierWad: 1_000_538_000_000_000_000n,
      tokenMultiplierWad: 1_000_538_000_000_000_000n,
    })
    const reading = read(NVDA, WEDNESDAY, BLOCK, raw)
    expect(reading).toMatchObject({ referenceStatus: 'live', feedAgeSeconds: 1_800 })
    expect(db.stockReadings.insertMany([record(reading)])).toBe(1)
    expect(db.stockReadings.latestFor(NVDA.token.address)).toEqual(reading)
    expect(db.stockReadings.seriesFor(NVDA.token.address, 0)).toEqual([record(reading)])
    const stored = db.stockReadings.latestFor(NVDA.token.address)
    expect(stored?.feedRoundId).toBe(2n ** 80n - 3n)
    expect([stored?.pausedFeatures, stored?.transfersPaused]).toEqual([[], false])
  })

  it('round-trips every status, paused features and the error text', () => {
    const readings: StockReading[] = [
      // Held: the Saturday of a weekly close, the round from Friday afternoon.
      read(NVDA, SATURDAY, BLOCK + 1n, stockRawRead(NVDA, 19_950_000_000n, SATURDAY - 65_000)),
      read(AMZN, WEDNESDAY, BLOCK, stockRawRead(AMZN, 0n, WEDNESDAY - 60)),
      read(NOFEED, WEDNESDAY, BLOCK),
      read(NVDA, WEDNESDAY, BLOCK + 2n, null, 'request failed: HTTP 429'),
      read(
        AMZN,
        WEDNESDAY,
        BLOCK + 1n,
        stockRawRead(AMZN, 22_000_000_000n, WEDNESDAY - 60, {
          oraclePaused: true,
          pausedOrdinals: [2, 0, 9],
        }),
      ),
      read(
        NVDA,
        WEDNESDAY,
        BLOCK + 3n,
        stockRawRead(NVDA, 19_950_000_000n, WEDNESDAY, {
          oracleMultiplierWad: null,
          oraclePaused: null,
          pausedOrdinals: null,
        }),
        'getOracleParams: reverted.',
      ),
    ]
    expect(readings.map((r) => r.referenceStatus)).toEqual([
      'held',
      'invalid',
      'no-feed',
      'unread',
      'paused',
      'unread',
    ])
    const paused = readings[4]
    expect([paused?.pausedFeatures, paused?.transfersPaused]).toEqual([['transfer', 'burn'], true])
    expect(db.stockReadings.insertMany(readings.map((r) => record(r, null)))).toBe(6)
    const stored = [NVDA, AMZN, NOFEED].flatMap((stock) =>
      db.stockReadings.seriesFor(stock.token.address, 0).map((row) => row.reading),
    )
    const byKey = (r: StockReading) => `${r.token}:${r.blockNumber}`
    expect(stored.sort((a, b) => byKey(a).localeCompare(byKey(b)))).toEqual(
      [...readings].sort((a, b) => byKey(a).localeCompare(byKey(b))),
    )
  })

  it('keeps one reading per stock and block, the first stored', () => {
    const first = read(NVDA, WEDNESDAY, BLOCK)
    expect(db.stockReadings.insert(record(first))).toBe(true)
    const copy = read(NVDA, WEDNESDAY, BLOCK, null, 'second writer')
    expect(db.stockReadings.insert(record(copy))).toBe(false)
    expect(
      db.stockReadings.insertMany([record(copy), record(read(NVDA, WEDNESDAY + 2, BLOCK + 10n))]),
    ).toBe(1)
    // Another stock at the same block is its own reading.
    expect(db.stockReadings.insert(record(read(AMZN, WEDNESDAY, BLOCK)))).toBe(true)
    expect(db.stockReadings.count()).toBe(3)
    expect(db.stockReadings.seriesFor(NVDA.token.address, 0)[0]?.reading).toEqual(first)
    expect(db.stockReadings.insertMany([])).toBe(0)
  })

  it('finds the newest reading by timestamp, then block, for one stock or many', () => {
    // Five blocks share a second since Denim: the later block of one second is the newer reading.
    const late = read(NVDA, WEDNESDAY, BLOCK + 4n)
    db.stockReadings.insertMany([
      record(read(NVDA, WEDNESDAY - 300, BLOCK + 99n)),
      record(late),
      record(read(NVDA, WEDNESDAY, BLOCK)),
      record(read(AMZN, WEDNESDAY - 600, BLOCK - 3_000n)),
    ])
    expect(db.stockReadings.latestFor(NVDA.token.address)).toEqual(late)
    expect(
      db.stockReadings.latestFor(NVDA.token.address.toUpperCase().replace('0X', '0x')),
    ).toEqual(late)
    expect(db.stockReadings.latestFor(NOFEED.token.address)).toBeUndefined()
    const many = db.stockReadings.latestForMany([
      NVDA.token.address,
      AMZN.token.address,
      NOFEED.token.address,
    ])
    expect([...many.keys()].sort()).toEqual([AMZN.token.address, NVDA.token.address].sort())
    expect(many.get(NVDA.token.address)).toEqual(late)
    expect(many.get(AMZN.token.address)?.blockNumber).toBe(BLOCK - 3_000n)
    expect(db.stockReadings.latestForMany([]).size).toBe(0)
  })

  it('lists a series between inclusive bounds, oldest first, with each pass depth', () => {
    const at = (offset: number, passDepth: StockPassDepth | null): StockReadingRecord =>
      record(read(NVDA, WEDNESDAY + offset, BLOCK + BigInt(offset)), passDepth)
    const rows = [at(0, DEPTH), at(600, NO_POOL), at(1_200, null), at(1_800, DEPTH)]
    db.stockReadings.insertMany([...rows].reverse())
    db.stockReadings.insert(record(read(AMZN, WEDNESDAY + 600, BLOCK)))
    expect(db.stockReadings.seriesFor(NVDA.token.address, WEDNESDAY)).toEqual(rows)
    expect(
      db.stockReadings.seriesFor(NVDA.token.address, WEDNESDAY + 600, WEDNESDAY + 1_200),
    ).toEqual(rows.slice(1, 3))
    expect(db.stockReadings.seriesFor(NVDA.token.address, WEDNESDAY + 601).length).toBe(2)
    expect(db.stockReadings.seriesFor(NVDA.token.address, WEDNESDAY + 1_801)).toEqual([])
    expect(NO_POOL).toMatchObject({ sidesKnownPools: 0, deviationNull: 'no-pool' })
  })

  it("finds a stock's newest reading through the (token, timestamp) index, never a full scan", () => {
    // The table is never pruned, so every lookup of the stock routes must stay an index search.
    const prepared: string[] = []
    const prepare = db.raw.prepare.bind(db.raw)
    db.raw.prepare = (sql: string) => {
      prepared.push(sql)
      return prepare(sql)
    }
    db.stockReadings.latestFor(NVDA.token.address)
    db.stockReadings.latestForMany([NVDA.token.address, AMZN.token.address])
    db.stockReadings.seriesFor(NVDA.token.address, WEDNESDAY, WEDNESDAY + 600)
    const reads = prepared.filter((sql) => sql.includes('FROM stock_readings'))
    expect(reads.length).toBeGreaterThan(0)
    for (const sql of reads) {
      const params = (sql.match(/\?/g) ?? []).map(() => NVDA.token.address)
      const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params)
        .map((row) => String(row.detail))
      expect(plan[0], sql).toMatch(
        /^SEARCH stock_readings USING INDEX stock_readings_token_timestamp/,
      )
      expect(plan.join(' '), sql).not.toMatch(/CO-ROUTINE|SCAN stock_readings/)
    }
  })
})
