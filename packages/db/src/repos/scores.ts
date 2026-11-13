import { type Address, MEANINGFUL_GAP_TURNOVER } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import { type BindValue, colNumber, colNumberOrNull, page } from '../sql.js'
import { type PoolFilter, poolFilterClauses, whereSql } from './poolRow.js'
import {
  DIRECTIONS,
  JOINED_SELECT,
  type PoolScore,
  rowToPoolScore,
  rowToScoredPool,
  SCORE_FROM,
  SCORE_SELECT,
  type ScoredPoolRow,
  SORT_COLUMNS,
  type SortDir,
  type TopBySort,
} from './scoreRow.js'
import {
  type DexStats,
  LATEST_JOIN,
  LEFT_OUT_SQL,
  median,
  medianRatedHealth,
  RATED_SQL,
  STALE_SQL,
  statsByDex,
} from './scoreStats.js'

export type { PoolScore, ScoredPoolRow, SortDir, TopBySort } from './scoreRow.js'
export { type DexStats, median }

export type ScoreUpsert = PoolScore

export interface TopByOptions extends PoolFilter {
  /**
   * Defaults to 'desc'. Nulls sort last in both directions; sorting by health also puts unrated
   * pools after the rated ones in both directions, sorting by depth stale quotes after the others.
   */
  dir?: SortDir
  /** True keeps only rated pools, false only unrated ones; both when undefined. */
  rated?: boolean
  /** Defaults to 50. */
  limit?: number
  offset?: number
  /** Keeps only pools with a known 24 h volume of at least this many USD. */
  minVolumeUsd?: number
}

export interface TopByResult {
  items: ScoredPoolRow[]
  /** Number of scored pools matching the filters, ignoring limit/offset. */
  total: number
}

export const DEFAULT_GAP_MIN_VOLUME_USD = 10_000
const DEFAULT_LIMIT = 50

export interface GapsOptions {
  /** Defaults to 50. */
  limit?: number
  offset?: number
  /** Defaults to DEFAULT_GAP_MIN_VOLUME_USD (10 000). */
  minVolumeUsd?: number
}

/** The whole gaps feed at one floor, counted (docs/METRICS.md, "Gap score and the gaps feed"). */
export interface GapCounts {
  /** Pools in the feed. */
  total: number
  /** Feed pools with a turnover of at least MEANINGFUL_GAP_TURNOVER (3×). */
  meaningful: number
}

/**
 * A token's ±2 % depth over every scored pool containing it, stale quotes left out (docs/METRICS.md,
 * "A token's depth").
 */
export interface TokenDepth {
  /** Sum of the pools' known `depth2Usd`; null when none is known (unknown is not 0). */
  depth2UsdTotal: number | null
  /** Pools whose depth is known, quote not stale and stock not paused: the ones the sum covers. */
  depthKnownPools: number
}

const UPSERT = `INSERT INTO scores (
    pool_id, timestamp, health_json, gap_json, persistence_24h_json, persistence_7d_json,
    volume_24h_usd, depth2_usd, health_total, gap_score
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(pool_id) DO UPDATE SET
    timestamp = excluded.timestamp, health_json = excluded.health_json, gap_json = excluded.gap_json,
    persistence_24h_json = excluded.persistence_24h_json,
    persistence_7d_json = excluded.persistence_7d_json, volume_24h_usd = excluded.volume_24h_usd,
    depth2_usd = excluded.depth2_usd, health_total = excluded.health_total,
    gap_score = excluded.gap_score`

export class ScoresRepo {
  constructor(private readonly ctx: SqlContext) {}

  upsert(score: ScoreUpsert): void {
    this.ctx.run(UPSERT, [
      score.poolId,
      score.timestamp,
      JSON.stringify(score.health),
      JSON.stringify(score.gap),
      JSON.stringify(score.persistence24h),
      JSON.stringify(score.persistence7d),
      score.volume24hUsd,
      score.depth2Usd,
      score.health.total,
      score.gap.gapScore,
    ])
  }

  upsertMany(scores: readonly ScoreUpsert[]): number {
    if (scores.length === 0) return 0
    return this.ctx.transaction(() => {
      for (const score of scores) this.upsert(score)
      return scores.length
    })
  }

  get(poolId: string): PoolScore | undefined {
    const row = this.ctx.get(`SELECT ${SCORE_SELECT} FROM scores s WHERE s.pool_id = ?`, [poolId])
    return row ? rowToPoolScore(row) : undefined
  }

  /** Scored pool joined with its metadata and newest snapshot, or undefined when unscored. */
  getRow(poolId: string): ScoredPoolRow | undefined {
    const row = this.ctx.get(`${JOINED_SELECT} WHERE s.pool_id = ?`, [poolId])
    return row ? rowToScoredPool(row) : undefined
  }

  /** Ranked, filtered page of scored pools plus the unpaged match count. */
  topBy(sort: TopBySort, options: TopByOptions = {}): TopByResult {
    if (!Object.hasOwn(SORT_COLUMNS, sort)) throw new RangeError(`db: invalid sort "${sort}"`)
    const dir = options.dir ?? 'desc'
    if (!Object.hasOwn(DIRECTIONS, dir)) throw new RangeError(`db: invalid dir "${dir}"`)
    const column = SORT_COLUMNS[sort]
    const direction = DIRECTIONS[dir]
    const { clauses, params } = this.filterClauses(options)
    const [limit, offset] = page(options.limit, options.offset, DEFAULT_LIMIT)
    const where = whereSql(clauses)
    // Unrated pools follow the rated ones whichever way health is sorted: their totals are not
    // comparable with a grade. Stale quotes follow the others on depth: their depth is measured
    // at a price nobody trades (docs/METRICS.md, "Stale quotes").
    const groupFirst =
      sort === 'health'
        ? `CASE WHEN ${RATED_SQL} THEN 0 ELSE 1 END, `
        : sort === 'depth'
          ? `CASE WHEN ${STALE_SQL} THEN 1 ELSE 0 END, `
          : ''
    const items = this.ctx
      .all(
        `${JOINED_SELECT} ${where} ORDER BY ${groupFirst}${column} ${direction} NULLS LAST, s.pool_id ASC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )
      .map(rowToScoredPool)
    const countRow = this.ctx.get(`SELECT COUNT(*) AS n FROM ${SCORE_FROM} ${where}`, params)
    return { items, total: countRow ? colNumber(countRow, 'n') : 0 }
  }

  /**
   * Liquidity gaps feed: real volume on thin depth, best gap score first. Equal scores (every pool
   * trading 100× its depth or more scores 100) go by turnover, highest first, then by pool id.
   */
  gaps(options: GapsOptions = {}): ScoredPoolRow[] {
    const minVolumeUsd = options.minVolumeUsd ?? DEFAULT_GAP_MIN_VOLUME_USD
    const [limit, offset] = page(options.limit, options.offset, DEFAULT_LIMIT)
    return this.ctx
      .all(
        `${JOINED_SELECT} WHERE s.gap_score IS NOT NULL AND s.volume_24h_usd >= ?
          ORDER BY s.gap_score DESC, json_extract(s.gap_json, '$.turnoverRatio') DESC NULLS LAST,
            s.pool_id ASC LIMIT ? OFFSET ?`,
        [minVolumeUsd, limit, offset],
      )
      .map(rowToScoredPool)
  }

  /** Counts of the whole gaps feed at `minVolumeUsd`: the rows `gaps` pages through. */
  gapCounts(minVolumeUsd: number = DEFAULT_GAP_MIN_VOLUME_USD): GapCounts {
    const row = this.ctx.get(
      `SELECT COUNT(*) AS total,
          COALESCE(SUM(json_extract(s.gap_json, '$.turnoverRatio') >= ?), 0) AS meaningful
        FROM ${SCORE_FROM} WHERE s.gap_score IS NOT NULL AND s.volume_24h_usd >= ?`,
      [MEANINGFUL_GAP_TURNOVER, minVolumeUsd],
    )
    return {
      total: row ? colNumber(row, 'total') : 0,
      meaningful: row ? colNumber(row, 'meaningful') : 0,
    }
  }

  /**
   * The ±2 % depth of every scored pool containing `token`, as the feeds list it: the score's
   * `depth2Usd`, else the newest snapshot's. A stale quote's depth and a paused stock's pool are
   * left out, as from the stats.
   */
  tokenDepth(token: Address): TokenDepth {
    const { clauses, params } = poolFilterClauses({ token })
    clauses.push(`NOT ${LEFT_OUT_SQL}`)
    const row = this.ctx.get(
      `SELECT COUNT(d) AS known, SUM(d) AS total FROM (
          SELECT COALESCE(s.depth2_usd, sn.depth2_usd) AS d
            FROM ${SCORE_FROM} ${LATEST_JOIN} ${whereSql(clauses)})`,
      params,
    )
    const known = row ? colNumber(row, 'known') : 0
    return {
      depth2UsdTotal: known > 0 && row ? colNumberOrNull(row, 'total') : null,
      depthKnownPools: known,
    }
  }

  /** Per-dex totals, in DEXES order (dexes without pools included with zeros). */
  statsByDex(): DexStats[] {
    return statsByDex(this.ctx)
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM scores')
    return row ? colNumber(row, 'n') : 0
  }

  /** Unix seconds of the newest score row (`GET /api/health` `latestScoredAt`); null when none. */
  latestTimestamp(): number | null {
    const row = this.ctx.get('SELECT MAX(timestamp) AS ts FROM scores')
    return row ? colNumberOrNull(row, 'ts') : null
  }

  /** Median health total over rated pools (all DEXes); null when none is rated. */
  medianRatedHealth(): number | null {
    return medianRatedHealth(this.ctx)
  }

  delete(poolId: string): boolean {
    return this.ctx.run('DELETE FROM scores WHERE pool_id = ?', [poolId]).changes > 0
  }

  /**
   * Deletes the score rows of pools that are not tracked any more (or no longer exist), so the
   * feeds built on `scores` only ever show the current tracked set. Returns the rows removed.
   */
  deleteUntracked(): number {
    return this.ctx.run(
      'DELETE FROM scores WHERE pool_id NOT IN (SELECT id FROM pools WHERE tracked = 1)',
    ).changes
  }

  private filterClauses(options: TopByOptions): { clauses: string[]; params: BindValue[] } {
    const { clauses, params } = poolFilterClauses(options)
    if (options.minVolumeUsd !== undefined) {
      clauses.push('s.volume_24h_usd >= ?')
      params.push(options.minVolumeUsd)
    }
    if (options.rated !== undefined) clauses.push(options.rated ? RATED_SQL : `NOT (${RATED_SQL})`)
    return { clauses, params }
  }
}
