/**
 * `prune`: retention. Snapshots, hourly volume, scorecard samples and alerts grow for as long as
 * the pipeline runs (a snapshot row is about 1.4 KB: 200 tracked pools every 5 minutes are some
 * 80 MB a day), and nothing reads past the windows below, so older rows are deleted
 * (docs/ARCHITECTURE.md "Storage model", DESIGN.md "CLI"):
 *
 * - snapshots older than `keepDays` (`DEPTHWATCH_KEEP_DAYS`, default 30), never under
 *   SNAPSHOT_FLOOR_DAYS, so the 7 d persistence and history windows always have their series;
 * - hourly volume older than `keepDays`, to the hour; the coverage start of each tracked pool
 *   (`volume:<pool>:fromTs`) moves up to that cutoff, so a later `volume --hours` never trusts a
 *   pruned hour as covered;
 * - scorecard samples older than MM_SAMPLES_DAYS (the summaries read 30 days), alerts older than
 *   MM_ALERTS_DAYS except each mandate's newest delivered alert (`mmAlerts.pruneBefore`), which
 *   the alert decision reads however long a breach streak lasts;
 * - the `volume:<pool>:*` cursors of pools that are no longer tracked (tracked again, the pool
 *   reads the whole window, as a newly tracked one does).
 *
 * Stock readings (`stock_readings`) are never pruned (docs/design/stocks.md §4): ten rows a pass,
 * about 30,000 a year at a 3 h cadence, and with their pass depth the only record of a stock's
 * depth that outlives the snapshots. The stock list (`stocks`) is rewritten by every snapshot.
 *
 * Snapshots are deleted in batches of `batch` rows, each its own transaction, so a day's rows never
 * hold the write lock for long. The loop yields to the event loop after each full batch, so under
 * `start` the API answers between batches and a stop signal that arrives meanwhile ends the loop
 * before the next one; the rows left wait for the next run. The rest goes in one
 * transaction together with `prune:lastRunAt`, which gates the daily prune of `run` and `start`
 * (`pruneDue`). The run ends with a WAL checkpoint (`Database.checkpoint`): the deletes fold into
 * the main file, whose freed pages later writes reuse, so the file stops growing.
 */
import type { Database } from '@depthwatch/db'
import { DAY_SECONDS, type PipelineContext, syncKeys, throwIfStopped } from './context.js'
import { hourStartOf } from './volume.js'

/** Days of snapshots always kept, whatever `--keep-days` says: the 7 d windows plus a day. */
export const SNAPSHOT_FLOOR_DAYS = 8
export const MM_SAMPLES_DAYS = 35
export const MM_ALERTS_DAYS = 90
/** Snapshot rows per delete. */
export const PRUNE_BATCH = 10_000
/** `run` and `start` prune once this much time has passed since the last prune. */
export const PRUNE_EVERY_SECONDS = DAY_SECONDS

export interface PruneOptions {
  /** Days of snapshots and hourly volume kept (default `config.keepDays`). */
  keepDays?: number
  /** Snapshot rows per delete (default PRUNE_BATCH; tests use a small one). */
  batch?: number
}

export interface PruneResult {
  keepDays: number
  snapshots: number
  /** Snapshot deletes run (at least one, even when nothing was old). */
  batches: number
  volume: number
  mmSamples: number
  mmAlerts: number
  /** `volume:<pool>:*` cursors of pools no longer tracked, deleted. */
  cursors: number
  /** Tracked pools whose volume coverage start moved up to the cutoff. */
  coverage: number
}

/** True when no prune has run for PRUNE_EVERY_SECONDS (or ever): `run` and `start` prune then. */
export function pruneDue(db: Database, now: number): boolean {
  const last = db.syncState.get(syncKeys.pruneLastRun())
  if (last === undefined || !/^\d+$/.test(last)) return true
  return now - Number(last) >= PRUNE_EVERY_SECONDS
}

/** The pool id of a `volume:<pool>:lastBlock` / `:fromTs` key; undefined for the pass-wide keys. */
export function volumeCursorPool(key: string): string | undefined {
  if (!key.startsWith('volume:')) return undefined
  const rest = key.slice('volume:'.length)
  for (const suffix of [':lastBlock', ':fromTs']) {
    if (!rest.endsWith(suffix)) continue
    const poolId = rest.slice(0, -suffix.length)
    return poolId === '' ? undefined : poolId
  }
  return undefined
}

export async function pruneStep(
  ctx: PipelineContext,
  opts: PruneOptions = {},
): Promise<PruneResult> {
  const { db, log, config } = ctx
  const now = ctx.now()
  const keepDays = opts.keepDays ?? config.keepDays
  const batch = opts.batch ?? PRUNE_BATCH
  const snapshotCutoff = now - Math.max(SNAPSHOT_FLOOR_DAYS, keepDays) * DAY_SECONDS
  const volumeCutoff = hourStartOf(now - keepDays * DAY_SECONDS)
  const result: PruneResult = {
    keepDays,
    snapshots: 0,
    batches: 0,
    volume: 0,
    mmSamples: 0,
    mmAlerts: 0,
    cursors: 0,
    coverage: 0,
  }
  log.info('pruning', { keepDays, snapshotsBefore: snapshotCutoff, volumeBefore: volumeCutoff })

  for (;;) {
    throwIfStopped(ctx)
    const deleted = db.snapshots.pruneBefore(snapshotCutoff, batch)
    result.batches++
    result.snapshots += deleted
    if (deleted < batch) break
    // node:sqlite is synchronous: without this yield the event loop would not run until the last
    // batch, so `start` could neither answer a request nor see the stop signal in between.
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  throwIfStopped(ctx)
  const tracked = new Set(db.pools.trackedIds())
  db.transaction(() => {
    result.volume = db.volume.pruneBefore(volumeCutoff)
    result.mmSamples = db.mmSamples.pruneBefore(now - MM_SAMPLES_DAYS * DAY_SECONDS)
    result.mmAlerts = db.mmAlerts.pruneBefore(now - MM_ALERTS_DAYS * DAY_SECONDS)
    for (const key of db.syncState.keys('volume:')) {
      const poolId = volumeCursorPool(key)
      if (poolId === undefined) continue
      if (!tracked.has(poolId)) {
        db.syncState.delete(key)
        result.cursors++
      } else if (key === syncKeys.volumeFromTs(poolId)) {
        const fromTs = db.syncState.get(key)
        if (fromTs !== undefined && /^\d+$/.test(fromTs) && Number(fromTs) < volumeCutoff) {
          db.syncState.set(key, String(volumeCutoff))
          result.coverage++
        }
      }
    }
    db.syncState.set(syncKeys.pruneLastRun(), String(now))
  })
  db.checkpoint()
  log.info('pruned', { ...result })
  return result
}
