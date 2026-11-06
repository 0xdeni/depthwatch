/**
 * `score`: for every tracked pool, persistence over 24 h / 7 d from stored snapshots, 24 h USD
 * volume, the Liquidity Health Score and the gap metrics → one `scores` row per pool. Scores
 * follow the tracked set: rows of pools that dropped out of it (top-N re-selection, a removed
 * `--pool`) are deleted in the same transaction, so the API never serves stale pools. Database
 * only; no chain access.
 *
 * 24 h volume (docs/METRICS.md, "24 h volume"): the 24 whole hours before the hour of the last
 * block the latest `volume` pass read (`volume:lastTs`), whatever the scoring time, summed by
 * core's `computeVolume24hUsd` for each pool that was part of that pass and whose buckets reach
 * back to the window's start.
 */
import {
  computeGap,
  computeHealthScore,
  computePersistence,
  computeVolume24hUsd,
  GAP_FEED_MIN_VOLUME_USD,
  isHookedPool,
  type PoolMeta,
  type PoolSnapshot,
  scoringVolumeWindow,
  type VolumeWindow,
} from '@depthwatch/core'
import {
  type Database,
  type PoolScore,
  snapshotDepthSides,
  snapshotSummaryFields,
} from '@depthwatch/db'
import { type PipelineContext, syncKeys } from './context.js'

export interface ScoreResult {
  /** Tracked pools. */
  pools: number
  scored: number
  /** Scored pools that are rated (both ±2 % sides known, the thinner at least $5,000). */
  rated: number
  /** Tracked pools without any snapshot (not scored). */
  unsnapshotted: number
  /** Scored pools that qualify for the gaps feed (volume ≥ $10k and a gap score). */
  gaps: number
  /** Stale rows deleted: scores of pools that are no longer tracked. */
  pruned: number
  timestamp: number
  /** Bucket starts summed into `volume24hUsd`; null without a volume pass of the last day. */
  volumeWindow: VolumeWindow | null
}

export const PERSISTENCE_WINDOWS_HOURS = Object.freeze({ day: 24, week: 168 })

/**
 * Score of one pool from its snapshot series (ascending), newest snapshot and 24 h volume. `pool`
 * gives its kind (which concentration basis applies) and its `hooks` (a hooked Uniswap v4 pool is
 * unrated with reason `hooked`); the newest snapshot's `reference` says whether the pool's stock's
 * transfers are paused (unrated with reason `transfers-paused`).
 */
export function scorePool(
  poolId: string,
  pool: Pick<PoolMeta, 'kind' | 'hooks'>,
  series: readonly PoolSnapshot[],
  latest: PoolSnapshot,
  volume24hUsd: number | null,
  now: number,
): PoolScore {
  const samples = series.map((s) => ({
    timestamp: s.timestamp,
    depthUsd: snapshotSummaryFields(s).depth2Usd,
  }))
  const persistence24h = computePersistence(samples, PERSISTENCE_WINDOWS_HOURS.day, now)
  const persistence7d = computePersistence(samples, PERSISTENCE_WINDOWS_HOURS.week, now)
  const summary = snapshotSummaryFields(latest)
  const health = computeHealthScore({
    ...snapshotDepthSides(latest),
    spread10kBps: summary.spread10kBps,
    // The owners as stored, so a share that covers too little of the pool still adds its note.
    ownerTop1Share: latest.concentration?.owners?.top1Share ?? null,
    ownerCoverage: latest.concentration?.owners?.coverage ?? null,
    rangeHhi: latest.concentration?.rangeHhi ?? null,
    poolKind: pool.kind,
    persistence: persistence24h,
    hooked: isHookedPool(pool),
    // A stock pool whose stock's transfers are paused at the snapshot's block: no swap reaches its
    // depth (docs/METRICS.md, "Stock tradability"). Unknown is not a pause.
    transfersPaused: latest.reference?.transfersPaused === true,
  })
  return {
    poolId,
    timestamp: now,
    health,
    gap: computeGap(volume24hUsd, summary.depth2Usd),
    persistence24h,
    persistence7d,
    volume24hUsd,
    depth2Usd: summary.depth2Usd,
  }
}

/** The end of the latest volume pass: its head block and that block's timestamp. */
function volumeDataEnd(db: Database): { block: bigint; ts: number } | undefined {
  const block = db.syncState.getBigInt(syncKeys.volume())
  const ts = db.syncState.get(syncKeys.volumeHeadTs())
  if (block === undefined || ts === undefined || !/^\d+$/.test(ts)) return undefined
  return { block, ts: Number(ts) }
}

/**
 * First hour of the pool's complete buckets as of the latest volume pass; null when the pool was
 * not part of that pass (its coverage ends at another block) or has no coverage.
 */
function coveredFromTs(db: Database, poolId: string, lastPass: bigint): number | null {
  if (db.syncState.getBigInt(syncKeys.volumeLastBlock(poolId)) !== lastPass) return null
  const fromTs = db.syncState.get(syncKeys.volumeFromTs(poolId))
  return fromTs !== undefined && /^\d+$/.test(fromTs) ? Number(fromTs) : null
}

export async function scoreStep(ctx: PipelineContext): Promise<ScoreResult> {
  const { db, log } = ctx
  const now = ctx.now()
  const ids = db.pools.trackedIds()
  const end = volumeDataEnd(db)
  const window = scoringVolumeWindow(end?.ts ?? null, now)
  const result: ScoreResult = {
    pools: ids.length,
    scored: 0,
    rated: 0,
    unsnapshotted: 0,
    gaps: 0,
    pruned: 0,
    timestamp: now,
    volumeWindow: window,
  }
  if (ids.length === 0) {
    result.pruned = db.scores.deleteUntracked()
    log.warn('no tracked pools; run snapshot first', { pruned: result.pruned })
    return result
  }

  const scores: PoolScore[] = []
  const weekAgo = now - PERSISTENCE_WINDOWS_HOURS.week * 3600
  const pools = db.pools.getMany(ids)
  for (const id of ids) {
    const latest = db.snapshots.latestForPool(id)
    const pool = pools.get(id)
    if (latest === undefined || pool === undefined) {
      result.unsnapshotted++
      continue
    }
    const series = db.snapshots.seriesForPool(id, weekAgo, now)
    const volume24hUsd =
      window === null || end === undefined
        ? null
        : computeVolume24hUsd(
            window,
            coveredFromTs(db, id, end.block),
            db.volume.series(id, window.fromTs, window.toTs),
          )
    const score = scorePool(id, pool, series, latest, volume24hUsd, now)
    scores.push(score)
    if (score.gap.gapScore !== null && (volume24hUsd ?? 0) >= GAP_FEED_MIN_VOLUME_USD) result.gaps++
  }
  db.transaction(() => {
    db.scores.upsertMany(scores)
    result.pruned = db.scores.deleteUntracked()
  })
  result.scored = scores.length
  result.rated = scores.filter((score) => score.health.rated).length
  if (window === null)
    log.warn('no volume pass in the last 24 h: volume24hUsd is null (run volume before score)')
  log.info('stored scores', {
    scored: scores.length,
    rated: result.rated,
    unsnapshotted: result.unsnapshotted,
    gaps: result.gaps,
    pruned: result.pruned,
    grades: gradeHistogram(scores),
    volumeFrom: window === null ? null : new Date(window.fromTs * 1000).toISOString(),
    volumeTo: window === null ? null : new Date(window.toTs * 1000).toISOString(),
  })
  return result
}

/** Grades of the rated pools, then the unrated ones by reason: "A:7,B:18,…,unrated:442". */
function gradeHistogram(scores: readonly PoolScore[]): string {
  const counts = new Map<string, number>()
  for (const { health } of scores) {
    const key = health.grade ?? 'unrated'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return ['A', 'B', 'C', 'D', 'F', 'unrated']
    .filter((grade) => counts.has(grade))
    .map((grade) => `${grade}:${counts.get(grade)}`)
    .join(',')
}
