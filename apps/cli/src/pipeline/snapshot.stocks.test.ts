/**
 * The snapshot step's stocks (docs/design/stocks.md §4, §6): over the synthetic Base world, with a
 * synthetic stock list in which cbBTC stands in for a stock (its pool cbBTC/USDC on Uniswap v3)
 * beside a stock without a pool, the reads go out in one multicall at the snapshot block and every
 * stock's reading is stored with its pass depth; a stock pool's snapshot carries its reference
 * (`held` and `paused` give no deviation); a failed read stores `unread` readings and the snapshot
 * succeeds; `pausedFeatures` [0] leaves the pool out of the pass depth and unrates it
 * (`transfers-paused`); the stock pool, ranked far above $10,000, is tracked whatever the top N
 * (`stockPoolIds`; the floor itself is tracking.test.ts's). On built Uniswap v4 pools
 * (stocks.test.ts): `thin`, and a quote priced through an untracked stock pool (`quote-unpriced`).
 */
import {
  addStockFixture,
  type ChainReader,
  createChainReader,
  createFixtureTransport,
  createSyntheticFixture,
  fakeAddress,
  type StockFeed,
  type StockFixtureSpec,
  type StockList,
  SYNTHETIC_DEFAULTS,
  SYNTHETIC_POOL_IDS,
  syntheticAddresses,
  TOKENS,
} from '@depthwatch/chain'
import { makeStock, type PoolMeta } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase, snapshotDepthSides } from '@depthwatch/db'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createDemoChain, DEMO_LOG_CHUNK_SIZE } from '../demo.js'
import { createLogger, silentLogger } from '../log.js'
import { createPipelineContext, type PipelineContext } from './context.js'
import { discoverStep } from './discover.js'
import { scoreStep } from './score.js'
import { snapshotStep } from './snapshot.js'
import { readStockPass } from './stocks.js'

const T = SYNTHETIC_DEFAULTS.latestTimestamp
const BLOCK = SYNTHETIC_DEFAULTS.latestBlock
const POOL = SYNTHETIC_POOL_IDS.cbbtcUsdcV3
const CBBTC = TOKENS.CBBTC
const LONELY = makeStock('NVDAc').token
const REGISTRY = fakeAddress('stocks:oracle-registry')
const feedOf = (ticker: string): StockFeed => ({
  feed: fakeAddress(`stocks:feed:${ticker}`),
  ticker,
  decimals: 8,
  heartbeatSeconds: 86_400,
  deviationThresholdBps: 50,
  hours: '24/5',
})
const STOCKS: StockList = {
  tokens: [CBBTC, LONELY],
  feeds: { [CBBTC.address]: feedOf('CBBTC'), [LONELY.address]: feedOf('NVDA') },
  oracleRegistry: REGISTRY,
}
/** $65,000, the synthetic world's cbBTC price, at the feed's 8 decimals. */
const ANSWER = 65_000n * 10n ** 8n

let POOLS: PoolMeta[] = []
const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

const chainOf = (fixture: ReturnType<typeof createSyntheticFixture>, stocks: StockList) =>
  createChainReader({
    transport: createFixtureTransport(fixture),
    addresses: syntheticAddresses(),
    logChunkSize: DEMO_LOG_CHUNK_SIZE,
    stocks,
  })

// The world's pools, discovered once; each case stores them in a fresh database.
beforeAll(async () => {
  const db = openDatabase(IN_MEMORY)
  try {
    const chain = chainOf(createSyntheticFixture(), STOCKS)
    await discoverStep(createPipelineContext({ db, chain, config: loadConfig({}), now: () => T }))
    POOLS = db.pools.list()
  } finally {
    db.close()
  }
}, 20_000)

/**
 * A fresh database holding the discovered pools, on the world whose cbBTC answers are `cbbtc`
 * (null: no stock answers at all, every read misses); the pool-less stock answers soundly.
 */
function world(
  cbbtc: Partial<StockFixtureSpec> | null,
  stocks: StockList = STOCKS,
): {
  db: Database
  ctx: PipelineContext
  lines: string[]
} {
  const fixture = createSyntheticFixture()
  if (cbbtc !== null) {
    const base = { block: BLOCK, oracleRegistry: REGISTRY }
    addStockFixture(fixture, {
      ...base,
      stock: CBBTC.address,
      feed: feedOf('CBBTC'),
      answer: ANSWER,
      updatedAt: T - 1_800,
      ...cbbtc,
    })
    addStockFixture(fixture, {
      ...base,
      stock: LONELY.address,
      feed: feedOf('NVDA'),
      answer: 19_950_000_000n,
      updatedAt: T - 600,
    })
  }
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  db.pools.upsertMany(POOLS)
  const lines: string[] = []
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const chain = chainOf(fixture, stocks)
  return {
    db,
    ctx: createPipelineContext({ db, chain, config: loadConfig({}), log, now: () => T }),
    lines,
  }
}

const latestReference = (db: Database) => db.snapshots.latestForPool(POOL)?.reference ?? null

describe('snapshotStep with stocks', () => {
  it('reads every stock at the block and stores its reading, the reference and the pass depth', async () => {
    const { db, ctx, lines } = world({})
    const result = await snapshotStep(ctx)
    expect(result).toMatchObject({ blockNumber: BLOCK, stockReadings: 2, failed: [] })
    expect(result.snapshots).toBe(POOLS.length)
    expect(db.stocks.list().map((s) => [s.ticker, s.token.address, s.feed?.address])).toEqual([
      ['CBBTC', CBBTC.address, feedOf('CBBTC').feed],
      ['NVDA', LONELY.address, feedOf('NVDA').feed],
    ])
    expect(db.stockReadings.latestFor(CBBTC.address)).toMatchObject({
      blockNumber: BLOCK,
      timestamp: T,
      referenceStatus: 'live',
      referenceUsd: 65_000,
      feedAgeSeconds: 1_800,
      pausedFeatures: [],
      transfersPaused: false,
      error: null,
    })

    const snapshot = db.snapshots.latestForPool(POOL)
    if (snapshot === undefined) throw new Error('no snapshot of the stock pool')
    const reference = snapshot.reference
    // USD per cbBTC at the pool's mid from the quote's price alone: USDC is token0 there.
    expect(reference?.poolUsd).toBeCloseTo((snapshot.token0Usd ?? 0) / snapshot.price, 6)
    expect(reference).toMatchObject({
      stock: CBBTC.address,
      referenceUsd: 65_000,
      referenceStatus: 'live',
      feedAgeSeconds: 1_800,
      toleranceBps: 50 + 3_000 / 100,
      deviationThresholdBps: 50,
      feeBps: 30,
      withinTolerance: true,
      deviationNull: null,
      transfersPaused: false,
    })
    expect(reference?.deviationBps).toBeCloseTo(((reference?.poolUsd ?? 0) / 65_000 - 1) * 1e4, 9)
    for (const pool of POOLS)
      if (pool.id !== POOL) expect(db.snapshots.latestForPool(pool.id)?.reference).toBeNull()

    // cbBTC is token1: its buy side is the pool's down level, its sell side the up level.
    const sides = snapshotDepthSides(snapshot)
    expect(db.stockReadings.seriesFor(CBBTC.address, 0)).toEqual([
      {
        reading: db.stockReadings.latestFor(CBBTC.address),
        passDepth: {
          depth2BuyUsd: sides.depth2DownUsd,
          depth2SellUsd: sides.depth2UpUsd,
          sidesKnownPools: 1,
          deepestPoolId: POOL,
          deviationBps: reference?.deviationBps,
          withinTolerance: true,
          deviationNull: null,
        },
      },
    ])
    // A stock without a pool is read all the same; its pass depth is that of no pool.
    expect(db.stockReadings.seriesFor(LONELY.address, 0)).toMatchObject([
      {
        reading: { referenceStatus: 'live', referenceUsd: 199.5, feedAgeSeconds: 600 },
        passDepth: { sidesKnownPools: 0, deepestPoolId: null, deviationNull: 'no-pool' },
      },
    ])
    expect(
      lines.some((l) => l.endsWith(`read stocks stocks=2 block=${BLOCK} statuses=live:2`)),
    ).toBe(true)

    // One reading per stock and block: a second pass at the block keeps the stored ones.
    expect(await snapshotStep(ctx)).toMatchObject({ stockReadings: 0, failed: [] })
    expect(db.stockReadings.count()).toBe(2)
  }, 20_000)

  it('tracks the stock pool whatever its rank, and no pool for a stock list without it', async () => {
    const { db, ctx, lines } = world({})
    // No top pool at all: the stock pool alone is tracked, as the stock list holds cbBTC.
    expect(await snapshotStep(ctx, { topPools: 0 })).toMatchObject({
      tracked: 1,
      snapshots: 1,
      stockReadings: 2,
      failed: [],
    })
    expect(db.pools.list({ tracked: true }).map((p) => p.id)).toEqual([POOL])
    expect(latestReference(db)).toMatchObject({ stock: CBBTC.address, deviationNull: null })
    expect(
      lines.some((l) =>
        l.endsWith('selected tracked pools tracked=1 top=0 explicit=0 mandated=0 stocks=1'),
      ),
    ).toBe(true)
    // Beside the top N: the stock pool ranks fourth, and is tracked beside the top three.
    expect(await snapshotStep(ctx, { topPools: 3 })).toMatchObject({ tracked: 4, failed: [] })
    expect(db.pools.list({ tracked: true }).map((p) => p.id)).toEqual(
      [
        SYNTHETIC_POOL_IDS.wethUsdcSlipstream,
        SYNTHETIC_POOL_IDS.wethUsdcAeroSlipstream,
        SYNTHETIC_POOL_IDS.wethUsdcV3,
        POOL,
      ].sort(),
    )

    // Without cbBTC on the stock list its pool is an ordinary pool: untracked at top 0.
    const lonely: StockList = {
      tokens: [LONELY],
      feeds: { [LONELY.address]: feedOf('NVDA') },
      oracleRegistry: REGISTRY,
    }
    const other = world({}, lonely)
    expect(await snapshotStep(other.ctx, { topPools: 0 })).toMatchObject({
      tracked: 0,
      snapshots: 0,
      stockReadings: 1,
    })
    expect(other.db.pools.list({ tracked: true })).toEqual([])
  }, 20_000)

  it.each([
    { status: 'held', answers: { updatedAt: T - 100_000 }, age: 100_000 },
    { status: 'paused', answers: { oraclePaused: true }, age: 1_800 },
  ] as const)(
    'a $status reading publishes its answer and no deviation',
    async (c) => {
      const { db, ctx } = world(c.answers)
      expect(await snapshotStep(ctx)).toMatchObject({ stockReadings: 2, failed: [] })
      expect(db.stockReadings.latestFor(CBBTC.address)).toMatchObject({
        referenceStatus: c.status,
        referenceUsd: 65_000,
        feedAgeSeconds: c.age,
      })
      expect(latestReference(db)).toMatchObject({
        referenceUsd: 65_000,
        referenceStatus: c.status,
        feedAgeSeconds: c.age,
        deviationBps: null,
        toleranceBps: null,
        withinTolerance: null,
        deviationNull: c.status,
      })
      expect(db.stockReadings.seriesFor(CBBTC.address, 0)[0]?.passDepth).toMatchObject({
        sidesKnownPools: 1,
        deepestPoolId: POOL,
        deviationBps: null,
        deviationNull: c.status,
      })
    },
    20_000,
  )

  it('stores unread readings when the stock read fails, and the snapshot succeeds', async () => {
    const { db, ctx, lines } = world(null)
    const result = await snapshotStep(ctx)
    expect(result).toMatchObject({ stockReadings: 2, failed: [] })
    expect(result.snapshots).toBe(POOLS.length)
    for (const token of [CBBTC.address, LONELY.address]) {
      const reading = db.stockReadings.latestFor(token)
      expect(reading).toMatchObject({ referenceStatus: 'unread', referenceUsd: null })
      expect(reading?.error).toContain('Fixture has no answer for eth_call')
    }
    expect(latestReference(db)).toMatchObject({
      referenceStatus: 'unread',
      deviationNull: 'unread',
    })
    expect(lines.some((l) => l.includes(`WARN  stock reads failed stocks=2 block=${BLOCK}`))).toBe(
      true,
    )
  }, 20_000)

  it('logs a failed call for its stock and judges the reading from the answers it has', async () => {
    const { db, ctx, lines } = world({ revert: ['getOracleParams'] })
    expect(await snapshotStep(ctx)).toMatchObject({ stockReadings: 2, failed: [] })
    expect(db.stockReadings.latestFor(CBBTC.address)).toMatchObject({
      referenceStatus: 'unread',
      error: expect.stringMatching(/^getOracleParams: reverted\./),
    })
    expect(db.stockReadings.latestFor(LONELY.address)?.referenceStatus).toBe('live')
    expect(
      lines.some((l) =>
        l.includes('WARN  stock calls failed stock=cbBTC error="getOracleParams: reverted."'),
      ),
    ).toBe(true)
  }, 20_000)

  it('a paused TRANSFER keeps the deviation, leaves the pass depth and unrates the pool', async () => {
    const { db, ctx } = world({ pausedOrdinals: [0] })
    await snapshotStep(ctx)
    expect(db.stockReadings.latestFor(CBBTC.address)).toMatchObject({
      referenceStatus: 'live',
      pausedFeatures: ['transfer'],
      transfersPaused: true,
    })
    const reference = latestReference(db)
    expect(reference).toMatchObject({ transfersPaused: true, deviationNull: null })
    expect(reference?.deviationBps).not.toBeNull()
    expect(db.stockReadings.seriesFor(CBBTC.address, 0)[0]?.passDepth).toEqual({
      depth2BuyUsd: null,
      depth2SellUsd: null,
      sidesKnownPools: 0,
      deepestPoolId: null,
      deviationBps: null,
      withinTolerance: null,
      deviationNull: 'no-pool',
    })
    await scoreStep(ctx)
    expect(db.scores.get(POOL)?.health).toMatchObject({
      rated: false,
      unratedReason: 'transfers-paused',
    })
    const other = db.scores.get(SYNTHETIC_POOL_IDS.wethUsdcV3)?.health
    expect(other?.unratedReason).not.toBe('transfers-paused')
  }, 20_000)
})

describe('readStockPass', () => {
  const at = { number: BLOCK, timestamp: T }
  const quiet = { log: silentLogger }

  it('sends no read for an empty stock list (the demo world)', async () => {
    const demo = createDemoChain()
    expect(demo.stocks.tokens).toEqual([])
    const chain: ChainReader = {
      ...demo,
      readStocks: () => Promise.reject(new Error('no read expected')),
    }
    expect(await readStockPass({ ...quiet, chain }, at)).toEqual({
      infos: [],
      readings: [],
      entries: new Map(),
    })
  })

  it('answers a reader that throws with unread readings, and rethrows a stop', async () => {
    const base = chainOf(createSyntheticFixture(), STOCKS)
    const chain: ChainReader = {
      ...base,
      readStocks: () => Promise.reject(new Error('gateway melted')),
    }
    const pass = await readStockPass({ ...quiet, chain }, at)
    expect(pass.readings.map((r) => [r.token, r.referenceStatus, r.error])).toEqual([
      [CBBTC.address, 'unread', 'gateway melted'],
      [LONELY.address, 'unread', 'gateway melted'],
    ])
    expect([...pass.entries.keys()]).toEqual([CBBTC.address, LONELY.address])
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(readStockPass({ ...quiet, chain, signal: controller.signal }, at)).rejects.toThrow(
      'stop',
    )
  })
})
