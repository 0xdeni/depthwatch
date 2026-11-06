/**
 * `GET /api/stocks` and `GET /api/stocks/:token` (docs/design/stocks-api.md §1) over the seed with
 * stocks (`testing/stocks.ts`): the list order, each aggregate as docs/METRICS.md "Stock
 * aggregates" defines it, the detail's pool order, the newest reading, the errors, and the stock
 * pool's reference on `GET /api/pools/:id`.
 */
import { evaluateStockReading, makeStock, stockRawRead } from '@depthwatch/core'
import {
  type Database,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
  fixtureScore,
  fixtureSnapshot,
  IN_MEMORY,
  openDatabase,
} from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { API_CACHE_CONTROL } from '../caching.js'
import type { ErrorResponse, PoolDetail, StockDetail, StocksResponse } from '../dto.js'
import { MAX_LIMIT } from '../query.js'
import { SEED_BLOCK } from '../testing/constants.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'
import { type StockSeed, seedStocks } from '../testing/stocks.js'

async function json<T>(app: Hono, path: string, status = 200): Promise<T> {
  const res = await app.request(path)
  expect(res.status, path).toBe(status)
  return (await res.json()) as T
}

describe('stock routes on an empty database', () => {
  it('list no stock and know none', async () => {
    const db = openDatabase(IN_MEMORY)
    try {
      const app = createApp(db)
      expect(await json<StocksResponse>(app, '/api/stocks')).toEqual({ items: [] })
      const missing = `/api/stocks/${makeStock('NVDAc').token.address}`
      expect(await json<ErrorResponse>(app, missing, 404)).toEqual({ error: 'stock not found' })
    } finally {
      db.close()
    }
  })
})

describe("a stock's pools over more than one page of the score feed", () => {
  it('sums every scored pool, the thinnest past the first page included', async () => {
    const db = openDatabase(IN_MEMORY)
    try {
      const stock = makeStock('NVDAc')
      // MAX_LIMIT + 1 pools of WETH/NVDAc, each thinner than the one before: the last is alone on
      // the second page of `scores.topBy('depth', { token })`.
      const pools = Array.from({ length: MAX_LIMIT + 1 }, (_, i) =>
        fixturePool({ address: fixtureAddress(0x4000 + i), token1: stock.token }),
      )
      const depthOf = (i: number) => 1_000 * (MAX_LIMIT + 100 - i)
      db.tokens.upsertMany([FIXTURE_WETH, stock.token])
      db.pools.upsertMany(pools)
      db.snapshots.insertMany(
        pools.map((p, i) => fixtureSnapshot({ poolId: p.id, depth2Usd: depthOf(i) })),
      )
      db.scores.upsertMany(
        pools.map((p, i) => fixtureScore({ poolId: p.id, depth2Usd: depthOf(i) })),
      )
      db.stocks.replaceAll([stock], 1_700_000_000)
      const app = createApp(db)
      const body = await json<StockDetail>(app, `/api/stocks/${stock.token.address}`)
      const side = pools.reduce((total, _p, i) => total + depthOf(i) / 2, 0)
      expect(body).toMatchObject({
        poolCount: MAX_LIMIT + 1,
        sidesKnownPools: MAX_LIMIT + 1,
        depth2BuyUsd: side,
        depth2SellUsd: side,
      })
      expect(body.pools).toHaveLength(MAX_LIMIT + 1)
      expect(body.pools.at(-1)?.pool.pool.id).toBe(pools.at(-1)?.id)
      const { items } = await json<StocksResponse>(app, '/api/stocks')
      expect(items[0]).toMatchObject({ poolCount: MAX_LIMIT + 1, depth2BuyUsd: side })
    } finally {
      db.close()
    }
  })
})

describe('stock routes over the stock seed', () => {
  let db: Database
  let seed: Seed
  let stocks: StockSeed
  let app: Hono

  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    stocks = seedStocks(db, seed)
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  const detail = (address: string) => json<StockDetail>(app, `/api/stocks/${address}`)

  it('lists every stock by buy plus sell depth, unknown depth last, then by ticker', async () => {
    const { items } = await json<StocksResponse>(app, '/api/stocks')
    expect(items.map((s) => s.stock.ticker)).toEqual(['NVDA', 'AMZN', 'AAPL', 'COIN', 'TSLA'])
    expect(items.map((s) => s.updatedAt)).toEqual(Array(5).fill(seed.now))
    // Each row is the detail's summary, without its pools.
    for (const item of items) {
      const { pools: _pools, ...summary } = await detail(item.stock.token.address)
      expect(item).toEqual(summary)
    }
  })

  it("sums NVDAc's counted pools: the stale quote and the unpriced side stay out", async () => {
    const { pools: p } = stocks
    const { pools, ...nvda } = await detail(stocks.stocks.nvda.token.address)
    expect(nvda).toMatchObject({
      stock: {
        token: { ...stocks.stocks.nvda.token, label: 'NVDAc' },
        ticker: 'NVDA',
        feed: stocks.stocks.nvda.feed,
      },
      poolCount: 4,
      tvlUsd: 3_709_000,
      tvlKnownPools: 4,
      depth2BuyUsd: 300_000,
      depth2SellUsd: 300_000,
      sidesKnownPools: 2,
      // The stale pool's 25 bps does not count.
      spread10kBps: 30,
      spread10kPoolId: p.nvdaUsdcAeroSlip.id,
      volume24hUsd: 550_000,
      volumeKnownPools: 3,
      deepestPoolId: p.nvdaUsdcAeroSlip.id,
      withinTolerance: true,
      deviationNull: null,
    })
    expect(nvda.deviationBps).toBeCloseTo(25.06, 2)
    expect(nvda.venues).toEqual([
      venue('uniswap-v3', 90_000, 0.15, 100_000, 100_000 / 550_000),
      venue('aerodrome-slipstream', null, null, null, null),
      venue('aero-v2', null, null, 50_000, 50_000 / 550_000),
      venue('aero-slipstream', 510_000, 0.85, 400_000, 400_000 / 550_000),
    ])
    // Counted first, then the thinner side (the BRETT pool's is unknown), then the stale pool.
    expect(pools.map((row) => [row.pool.pool.id, row.counted])).toEqual([
      [p.nvdaUsdcAeroSlip.id, true],
      [p.nvdaWethV3.id, true],
      [p.nvdaBrettSlip.id, true],
      [p.nvdaUsdcStaleAeroV2.id, false],
    ])
    expect(pools.map((row) => [row.stockIs, row.depth2BuyUsd, row.depth2SellUsd])).toEqual([
      ['token1', 250_000, 260_000],
      ['token1', 50_000, 40_000],
      ['token1', null, 8_000],
      ['token1', 600_000, 600_000],
    ])
    for (const row of pools) expect(row.reference).toEqual(stocks.references.get(row.pool.pool.id))
    const [inside, outside, thin] = pools.map((row) => row.reference)
    expect(inside).toMatchObject({ toleranceBps: 55, withinTolerance: true })
    expect(outside?.deviationBps).toBeCloseTo(-125.31, 2)
    expect(outside).toMatchObject({ toleranceBps: 80, withinTolerance: false })
    expect(thin).toMatchObject({ deviationBps: null, deviationNull: 'thin' })
  })

  it('serves the newest reading, its bigints as decimal strings', async () => {
    const { reading } = await detail(stocks.stocks.nvda.token.address)
    expect(reading).toEqual({
      token: stocks.stocks.nvda.token.address,
      blockNumber: '20000000',
      timestamp: seed.now,
      referenceStatus: 'live',
      referenceUsd: 199.5,
      feedAgeSeconds: 1_800,
      feedRoundId: '1',
      feedAnswer: '19950000000',
      feedUpdatedAt: seed.now - 1_800,
      oracleMultiplierWad: '1000538000000000000',
      oraclePaused: false,
      tokenMultiplierWad: '1000538000000000000',
      pausedFeatures: [],
      transfersPaused: false,
      error: null,
    })
  })

  it('orients a stock that is token0, and breaks a tie of thinner sides by pool id', async () => {
    const { pools, reading, ...amzn } = await detail(stocks.stocks.amzn.token.address)
    const ids = [stocks.pools.amznUsdcAeroSlip.id, stocks.pools.amznUsdcV3.id]
    expect(ids[0]! < ids[1]!).toBe(true)
    expect(pools.map((row) => row.pool.pool.id)).toEqual(ids)
    expect(pools.map((row) => [row.stockIs, row.depth2BuyUsd, row.depth2SellUsd])).toEqual([
      ['token0', 30_000, 32_000],
      ['token0', 30_000, 32_000],
    ])
    // Held: Chainlink's answer is published with its age, and no pool is compared with it.
    expect(reading).toMatchObject({
      referenceStatus: 'held',
      referenceUsd: 220,
      feedAgeSeconds: 100_000,
    })
    expect(amzn).toMatchObject({
      depth2BuyUsd: 60_000,
      depth2SellUsd: 64_000,
      deepestPoolId: ids[0],
      deviationBps: null,
      withinTolerance: null,
      deviationNull: 'held',
    })
  })

  it('counts no pool of a stock whose transfers are paused', async () => {
    const { pools, ...tsla } = await detail(stocks.stocks.tsla.token.address)
    expect(tsla.reading).toMatchObject({ referenceStatus: 'live', transfersPaused: true })
    expect(tsla.reading?.pausedFeatures).toEqual(['transfer'])
    expect(tsla).toMatchObject({
      poolCount: 1,
      tvlUsd: 400_000,
      volume24hUsd: 20_000,
      depth2BuyUsd: null,
      depth2SellUsd: null,
      sidesKnownPools: 0,
      spread10kBps: null,
      deepestPoolId: null,
      deviationNull: 'no-pool',
    })
    expect(pools).toHaveLength(1)
    const [row] = pools
    expect(row).toMatchObject({ counted: false, depth2BuyUsd: 45_000, depth2SellUsd: 45_000 })
    expect(row?.pool.health).toMatchObject({ rated: false, unratedReason: 'transfers-paused' })
    // The pool keeps the deviation it measures, though no swap can use it.
    expect(row?.reference).toMatchObject({ transfersPaused: true, withinTolerance: true })
    expect(row?.reference?.deviationBps).toBeCloseTo(40.16, 2)
  })

  it('answers a stock with no pool, and a stock without a feed', async () => {
    const aapl = await detail(stocks.stocks.aapl.token.address)
    expect(aapl).toMatchObject({
      poolCount: 0,
      tvlUsd: null,
      volume24hUsd: null,
      venues: [],
      deepestPoolId: null,
      deviationNull: 'no-pool',
      pools: [],
    })
    expect(aapl.reading?.referenceStatus).toBe('live')
    const coin = await detail(stocks.stocks.coin.token.address)
    expect(coin.stock.feed).toBeNull()
    expect(coin.reading).toMatchObject({ referenceStatus: 'no-feed', referenceUsd: null })
  })

  it('serves a stock the list names before its first reading, with reading null', async () => {
    const extra = makeStock('MSFTc')
    db.stocks.replaceAll([...Object.values(stocks.stocks), extra], seed.now)
    const body = await detail(extra.token.address)
    expect(body).toMatchObject({ reading: null, poolCount: 0, pools: [] })
  })

  it("gives the deepest pool's deviation as unread when its snapshot has no reference", async () => {
    const pool = stocks.pools.nvdaUsdcAeroSlip
    const latest = db.snapshots.latestForPool(pool.id)
    if (!latest) throw new Error('the stock seed has no snapshot for the Slipstream pool')
    db.snapshots.insert({ ...latest, blockNumber: latest.blockNumber + 1n, reference: null })
    const { pools, ...nvda } = await detail(stocks.stocks.nvda.token.address)
    expect(nvda).toMatchObject({
      deepestPoolId: pool.id,
      deviationBps: null,
      deviationNull: 'unread',
    })
    expect(pools[0]).toMatchObject({ counted: true, reference: null })
  })

  it('counts no pool once a newer reading than their snapshots finds the transfers paused', async () => {
    const nvda = stocks.stocks.nvda
    const before = await detail(nvda.token.address)
    // The pass after the snapshots: their reads failed, the stock's read found TRANSFER paused.
    const paused = evaluateStockReading(
      nvda,
      stockRawRead(nvda, 19_950_000_000n, seed.now - 1_800, { pausedOrdinals: [0] }),
      { blockNumber: SEED_BLOCK + 300n, timestamp: seed.now + 600 },
    )
    db.stockReadings.insert({ reading: paused, passDepth: null })
    const { pools, ...after } = await detail(nvda.token.address)
    expect(after.reading).toMatchObject({ transfersPaused: true, blockNumber: '20000300' })
    // As METRICS.md says: depth, spread and deviation null (no-pool), TVL and volume unchanged.
    expect(after).toMatchObject({
      poolCount: before.poolCount,
      tvlUsd: before.tvlUsd,
      volume24hUsd: before.volume24hUsd,
      depth2BuyUsd: null,
      depth2SellUsd: null,
      sidesKnownPools: 0,
      spread10kBps: null,
      deepestPoolId: null,
      deviationBps: null,
      withinTolerance: null,
      deviationNull: 'no-pool',
    })
    expect(after.venues.map((v) => v.depth2Usd)).toEqual([null, null, null, null])
    expect(pools.map((row) => row.counted)).toEqual([false, false, false, false])
    // Each row keeps its snapshot's own reference, which was read before the pause.
    for (const row of pools) expect(row.reference).toEqual(stocks.references.get(row.pool.pool.id))
    const { items } = await json<StocksResponse>(app, '/api/stocks')
    const listed = items.find((s) => s.stock.token.address === nvda.token.address)
    expect(listed).toMatchObject({ depth2BuyUsd: null, deviationNull: 'no-pool' })

    // A still newer reading that finds them resumed counts the pools again.
    const resumed = evaluateStockReading(
      nvda,
      stockRawRead(nvda, 19_950_000_000n, seed.now - 1_800),
      { blockNumber: SEED_BLOCK + 600n, timestamp: seed.now + 1_200 },
    )
    db.stockReadings.insert({ reading: resumed, passDepth: null })
    const { pools: again, reading: _r, ...back } = await detail(nvda.token.address)
    const { pools: first, reading: _f, ...was } = before
    expect(back).toEqual(was)
    expect(again).toEqual(first)
  })

  it('takes an address in any case, refuses a malformed one and knows only listed stocks', async () => {
    const upper = stocks.stocks.nvda.token.address.toUpperCase().replace('0X', '0x')
    expect((await detail(upper)).stock.ticker).toBe('NVDA')
    const bad = { error: 'invalid token address: expected 0x + 40 hex chars' }
    expect(await json<ErrorResponse>(app, '/api/stocks/0x12', 400)).toEqual(bad)
    expect(await json<ErrorResponse>(app, '/api/stocks/NVDA', 400)).toEqual(bad)
    // WETH is a token of the database, not a stock of the list.
    const weth = `/api/stocks/${seed.tokens.WETH.address}`
    expect(await json<ErrorResponse>(app, weth, 404)).toEqual({ error: 'stock not found' })
  })

  it('carry the default Cache-Control', async () => {
    for (const path of ['/api/stocks', `/api/stocks/${stocks.stocks.nvda.token.address}`]) {
      const res = await app.request(path)
      expect(res.headers.get('cache-control'), path).toBe(API_CACHE_CONTROL)
    }
  })

  it("serves a stock pool's newest reference on GET /api/pools/:id", async () => {
    for (const pool of Object.values(stocks.pools)) {
      const body = await json<PoolDetail>(app, `/api/pools/${pool.id}`)
      expect(body.latest?.reference, pool.id).toEqual(stocks.references.get(pool.id))
    }
    const other = await json<PoolDetail>(app, `/api/pools/${seed.pools.wethUsdcV3.id}`)
    expect(other.latest?.reference).toBeNull()
  })
})

function venue(
  dex: string,
  depth2Usd: number | null,
  depthShare: number | null,
  volume24hUsd: number | null,
  volumeShare: number | null,
) {
  return { dex, poolCount: 1, depth2Usd, depthShare, volume24hUsd, volumeShare }
}
