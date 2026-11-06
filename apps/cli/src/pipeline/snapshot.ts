/**
 * `snapshot`: one overview pass over every known pool → USD prices → TVL ranking → the top N
 * (plus explicitly requested pools, mandated pools and the stock pools ranked at $10,000 or more)
 * become *tracked* (tracking.ts) → full state per tracked pool → depth, effective spread and
 * concentration → one `snapshots` row per pool, written in one transaction together with the
 * rebuilt `prices` table.
 *
 * Stocks (stocks.ts, docs/design/stocks.md §4): every ranked pool holding a stock of the reader's
 * stock list with a rank of at least `STOCK_TRACK_MIN_RANK_USD` is tracked whatever its place
 * (`stockPoolIds`); the stock list is read at the same block beside the state reads, a stock
 * pool's snapshot carries its `reference` to its stock's reading, and the same transaction
 * rewrites the `stocks` table and stores one reading per stock with its pass depth. A failed stock
 * read stores `unread` readings and never fails the snapshot.
 *
 * Fees are read with the state, at the snapshot block: each snapshot stores the fee its depth and
 * spread used (`PoolSnapshot.feePips`), and every snapshotted pool's row gets that fee in the same
 * transaction (`pools.setFees`, the fee column alone, so a `discover --seed` that rewrote a pool's
 * `hooks` meanwhile is not undone), so the fee shown is the latest snapshot's. A state read that
 * finds an Aero pool's configuration changed (`PoolConfigChangedError`: fee module, swap hook,
 * initial fee) fails that pool like any other read, logged with its remedy (`poolConfigFix`); the
 * others are stored. A pool without a usable mid price (a zero reserve: an empty pool tracked
 * through `--pool` or a mandate) has no price to store: it is logged and skipped, not a failure.
 *
 * Uniswap v4 pools hold no reserves of their own (singleton PoolManager), so their TVL is unknown
 * (null) and they are ranked by the USD value of their ±2 % depth instead. A Uniswap v4 pool with a
 * hook is not modelled (docs/METRICS.md, `hooked`): it is not ranked (tracked only when requested
 * or mandated), its snapshot holds its price but no depth, spread or concentration, and it is no
 * price edge.
 *
 * Market-maker scorecards (docs/design/scorecards.md §5): pools with an active mandate are
 * always tracked, each gets one `MmSample` per active mandate right after its snapshot (same
 * state, prices and positions, stored in the same transaction), and webhook alerts are delivered
 * once the samples are stored. A mandate whose pool is unknown is logged and skipped; one whose
 * concentrated pool has no published positions yet is an attribution failure (mm.ts), not a
 * sample.
 *
 * Under `depthwatch start` the stop signal ends the state reads (no further pool starts) and
 * nothing is stored: a stop mid-snapshot leaves no partial snapshot in the history.
 */
import { isPoolConfigChangedError, type PoolOverview, poolConfigFix } from '@depthwatch/chain'
import {
  type Address,
  computeConcentration,
  computeConcentrationForReserves,
  computeDepth,
  computeEffectiveSpread,
  depthToUsd,
  isHookedPool,
  type MmSample,
  midPrice,
  type PoolMeta,
  type PoolSnapshot,
  type PoolState,
  type Position,
  priceDeviationBps,
} from '@depthwatch/core'
import type { PoolFee } from '@depthwatch/db'
import { errorMessage } from '../log.js'
import { type AlertsResult, deliverAlerts } from './alerts.js'
import { type PipelineContext, settleConcurrent, syncKeys, throwIfStopped } from './context.js'
import { activeMandatesByPool, sampleMandates, storedPositions } from './mm.js'
import { storedCustodians } from './positions.js'
import { computePrices, type PriceMap, priceEntries, usdOf } from './prices.js'
import { readStockPass, stockPoolsOf, stockReadingRecords, withReference } from './stocks.js'
import { mandatedPoolIds, poolTvlUsd, rankPools, selectTracked, stockPoolIds } from './tracking.js'

export interface SnapshotOptions {
  topPools?: number
  /** Pool ids to track regardless of rank. Unknown ids are an error. */
  poolIds?: readonly string[]
  bandPct?: number
  concurrency?: number
}

export interface SnapshotResult {
  blockNumber: bigint
  timestamp: number
  /** Pools in the database (all got an overview). */
  pools: number
  tracked: number
  /** Snapshots stored: a pool already snapshotted at the block keeps that row. */
  snapshots: number
  prices: number
  /**
   * Market-maker samples stored (one per active mandate of a snapshotted pool, unless the mandate
   * was already sampled at the block).
   */
  samples: number
  /** Mandates whose attribution failed (logged; the snapshot itself is unaffected). */
  sampleFailures: number
  /** Webhook alerts attempted after the samples were stored. */
  alerts: number
  /** Snapshotted pools whose stored fee changed to the one read at this block. */
  fees: number
  /** Tracked pools without a usable mid price (a zero reserve): logged, not snapshotted. */
  empty: number
  /** Stock readings stored: one per stock of the list, unless the stock was read at the block. */
  stockReadings: number
  failed: Array<{ item: string; error: string }>
}

/** Whether the state has a mid price to store: false for a pool with a zero reserve. */
export function hasUsableMid(pool: PoolMeta, state: PoolState): boolean {
  const price = midPrice(state, pool.token0.decimals, pool.token1.decimals)
  return Number.isFinite(price) && price > 0
}

/**
 * One pool's snapshot. `custodians` (a Slipstream gauge, as `positions` recorded it) hold positions
 * for depositors: their weight counts as uncovered in the owner concentration.
 */
export function buildSnapshot(
  pool: PoolMeta,
  view: PoolOverview,
  state: PoolState,
  prices: PriceMap,
  positions: Position[] | null,
  bandPct: number,
  custodians: readonly string[] = [],
): PoolSnapshot {
  const { token0, token1 } = pool
  const price = midPrice(state, token0.decimals, token1.decimals)
  if (!Number.isFinite(price) || price <= 0) throw new Error('pool has no usable mid price')
  const token0Usd = usdOf(prices, token0.address)
  const token1Usd = usdOf(prices, token1.address)
  const base = {
    poolId: pool.id,
    blockNumber: state.blockNumber,
    timestamp: state.timestamp,
    price,
    token0Usd,
    token1Usd,
    tvlUsd: poolTvlUsd(view, prices),
    activeLiquidity: state.kind === 'concentrated' ? state.liquidity : 0n,
    priceDeviationBps: priceDeviationBps(price, token0Usd, token1Usd),
    feePips: state.feePips,
    reference: null,
  }
  // The swap walk does not run a hook's code: no number is guessed for a hooked pool.
  if (isHookedPool(pool))
    return { ...base, depth: [], depthUsd: [], spreads: [], concentration: null }
  const depth = computeDepth(state, token0.decimals, token1.decimals)
  return {
    ...base,
    depth,
    depthUsd: depthToUsd(depth, token0, token1, token0Usd, token1Usd),
    spreads: computeEffectiveSpread(state, token0, token1, token0Usd, token1Usd),
    concentration:
      state.kind === 'concentrated'
        ? computeConcentration(state, positions, bandPct, custodians)
        : computeConcentrationForReserves(state, bandPct),
  }
}

export async function snapshotStep(
  ctx: PipelineContext,
  opts: SnapshotOptions = {},
): Promise<SnapshotResult> {
  const { db, chain, log, config } = ctx
  const topPools = opts.topPools ?? config.topPools
  const explicit = opts.poolIds ?? config.poolIds
  const bandPct = opts.bandPct ?? config.bandPct
  const concurrency = opts.concurrency ?? config.concurrency

  const latest = await chain.getLatestBlock()
  const pools = db.pools.list()
  const result: SnapshotResult = {
    blockNumber: latest.number,
    timestamp: latest.timestamp,
    pools: pools.length,
    tracked: 0,
    snapshots: 0,
    prices: 0,
    samples: 0,
    sampleFailures: 0,
    alerts: 0,
    fees: 0,
    empty: 0,
    stockReadings: 0,
    failed: [],
  }
  if (pools.length === 0) {
    log.warn('no pools in the database; run discover first')
    return result
  }
  const activeMandates = db.mandates.list({ active: true })
  const mandated = mandatedPoolIds(activeMandates, new Set(pools.map((p) => p.id)), log)

  log.info('reading overviews', { pools: pools.length, block: latest.number })
  const views = await chain.readOverview(pools, latest.number)
  const anchors = chain.addresses.stablecoinAnchors
  const wrappedNative: Address = chain.addresses.wrappedNative
  const firstPass = computePrices(views, anchors, { wrappedNative })
  log.info('derived prices from overviews', { tokens: firstPass.size })

  const ranked = rankPools(views, firstPass)
  const stockTokens = chain.stocks.tokens.map((t) => t.address)
  const stockIds = stockPoolIds(ranked, stockTokens)
  const trackedIds = selectTracked(ranked, topPools, [...explicit, ...mandated, ...stockIds])
  const trackedSet = new Set(trackedIds)
  db.transaction(() => {
    db.pools.setTracked(
      pools.map((p) => p.id),
      false,
    )
    db.pools.setTracked(trackedIds, true)
  })
  result.tracked = trackedIds.length
  log.info('selected tracked pools', {
    tracked: trackedIds.length,
    top: topPools,
    explicit: explicit.length,
    mandated: mandated.length,
    stocks: stockIds.length,
  })

  const viewById = new Map(views.map((view) => [view.pool.id, view]))
  const trackedPools = pools.filter((p) => trackedSet.has(p.id))
  const [states, stockPass] = await Promise.all([
    settleConcurrent(
      trackedPools,
      concurrency,
      (pool) => pool.id,
      async (pool) => ({
        pool,
        state: await chain.readState(pool, { bandPct, blockNumber: latest.number }),
      }),
      ctx.signal,
    ),
    readStockPass(ctx, latest),
  ])
  for (const failure of states.failed) {
    const error = errorMessage(failure.error)
    result.failed.push({ item: failure.item, error })
    if (isPoolConfigChangedError(failure.error))
      log.warn('pool configuration changed; not snapshotted', {
        pool: failure.item,
        error,
        fix: poolConfigFix(failure.error.change),
      })
    else log.warn('readState failed', { pool: failure.item, error })
  }
  const stateMap = new Map(states.ok.map((entry) => [entry.pool.id, entry.state]))
  const prices = computePrices(views, anchors, { states: stateMap, wrappedNative })
  const stockPools = stockPoolsOf(views, stockPass.entries)
  const references = { stocks: stockPass.entries, prices, stockPools }

  const mandatesByPool = activeMandatesByPool(db, mandated)
  const snapshots: PoolSnapshot[] = []
  const samples: MmSample[] = []
  const fees: PoolFee[] = []
  for (const { pool, state } of states.ok) {
    const view = viewById.get(pool.id)
    if (view === undefined) continue
    if (!hasUsableMid(pool, state)) {
      result.empty++
      log.info('empty pool, not snapshotted', { pool: pool.id })
      continue
    }
    const positions = storedPositions(db, pool)
    const custodians = storedCustodians(db, pool.id)
    try {
      const snapshot = buildSnapshot(pool, view, state, prices, positions, bandPct, custodians)
      snapshots.push(withReference(snapshot, pool, references))
      fees.push({ id: pool.id, feePips: state.feePips })
    } catch (error) {
      const message = errorMessage(error)
      result.failed.push({ item: pool.id, error: message })
      log.warn('metrics failed', { pool: pool.id, error: message })
      continue
    }
    const mandates = mandatesByPool.get(pool.id)
    if (mandates === undefined) continue
    samples.push(
      ...(await sampleMandates(ctx, {
        pool,
        state,
        prices,
        positions,
        blockNumber: state.blockNumber,
        timestamp: state.timestamp,
        mandates,
        onFailure: () => {
          result.sampleFailures++
        },
      })),
    )
  }

  throwIfStopped(ctx)
  const entries = priceEntries(prices)
  const readings = stockReadingRecords(
    stockPass.readings,
    snapshots,
    new Map(trackedPools.map((p) => [p.id, p])),
  )
  db.transaction(() => {
    result.snapshots = db.snapshots.insertMany(snapshots)
    result.fees = db.pools.setFees(fees)
    result.samples = db.mmSamples.insertMany(samples)
    db.prices.replaceAll(entries, latest.timestamp)
    db.stocks.replaceAll(stockPass.infos, latest.timestamp)
    result.stockReadings = db.stockReadings.insertMany(readings)
    db.syncState.setBigInt(syncKeys.snapshot(), latest.number)
  })
  result.prices = entries.length
  log.info('stored snapshots', {
    snapshots: result.snapshots,
    samples: result.samples,
    sampleFailures: result.sampleFailures,
    prices: entries.length,
    fees: result.fees,
    empty: result.empty,
    stockReadings: result.stockReadings,
    failed: result.failed.length,
    block: latest.number,
  })
  if (samples.length > 0) {
    const sampled = new Set(samples.map((s) => s.mandateId))
    const alerts: AlertsResult = await deliverAlerts(
      ctx,
      activeMandates.filter((m) => sampled.has(m.id)),
    )
    result.alerts = alerts.attempts
  }
  return result
}
