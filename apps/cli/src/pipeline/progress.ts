/**
 * Info-level progress for long steps (a volume log scan of 24 h on a 10-block `eth_getLogs` plan
 * took about half an hour on Base's 2 s blocks and is ten times the requests on the 200 ms blocks
 * since Denim): at most one line every `intervalMs` (30 s by default), with done/total, percent,
 * elapsed time, a linear ETA and the caller's fields. The clock is injectable (milliseconds) so
 * tests drive the cadence without waiting.
 */
import type { LogFields, Logger } from '../log.js'

export const PROGRESS_INTERVAL_MS = 30_000

export interface ProgressOptions {
  log: Logger
  /** The log line's message, e.g. `reading swaps`. */
  message: string
  /** Units of work in all (e.g. blocks to scan); progress is reported against it. */
  total: number
  /** Key of the `done/total` field, e.g. `blocks` (default `done`). */
  unit?: string
  intervalMs?: number
  /** Milliseconds; defaults to `Date.now`. */
  clock?: () => number
}

export interface ProgressReporter {
  /** Records `done` units; logs when `intervalMs` has passed since the last line (or the start). */
  update(done: number, fields?: LogFields): void
}

/** `95 s` → `1m35s`; under a minute in whole seconds; null stays null. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * `done/total` chunks of a log scan whose chunk count is not fixed up front: the reader shrinks its
 * chunks below `--log-chunk` once a provider states a smaller cap. The blocks left are divided by
 * the mean span of the chunks served so far (`chunkBlocks / chunks`), or by `logChunk` before the
 * first one, so the total stays right on a capped endpoint.
 */
export function chunkProgress(
  chunks: number,
  chunkBlocks: number,
  blocksLeft: number,
  logChunk: number,
): string {
  const span = chunks > 0 && chunkBlocks > 0 ? Math.round(chunkBlocks / chunks) : logChunk
  const left = blocksLeft > 0 && span > 0 ? Math.ceil(blocksLeft / span) : 0
  return `${chunks}/${chunks + left}`
}

/** `done` of `total` to one decimal; 99.9 % at most until done (a last chunk may be tiny). */
function percent(done: number, total: number): string {
  const pct = (100 * Math.min(done, total)) / total
  return `${(done < total ? Math.min(pct, 99.9) : pct).toFixed(1)}%`
}

export function createProgressReporter(opts: ProgressOptions): ProgressReporter {
  const clock = opts.clock ?? Date.now
  const interval = opts.intervalMs ?? PROGRESS_INTERVAL_MS
  const started = clock()
  let last = started
  return {
    update(done, fields = {}) {
      const now = clock()
      if (now - last < interval) return
      last = now
      const elapsed = now - started
      const eta = done > 0 && done < opts.total ? (elapsed * (opts.total - done)) / done : null
      opts.log.info(opts.message, {
        [opts.unit ?? 'done']: `${done}/${opts.total}`,
        pct: opts.total > 0 ? percent(done, opts.total) : null,
        elapsed: formatDuration(elapsed),
        eta: done >= opts.total ? '0s' : formatDuration(eta),
        ...fields,
      })
    },
  }
}
