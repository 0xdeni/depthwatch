/**
 * Tokenized stocks beside the seed (`seed.ts`, which stays as it is), as `aero.ts` adds the Aero
 * venues: a synthetic stock list of five stocks, their readings judged by core
 * (`evaluateStockReading`) and seven stock pools, each with two snapshots, the newest carrying the
 * reference core's `poolReference` computes from it (the older one none, as before schema 8), and
 * a score. Numbers follow docs/METRICS.md's examples where they can.
 *
 * - NVDAc (live, $199.50, 1,800 s old): an Aero Slipstream USDC pool at +25.06 bps, within its
 *   55; a Uniswap v3 WETH pool at −125.31 bps, outside its 80; an Aerodrome Slipstream BRETT pool
 *   whose buy side has no USD value (`thin`, unrated `unpriced`); and an Aero v2 USDC pool, the
 *   deepest of all, whose quote is stale, so it counts in no sum.
 * - AMZNc (held: its round is 100,000 s old), token0 of two USDC pools with the same sides, so
 *   the pool id breaks the tie.
 * - TSLAc (live, transfers paused): one Aerodrome Slipstream USDC pool, unrated
 *   `transfers-paused`, so no pool counts.
 * - AAPLc (live) and COINc (no feed, `no-feed`): no pool.
 */
import {
  type Address,
  evaluateStockReading,
  makeStock,
  type PoolMeta,
  type PoolReference,
  type PoolSnapshot,
  poolReference,
  type StockEntry,
  type StockInfo,
  type StockReading,
  stockRawRead,
  type UnratedReason,
} from '@depthwatch/core'
import { type Database, fixtureAddress, fixturePool, fixtureScore } from '@depthwatch/db'
import { buildSnapshot } from './builders.js'
import { HOUR, SEED_BLOCK } from './constants.js'
import type { Seed } from './seed.js'
import { blockAt } from './timeline.js'

const NVDA_MULTIPLIER_WAD = 1_000_538_000_000_000_000n

export interface StockSeed {
  stocks: { nvda: StockInfo; amzn: StockInfo; tsla: StockInfo; aapl: StockInfo; coin: StockInfo }
  pools: {
    nvdaUsdcAeroSlip: PoolMeta
    nvdaWethV3: PoolMeta
    nvdaBrettSlip: PoolMeta
    nvdaUsdcStaleAeroV2: PoolMeta
    amznUsdcV3: PoolMeta
    amznUsdcAeroSlip: PoolMeta
    tslaUsdcSlip: PoolMeta
  }
  /** The newest reading of each stock, by lowercase address. */
  readings: Map<Address, StockReading>
  /** The newest snapshot's reference of each stock pool, by pool id. */
  references: Map<string, PoolReference>
}

interface StockPoolSpec {
  pool: PoolMeta
  price: number
  token0Usd: number | null
  token1Usd: number | null
  /** The pool's own ±2 % levels in USD (token1 per token0): up is token1 in, down token0 in. */
  upUsd: number | null
  downUsd: number | null
  tvlUsd: number | null
  spread10kBps: number | null
  volume24hUsd: number | null
  healthTotal: number
  unratedReason?: UnratedReason
}

function stockList(): StockSeed['stocks'] {
  return {
    nvda: makeStock('NVDAc'),
    // Below every quote's address, so the stock is token0 of its pools.
    amzn: makeStock('AMZNc', { address: fixtureAddress(0xb2_0a3a) }),
    tsla: makeStock('TSLAc'),
    aapl: makeStock('AAPLc'),
    coin: makeStock('COINc', { feed: null }),
  }
}

function readingsAt(now: number, s: StockSeed['stocks']): StockReading[] {
  const block = { blockNumber: SEED_BLOCK, timestamp: now }
  const nvda = { oracleMultiplierWad: NVDA_MULTIPLIER_WAD, tokenMultiplierWad: NVDA_MULTIPLIER_WAD }
  return [
    evaluateStockReading(s.nvda, stockRawRead(s.nvda, 19_950_000_000n, now - 1_800, nvda), block),
    evaluateStockReading(s.amzn, stockRawRead(s.amzn, 22_000_000_000n, now - 100_000), block),
    evaluateStockReading(
      s.tsla,
      stockRawRead(s.tsla, 24_900_000_000n, now - 600, { pausedOrdinals: [0] }),
      block,
    ),
    evaluateStockReading(s.aapl, stockRawRead(s.aapl, 27_000_000_000n, now - 3_600), block),
    evaluateStockReading(s.coin, null, block),
  ]
}

function stockPools(seed: Seed, s: StockSeed['stocks']): StockSeed['pools'] {
  const { USDC, WETH, BRETT } = seed.tokens
  const pool = (n: number, meta: Partial<PoolMeta>) =>
    fixturePool({ address: fixtureAddress(0x3000 + n), createdAtBlock: 19_000_000n, ...meta })
  const slip = { feePips: 500, tickSpacing: 50 }
  return {
    nvdaUsdcAeroSlip: pool(1, {
      dex: 'aero-slipstream',
      token0: USDC,
      token1: s.nvda.token,
      ...slip,
    }),
    nvdaWethV3: pool(2, { token0: WETH, token1: s.nvda.token, feePips: 3000, tickSpacing: 60 }),
    nvdaBrettSlip: pool(3, {
      dex: 'aerodrome-slipstream',
      token0: BRETT,
      token1: s.nvda.token,
      feePips: 1000,
      tickSpacing: 100,
    }),
    nvdaUsdcStaleAeroV2: pool(4, {
      dex: 'aero-v2',
      kind: 'constant-product',
      token0: USDC,
      token1: s.nvda.token,
      feePips: 3000,
      tickSpacing: null,
    }),
    amznUsdcV3: pool(5, { token0: s.amzn.token, token1: USDC, feePips: 500, tickSpacing: 10 }),
    amznUsdcAeroSlip: pool(6, {
      dex: 'aero-slipstream',
      token0: s.amzn.token,
      token1: USDC,
      ...slip,
    }),
    tslaUsdcSlip: pool(7, {
      dex: 'aerodrome-slipstream',
      token0: USDC,
      token1: s.tsla.token,
      ...slip,
    }),
  }
}

function poolSpecs(p: StockSeed['pools']): StockPoolSpec[] {
  const amzn = { price: 221.1, token0Usd: 221.1, token1Usd: 1, upUsd: 30_000, downUsd: 32_000 }
  const amznRest = { tvlUsd: 300_000, spread10kBps: 40, volume24hUsd: 60_000, healthTotal: 64 }
  return [
    // poolUsd = 1 / 0.005 = $200.00 against $199.50: +25.06 bps (docs/METRICS.md's example).
    {
      pool: p.nvdaUsdcAeroSlip,
      price: 0.005,
      token0Usd: 1,
      token1Usd: 200,
      upUsd: 260_000,
      downUsd: 250_000,
      tvlUsd: 1_500_000,
      spread10kBps: 30,
      volume24hUsd: 400_000,
      healthTotal: 84,
    },
    // poolUsd = 3,000.25 / price = $197.00: −125.31 bps.
    {
      pool: p.nvdaWethV3,
      price: 3000.25 / 197,
      token0Usd: 3000.25,
      token1Usd: 200,
      upUsd: 40_000,
      downUsd: 50_000,
      tvlUsd: 200_000,
      spread10kBps: 120,
      volume24hUsd: 100_000,
      healthTotal: 66,
    },
    {
      pool: p.nvdaBrettSlip,
      price: 0.0005,
      token0Usd: null,
      token1Usd: 200,
      upUsd: 8_000,
      downUsd: null,
      tvlUsd: 9_000,
      spread10kBps: null,
      volume24hUsd: null,
      healthTotal: 20,
      unratedReason: 'unpriced',
    },
    // 0.006 NVDAc per USDC against the 0.005 its USD prices imply: a stale quote (2,000 bps).
    {
      pool: p.nvdaUsdcStaleAeroV2,
      price: 0.006,
      token0Usd: 1,
      token1Usd: 200,
      upUsd: 600_000,
      downUsd: 600_000,
      tvlUsd: 2_000_000,
      spread10kBps: 25,
      volume24hUsd: 50_000,
      healthTotal: 61,
    },
    { pool: p.amznUsdcV3, ...amzn, ...amznRest },
    { pool: p.amznUsdcAeroSlip, ...amzn, ...amznRest },
    // poolUsd = 1 / 0.004 = $250.00 against $249.00: +40.16 bps, kept though no swap can use it.
    {
      pool: p.tslaUsdcSlip,
      price: 0.004,
      token0Usd: 1,
      token1Usd: 250,
      upUsd: 45_000,
      downUsd: 45_000,
      tvlUsd: 400_000,
      spread10kBps: 35,
      volume24hUsd: 20_000,
      healthTotal: 70,
      unratedReason: 'transfers-paused',
    },
  ]
}

const sum = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b

/** A snapshot of `spec` at `timestamp` whose ±1/2/5 % USD levels are the spec's sides scaled. */
function snapshotOf(spec: StockPoolSpec, now: number, timestamp: number): PoolSnapshot {
  const built = buildSnapshot({
    ...spec,
    timestamp,
    blockNumber: blockAt(now, timestamp),
    decimals0: spec.pool.token0.decimals,
    decimals1: spec.pool.token1.decimals,
    depth2Usd: sum(spec.upUsd, spec.downUsd),
    ownerTop1Share: null,
  })
  const depthUsd = built.depthUsd.map(({ pct }) => {
    const upUsd = spec.upUsd === null ? null : (spec.upUsd * pct) / 2
    const downUsd = spec.downUsd === null ? null : (spec.downUsd * pct) / 2
    return { pct, upUsd, downUsd, totalUsd: sum(upUsd, downUsd) }
  })
  return { ...built, depthUsd }
}

/** Adds the stock list, the readings and the stock pools to a seeded database (`seedDatabase`). */
export function seedStocks(db: Database, seed: Seed): StockSeed {
  const now = seed.now
  const stocks = stockList()
  const pools = stockPools(seed, stocks)
  const readings = readingsAt(now, stocks)
  const entries = new Map<Address, StockEntry>(
    Object.values(stocks).map((info, i) => [info.token.address, { info, reading: readings[i]! }]),
  )
  const references = new Map<string, PoolReference>()
  const snapshots: PoolSnapshot[] = []
  for (const spec of poolSpecs(pools)) {
    const latest = snapshotOf(spec, now, now)
    const reference = poolReference({
      pool: spec.pool,
      price: spec.price,
      token0Usd: spec.token0Usd,
      token1Usd: spec.token1Usd,
      depth2UpUsd: spec.upUsd,
      depth2DownUsd: spec.downUsd,
      feePips: spec.pool.feePips,
      quoteIndependent: true,
      stocks: entries,
    })
    if (reference === null) throw new Error(`seedStocks: ${spec.pool.id} holds no stock`)
    references.set(spec.pool.id, reference)
    snapshots.push(snapshotOf(spec, now, now - HOUR), { ...latest, reference })
  }
  const earlier = evaluateStockReading(
    stocks.nvda,
    stockRawRead(stocks.nvda, 19_900_000_000n, now - 5_400),
    { blockNumber: blockAt(now, now - HOUR), timestamp: now - HOUR },
  )
  db.transaction(() => {
    db.tokens.upsertMany(Object.values(stocks).map((s) => s.token))
    db.pools.upsertMany(Object.values(pools))
    db.pools.setTracked(
      Object.values(pools).map((p) => p.id),
      true,
    )
    db.snapshots.insertMany(snapshots)
    for (const spec of poolSpecs(pools)) {
      db.scores.upsert(
        fixtureScore({
          poolId: spec.pool.id,
          timestamp: now,
          healthTotal: spec.healthTotal,
          unratedReason: spec.unratedReason ?? null,
          depth2Usd: sum(spec.upUsd, spec.downUsd),
          volume24hUsd: spec.volume24hUsd,
        }),
      )
    }
    db.stocks.replaceAll(Object.values(stocks), now)
    db.stockReadings.insertMany(
      [earlier, ...readings].map((reading) => ({ reading, passDepth: null })),
    )
  })
  return {
    stocks,
    pools,
    readings: new Map(readings.map((reading) => [reading.token, reading])),
    references,
  }
}
