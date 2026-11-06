import {
  BIGINT_KEYS,
  type ConcentrationMetrics,
  type DepthLevel,
  type DepthLevelUsd,
  jsonStringify,
  type PoolReference,
  type PoolSnapshot,
  reviveBigints,
  type SpreadPoint,
} from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import {
  colBigint,
  colJsonOrNull,
  colNumber,
  colNumberOrNull,
  colText,
  colTextOrNull,
  jsonList,
  type Row,
} from '../sql.js'
import {
  capSpreadPoint,
  type SnapshotHealthSummary,
  type SnapshotSummary,
  SPREAD10K_SQL_FUNCTION,
  SUMMARY_DEPTH_PCT,
  SUMMARY_SPREAD_NOTIONAL_USD,
  snapshotSummaryFields,
  spread10kFromStoredPoint,
} from '../summary.js'

const COLUMNS = `id, pool_id, block_number, timestamp, price, token0_usd, token1_usd, tvl_usd,
  active_liquidity, depth_json, depth_usd_json, spreads_json, concentration_json,
  depth2_usd, spread10k_bps, owner_top1_share, price_deviation_bps, fee_pips, reference_json`

const SUMMARY_COLUMNS = `id, pool_id, block_number, timestamp, price, tvl_usd,
  depth2_usd, owner_top1_share, price_deviation_bps`

/**
 * SQL for one side of a snapshot's ±2 % USD level, read from its `depth_usd_json` ladder: NULL
 * when that side is unpriced or the ladder has no ±2 % level. `ladder` is a fixed column
 * reference written by this package, never user input.
 */
export function depth2SideSql(ladder: string, side: 'upUsd' | 'downUsd'): string {
  return `(SELECT json_extract(d.value, '$.${side}') FROM json_each(${ladder}) AS d
    WHERE json_extract(d.value, '$.pct') = ${SUMMARY_DEPTH_PCT} LIMIT 1)`
}

/**
 * SQL for a snapshot's $10,000 spread point as JSON text, NULL when it has none. The stored
 * `spread10k_bps` column is not read: a row inserted before the price impact cap holds the
 * uncapped number, so the point goes through core's rule in JS (`spread10kFromStoredPoint`).
 * `spreads` is a fixed column reference written by this package, never user input.
 */
export function spread10kPointSql(spreads: string): string {
  return `(SELECT d.value FROM json_each(${spreads}) AS d
    WHERE json_extract(d.value, '$.notionalUsd') = ${SUMMARY_SPREAD_NOTIONAL_USD} LIMIT 1)`
}

/**
 * SQL for a snapshot's $10,000 spread in bps under core's price impact cap, NULL when it has no
 * such point or the point is infeasible: the stored point through `dw_spread10k_bps`, the same
 * rule `spread10kFromStoredPoint` applies in JS. `spreads` and `price` are fixed column references
 * written by this package, never user input.
 */
export function spread10kSql(spreads: string, price: string): string {
  return `${SPREAD10K_SQL_FUNCTION}(${spread10kPointSql(spreads)}, ${price})`
}

/** The summary columns of the newest-row query: the ±2 % sides and the $10k point come from JSON. */
const SUMMARY_OUTER = `${SUMMARY_COLUMNS},
  ${depth2SideSql('depth_usd_json', 'upUsd')} AS depth2_up_usd,
  ${depth2SideSql('depth_usd_json', 'downUsd')} AS depth2_down_usd,
  ${spread10kPointSql('spreads_json')} AS spread10k_point`

/**
 * The summary columns plus the range HHI and owner coverage (what a history series is scored
 * from) and the fee the snapshot used.
 */
const HEALTH_SUMMARY = `${SUMMARY_OUTER}, fee_pips,
  json_extract(concentration_json, '$.rangeHhi') AS range_hhi,
  json_extract(concentration_json, '$.owners.coverage') AS owner_coverage`

/** One snapshot per pool and block (unique index, schema version 3): a stored one is kept. */
const INSERT = `INSERT OR IGNORE INTO snapshots (
    pool_id, block_number, timestamp, price, token0_usd, token1_usd, tvl_usd, active_liquidity,
    depth_json, depth_usd_json, spreads_json, concentration_json,
    depth2_usd, spread10k_bps, owner_top1_share, price_deviation_bps, fee_pips, reference_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/**
 * Newest row per pool: highest timestamp, then highest id (insertion order) as the tie-break.
 * `outer` selects from the newest rows only (defaults to `columns`).
 */
const LATEST_PER_POOL = (columns: string, outer = columns) => `SELECT ${outer} FROM (
    SELECT ${columns}, ROW_NUMBER() OVER (PARTITION BY pool_id ORDER BY timestamp DESC, id DESC) AS rn
    FROM snapshots WHERE pool_id IN (SELECT value FROM json_each(?))
  ) WHERE rn = 1 ORDER BY pool_id`

export function rowToSnapshot(row: Row): PoolSnapshot {
  const price = colNumber(row, 'price')
  return {
    poolId: colText(row, 'pool_id'),
    blockNumber: colBigint(row, 'block_number'),
    timestamp: colNumber(row, 'timestamp'),
    price,
    token0Usd: colNumberOrNull(row, 'token0_usd'),
    token1Usd: colNumberOrNull(row, 'token1_usd'),
    tvlUsd: colNumberOrNull(row, 'tvl_usd'),
    activeLiquidity: colBigint(row, 'active_liquidity'),
    depth: reviveBigints<DepthLevel[]>(JSON.parse(colText(row, 'depth_json')), BIGINT_KEYS),
    depthUsd: JSON.parse(colText(row, 'depth_usd_json')) as DepthLevelUsd[],
    // Under today's price impact cap: a point stored before it reads as infeasible.
    spreads: (JSON.parse(colText(row, 'spreads_json')) as SpreadPoint[]).map((point) =>
      capSpreadPoint(point, price),
    ),
    concentration: withOwnerCoverage(
      colJsonOrNull<ConcentrationMetrics>(row, 'concentration_json'),
    ),
    priceDeviationBps: colNumberOrNull(row, 'price_deviation_bps'),
    feePips: colNumberOrNull(row, 'fee_pips'),
    reference: colJsonOrNull<PoolReference>(row, 'reference_json'),
  }
}

/**
 * A stored concentration as the current type: owners stored before `coverage` was recorded read
 * `coverage: null` (unknown), never a missing field.
 */
export function withOwnerCoverage(
  concentration: ConcentrationMetrics | null,
): ConcentrationMetrics | null {
  const owners = concentration?.owners
  // Typed as always present: the JSON of a row stored before it has no `coverage` key at all.
  if (!concentration || !owners || owners.coverage !== undefined) return concentration
  return { ...concentration, owners: { ...owners, coverage: null } }
}

export function rowToSnapshotSummary(row: Row): SnapshotSummary {
  const price = colNumber(row, 'price')
  return {
    poolId: colText(row, 'pool_id'),
    blockNumber: colBigint(row, 'block_number'),
    updatedAt: colNumber(row, 'timestamp'),
    price,
    tvlUsd: colNumberOrNull(row, 'tvl_usd'),
    depth2Usd: colNumberOrNull(row, 'depth2_usd'),
    spread10kBps: spread10kFromStoredPoint(colTextOrNull(row, 'spread10k_point'), price),
    ownerTop1Share: colNumberOrNull(row, 'owner_top1_share'),
    depth2UpUsd: colNumberOrNull(row, 'depth2_up_usd'),
    depth2DownUsd: colNumberOrNull(row, 'depth2_down_usd'),
    priceDeviationBps: colNumberOrNull(row, 'price_deviation_bps'),
  }
}

export function rowToSnapshotHealthSummary(row: Row): SnapshotHealthSummary {
  return {
    ...rowToSnapshotSummary(row),
    rangeHhi: colNumberOrNull(row, 'range_hhi'),
    ownerCoverage: colNumberOrNull(row, 'owner_coverage'),
    feePips: colNumberOrNull(row, 'fee_pips'),
  }
}

export class SnapshotsRepo {
  constructor(private readonly ctx: SqlContext) {}

  /**
   * Appends one snapshot and returns its row id, or null when the pool already has a snapshot at
   * that block (a second writer's copy), which is kept as it is.
   */
  insert(snapshot: PoolSnapshot): number | null {
    const summary = snapshotSummaryFields(snapshot)
    const { changes, lastInsertRowid } = this.ctx.run(INSERT, [
      snapshot.poolId,
      snapshot.blockNumber,
      snapshot.timestamp,
      snapshot.price,
      snapshot.token0Usd,
      snapshot.token1Usd,
      snapshot.tvlUsd,
      snapshot.activeLiquidity,
      jsonStringify(snapshot.depth),
      JSON.stringify(snapshot.depthUsd),
      JSON.stringify(snapshot.spreads),
      snapshot.concentration === null ? null : JSON.stringify(snapshot.concentration),
      summary.depth2Usd,
      summary.spread10kBps,
      summary.ownerTop1Share,
      snapshot.priceDeviationBps,
      snapshot.feePips,
      // A PoolReference holds no bigint.
      snapshot.reference === null ? null : JSON.stringify(snapshot.reference),
    ])
    return changes === 0 ? null : lastInsertRowid
  }

  /** Inserts every snapshot in one transaction; returns how many were stored (see `insert`). */
  insertMany(snapshots: readonly PoolSnapshot[]): number {
    if (snapshots.length === 0) return 0
    return this.ctx.transaction(
      () => snapshots.filter((snapshot) => this.insert(snapshot) !== null).length,
    )
  }

  latestForPool(poolId: string): PoolSnapshot | undefined {
    const row = this.ctx.get(
      `SELECT ${COLUMNS} FROM snapshots WHERE pool_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1`,
      [poolId],
    )
    return row ? rowToSnapshot(row) : undefined
  }

  /** The newest snapshot of each pool, in one query. Pools without snapshots are absent. */
  latestForPools(poolIds: readonly string[]): Map<string, PoolSnapshot> {
    const out = new Map<string, PoolSnapshot>()
    if (poolIds.length === 0) return out
    for (const row of this.ctx.all(LATEST_PER_POOL(COLUMNS), [jsonList([...poolIds])])) {
      const snapshot = rowToSnapshot(row)
      out.set(snapshot.poolId, snapshot)
    }
    return out
  }

  /**
   * The newest snapshot's `reference` of each pool, in one query: null for a pool without a stock
   * and for a snapshot stored before schema version 8. Pools without snapshots are absent.
   */
  latestReferences(poolIds: readonly string[]): Map<string, PoolReference | null> {
    const out = new Map<string, PoolReference | null>()
    if (poolIds.length === 0) return out
    const sql = LATEST_PER_POOL('id, pool_id, timestamp, reference_json', 'pool_id, reference_json')
    for (const row of this.ctx.all(sql, [jsonList([...poolIds])])) {
      out.set(colText(row, 'pool_id'), colJsonOrNull<PoolReference>(row, 'reference_json'))
    }
    return out
  }

  /**
   * Lightweight variant of latestForPools: only the summary columns and no snapshot JSON parsed in
   * JS: SQLite extracts the ±2 % sides from the newest rows' ladders and the $10,000 spread point,
   * the one point read through core's price impact cap.
   */
  latestSummaryForPools(poolIds: readonly string[]): Map<string, SnapshotSummary> {
    const out = new Map<string, SnapshotSummary>()
    if (poolIds.length === 0) return out
    const sql = LATEST_PER_POOL(`${SUMMARY_COLUMNS}, depth_usd_json, spreads_json`, SUMMARY_OUTER)
    for (const row of this.ctx.all(sql, [jsonList([...poolIds])])) {
      const summary = rowToSnapshotSummary(row)
      out.set(summary.poolId, summary)
    }
    return out
  }

  /**
   * Snapshots with `fromTs <= timestamp` (and `timestamp <= toTs` when given), ascending by
   * timestamp then insertion order.
   */
  seriesForPool(poolId: string, fromTs: number, toTs?: number): PoolSnapshot[] {
    const rows =
      toTs === undefined
        ? this.ctx.all(
            `SELECT ${COLUMNS} FROM snapshots WHERE pool_id = ? AND timestamp >= ? ORDER BY timestamp, id`,
            [poolId, fromTs],
          )
        : this.ctx.all(
            `SELECT ${COLUMNS} FROM snapshots WHERE pool_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp, id`,
            [poolId, fromTs, toTs],
          )
    return rows.map(rowToSnapshot)
  }

  /**
   * The health summaries of the snapshots with `fromTs <= timestamp <= toTs`, ascending by
   * timestamp then insertion order: the series `GET /api/pools/:id/history` scores. No snapshot
   * JSON is parsed in JS: SQLite extracts the ±2 % sides, the $10,000 spread point (read through
   * core's price impact cap) and the range HHI, so a week of rows costs a fraction of
   * `seriesForPool`.
   */
  seriesSummaryForPool(poolId: string, fromTs: number, toTs: number): SnapshotHealthSummary[] {
    const rows = this.ctx.all(
      `SELECT ${HEALTH_SUMMARY} FROM snapshots
        WHERE pool_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp, id`,
      [poolId, fromTs, toTs],
    )
    return rows.map(rowToSnapshotHealthSummary)
  }

  /** Timestamp of the pool's newest snapshot (an index lookup), or null when it has none. */
  latestTimestampForPool(poolId: string): number | null {
    const row = this.ctx.get('SELECT MAX(timestamp) AS ts FROM snapshots WHERE pool_id = ?', [
      poolId,
    ])
    return row ? colNumberOrNull(row, 'ts') : null
  }

  /** Timestamp of the newest snapshot across all pools, or null when empty. */
  latestTimestamp(): number | null {
    const row = this.ctx.get('SELECT MAX(timestamp) AS ts FROM snapshots')
    return row ? colNumberOrNull(row, 'ts') : null
  }

  /** Block number of the newest snapshot (by timestamp, then insertion order), or null when empty. */
  latestBlock(): bigint | null {
    const row = this.ctx.get(
      'SELECT block_number FROM snapshots ORDER BY timestamp DESC, id DESC LIMIT 1',
    )
    return row ? colBigint(row, 'block_number') : null
  }

  /**
   * Deletes snapshots with `timestamp < ts`: all of them, or the oldest `limit` when given, so
   * retention can delete in batches that each hold the write lock briefly. Returns the number
   * deleted.
   */
  pruneBefore(ts: number, limit?: number): number {
    if (limit === undefined)
      return this.ctx.run('DELETE FROM snapshots WHERE timestamp < ?', [ts]).changes
    return this.ctx.run(
      'DELETE FROM snapshots WHERE id IN (SELECT id FROM snapshots WHERE timestamp < ? ORDER BY timestamp, id LIMIT ?)',
      [ts, limit],
    ).changes
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM snapshots')
    return row ? colNumber(row, 'n') : 0
  }

  countForPool(poolId: string): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM snapshots WHERE pool_id = ?', [poolId])
    return row ? colNumber(row, 'n') : 0
  }
}
