/**
 * What every pipeline step receives: the database, the chain reader, the config, a logger, a
 * clock and, under `depthwatch start`, the stop signal. The clock is injectable so the demo
 * (frozen synthetic chain) and tests window persistence and volume against the chain's time
 * rather than the wall clock. Once the signal aborts, the concurrent helpers below start no
 * further item and end with the signal's reason, and a step checks it (`throwIfStopped`) before
 * its storing transaction, so a stop never persists a partial result.
 */

import type { ChainReader } from '@depthwatch/chain'
import type { Dex } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import type { Config } from '../config.js'
import { type Logger, silentLogger } from '../log.js'

export interface PipelineContext {
  db: Database
  chain: ChainReader
  config: Config
  log: Logger
  /** Unix seconds. */
  now: () => number
  /** The stop signal of `depthwatch start` (the chain reader's too); unset for the commands. */
  signal?: AbortSignal
}

export interface CreatePipelineContextOptions {
  db: Database
  chain: ChainReader
  config: Config
  log?: Logger
  now?: () => number
  signal?: AbortSignal
}

export function createPipelineContext(opts: CreatePipelineContextOptions): PipelineContext {
  return {
    db: opts.db,
    chain: opts.chain,
    config: opts.config,
    log: opts.log ?? silentLogger,
    now: opts.now ?? (() => Math.floor(Date.now() / 1000)),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  }
}

/** Throws the stop signal's reason once it has aborted: called before a step stores anything. */
export function throwIfStopped(ctx: Pick<PipelineContext, 'signal'>): void {
  if (ctx.signal?.aborted) throw ctx.signal.reason
}

/** sync_state keys used by the pipeline. */
export const syncKeys = {
  discover: (dex: Dex) => `discover:${dex}:lastBlock`,
  /** Block of the last `discover --seed` of the DEX; never read as a log cursor. */
  seed: (dex: Dex) => `seed:${dex}:lastBlock`,
  positions: (poolId: string) => `positions:${poolId}:lastBlock`,
  /**
   * Last block of a pool's first positions scan while it is still behind the head (windowed runs,
   * positions.ts); its positions so far are stored under `positionsStagingId`, unpublished.
   */
  positionsCatchUp: (poolId: string) => `positions:${poolId}:catchUpBlock`,
  /**
   * The pool's custodians (a Slipstream gauge) as of its last published positions: lowercase,
   * comma-separated; absent when it has none. Their positions count as uncovered (snapshot.ts).
   */
  positionsCustodians: (poolId: string) => `positions:${poolId}:custodians`,
  /** When `start` last ran a cadenced step (unix ms; start/scheduler.ts). */
  startLastRun: (step: string) => `start:${step}:lastRunAt`,
  /** When `prune` last ran (unix seconds; prune.ts), which gates the daily prune of `run` and `start`. */
  pruneLastRun: () => 'prune:lastRunAt',
  snapshot: () => 'snapshot:lastBlock',
  /** Head of the last `volume` pass. */
  volume: () => 'volume:lastBlock',
  /** Timestamp of that head: the end of the volume data, which anchors the 24 h window (score.ts). */
  volumeHeadTs: () => 'volume:lastTs',
  /** Last block in the pool's hourly buckets (volume.ts). */
  volumeLastBlock: (poolId: string) => `volume:${poolId}:lastBlock`,
  /** First hour (unix seconds) from which the pool's hourly buckets are complete (volume.ts). */
  volumeFromTs: (poolId: string) => `volume:${poolId}:fromTs`,
  /** How the stored volume coverage found its blocks: `by-time` since Denim (volume.ts). */
  volumeWindows: () => 'volume:windows',
} as const

/**
 * A step's time budget: `spent` once `budgetMs` has elapsed since it was created, but never before
 * one unit of work (a discovery window, a pool) has been started, so every run makes progress.
 * Without a budget it is never spent.
 */
export class StepBudget {
  private units = 0
  private readonly startedMs: number

  constructor(
    private readonly budgetMs: number | undefined,
    private readonly clockMs: () => number,
  ) {
    this.startedMs = clockMs()
  }

  get spent(): boolean {
    return (
      this.budgetMs !== undefined &&
      this.units > 0 &&
      this.clockMs() - this.startedMs >= this.budgetMs
    )
  }

  /** Records that a unit of work started. */
  use(): void {
    this.units++
  }
}

export const HOUR_SECONDS = 3_600
export const DAY_SECONDS = 86_400

/**
 * `fn` over `items` with at most `limit` in flight; results keep the input order. Once `signal`
 * aborts no further item starts, and when the items in flight have settled it rejects with the
 * signal's reason (the step is being stopped; its partial results are not wanted).
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const width = Math.max(1, Math.min(limit, items.length))
  let next = 0
  const worker = async () => {
    while (next < items.length && signal?.aborted !== true) {
      const index = next++
      results[index] = await fn(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: width }, worker))
  if (signal?.aborted) throw signal.reason
  return results
}

export interface Settled<T> {
  ok: T[]
  failed: Array<{ item: string; error: unknown }>
}

/**
 * The exit rule of a command whose step collects per-item failures (`Settled.failed`): a run in
 * which every item failed stored nothing and is a runtime error (exit 1, one stderr line with the
 * first failure), where a partial failure stays a warning per item and a count on the `done`
 * line. `stored` is what the run stored: snapshots, pools read, samples.
 */
export function assertSomethingStored(
  command: string,
  failed: ReadonlyArray<{ item: string; error: string }>,
  stored: number,
): void {
  const [first] = failed
  if (first === undefined || stored > 0) return
  throw new Error(
    `${command}: every item failed (${failed.length}), nothing stored; ${first.item}: ${first.error}`,
  )
}

/**
 * Per-item try/catch around mapConcurrent: failures are collected instead of aborting the step. A
 * stop (`signal`) is not a failure: like mapConcurrent, it rejects with the signal's reason.
 */
export async function settleConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  label: (item: T) => string,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<Settled<R>> {
  type Outcome = { ok: true; value: R } | { ok: false; item: string; error: unknown }
  const out: Settled<R> = { ok: [], failed: [] }
  const results = await mapConcurrent(
    items,
    limit,
    async (item): Promise<Outcome> => {
      try {
        const value = (await fn(item)) as R
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error, item: label(item) }
      }
    },
    signal,
  )
  for (const result of results) {
    if (result.ok) out.ok.push(result.value)
    else out.failed.push({ item: result.item, error: result.error })
  }
  return out
}
