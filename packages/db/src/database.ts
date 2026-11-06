/**
 * `openDatabase(path | ':memory:')` opens (or creates) a SQLite database, runs migrations and
 * returns the typed repositories.
 *
 * Several processes may open one file at once (`serve` or `start` beside a one-shot command), so a
 * file connection sets `busy_timeout` before anything else: every later statement waits on a lock
 * another process holds instead of failing. Switching the file to WAL needs it to itself and
 * SQLite answers SQLITE_BUSY there without calling the busy handler, so the switch is made only
 * when the file is not in WAL yet and retried for up to BUSY_TIMEOUT_MS (`retryWhileBusy`). The
 * migrations then read `schema_version` inside their own write transaction (schema.ts).
 *
 * `node:sqlite` is loaded lazily through `createRequire` rather than a static import: Node emits
 * its ExperimentalWarning while the module graph is still loading, before any user code could
 * install a filter, so the filter is installed first and the module required right after.
 */
import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'
import { SqlContext } from './context.js'
import { MandatesRepo } from './repos/mandates.js'
import { MmAlertsRepo } from './repos/mmAlerts.js'
import { MmSamplesRepo } from './repos/mmSamples.js'
import { PoolsRepo } from './repos/pools.js'
import { PositionsRepo } from './repos/positions.js'
import { PricesRepo } from './repos/prices.js'
import { ScoresRepo } from './repos/scores.js'
import { SnapshotsRepo } from './repos/snapshots.js'
import { StockReadingsRepo } from './repos/stockReadings.js'
import { StocksRepo } from './repos/stocks.js'
import { SyncStateRepo } from './repos/syncState.js'
import { TokensRepo } from './repos/tokens.js'
import { VolumeRepo } from './repos/volume.js'
import { applyMigrations, type MigrationResult } from './schema.js'
import { registerSummaryFunctions } from './summary.js'
import { installSqliteWarningFilter } from './warnings.js'

export interface OpenDatabaseOptions {
  /** Clock in unix seconds for `first_seen_at`, `updated_at` and migration timestamps. */
  now?: () => number
}

export interface Database {
  /** The path given to openDatabase (`':memory:'` for in-memory databases). */
  readonly path: string
  /** Escape hatch for ad-hoc SQL; repositories cover everything the pipeline needs. */
  readonly raw: DatabaseSync
  readonly migration: MigrationResult
  readonly tokens: TokensRepo
  readonly pools: PoolsRepo
  readonly snapshots: SnapshotsRepo
  readonly volume: VolumeRepo
  readonly positions: PositionsRepo
  readonly prices: PricesRepo
  readonly scores: ScoresRepo
  readonly syncState: SyncStateRepo
  /** Market-maker scorecards (docs/design/scorecards.md §4). */
  readonly mandates: MandatesRepo
  readonly mmSamples: MmSamplesRepo
  readonly mmAlerts: MmAlertsRepo
  /** Tokenized stocks (docs/design/stocks.md §5): the stock list and its readings. */
  readonly stocks: StocksRepo
  readonly stockReadings: StockReadingsRepo
  /** Runs `fn` in `BEGIN IMMEDIATE … COMMIT`, rolling back on throw; nested calls join the outer one. */
  transaction<T>(fn: () => T): T
  /** True while a `transaction` call runs on this connection. */
  readonly inTransaction: boolean
  /**
   * Refreshes the planner statistics (`ANALYZE`, sampling at most `ANALYSIS_LIMIT` rows per
   * index) after a bulk write of pools, so the dex-filtered feeds and `statsByDex` search the
   * small side of a join first. Costs milliseconds; the pipeline runs it after discovery.
   */
  analyze(): void
  /**
   * `PRAGMA wal_checkpoint(TRUNCATE)`: folds the WAL into the main file and empties it, so a large
   * delete does not leave a WAL of its size on disk. A no-op outside WAL mode (`:memory:`).
   */
  checkpoint(): void
  /** Runs `PRAGMA optimize` and closes the connection. Safe to call more than once. */
  close(): void
  readonly isOpen: boolean
}

/** Rows `ANALYZE` and `PRAGMA optimize` sample per index: SQLite's recommended 100–1000 range. */
export const ANALYSIS_LIMIT = 1000

/** How long a statement waits on another connection's lock, and the WAL switch retries. */
export const BUSY_TIMEOUT_MS = 5_000

const SQLITE_BUSY = 5
const SQLITE_LOCKED = 6

/** True for a node:sqlite error whose primary result code is SQLITE_BUSY or SQLITE_LOCKED. */
export function isBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('errcode' in error)) return false
  const { errcode } = error
  if (typeof errcode !== 'number') return false
  const primary = errcode & 0xff
  return primary === SQLITE_BUSY || primary === SQLITE_LOCKED
}

/** Blocks the thread for `ms`: the node:sqlite API is synchronous, so its retries are too. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export interface RetryWhileBusyOptions {
  /** Milliseconds after the first attempt when no further attempt starts (BUSY_TIMEOUT_MS). */
  timeoutMs?: number
  /** Clock in milliseconds (default `performance.now`). */
  nowMs?: () => number
  /** Waits between attempts (default: blocks the thread). */
  sleep?: (ms: number) => void
}

/**
 * Runs `fn`, and again after 10, 20, 40, 80 and then every 100 ms while it throws SQLITE_BUSY or
 * SQLITE_LOCKED, until `timeoutMs` has passed; then the last error is thrown. Any other error is
 * thrown at once.
 */
export function retryWhileBusy<T>(fn: () => T, opts: RetryWhileBusyOptions = {}): T {
  const timeoutMs = opts.timeoutMs ?? BUSY_TIMEOUT_MS
  const nowMs = opts.nowMs ?? (() => performance.now())
  const sleep = opts.sleep ?? sleepSync
  const deadline = nowMs() + timeoutMs
  for (let attempt = 0; ; attempt++) {
    try {
      return fn()
    } catch (error) {
      if (!isBusyError(error) || nowMs() >= deadline) throw error
      sleep(Math.min(10 * 2 ** attempt, 100))
    }
  }
}

/** Puts a file connection in WAL mode unless the file already is (another process switched it). */
function useWal(raw: DatabaseSync): void {
  retryWhileBusy(() => {
    const row = raw.prepare('PRAGMA journal_mode').get()
    if (row?.journal_mode !== 'wal') raw.exec('PRAGMA journal_mode = WAL')
  })
}

type SqliteModule = typeof import('node:sqlite')

const require = createRequire(import.meta.url)
let sqlite: SqliteModule | undefined

function loadSqlite(): SqliteModule {
  if (!sqlite) {
    installSqliteWarningFilter()
    sqlite = require('node:sqlite') as SqliteModule
  }
  return sqlite
}

class SqliteDatabase implements Database {
  readonly tokens: TokensRepo
  readonly pools: PoolsRepo
  readonly snapshots: SnapshotsRepo
  readonly volume: VolumeRepo
  readonly positions: PositionsRepo
  readonly prices: PricesRepo
  readonly scores: ScoresRepo
  readonly syncState: SyncStateRepo
  readonly mandates: MandatesRepo
  readonly mmSamples: MmSamplesRepo
  readonly mmAlerts: MmAlertsRepo
  readonly stocks: StocksRepo
  readonly stockReadings: StockReadingsRepo
  private open = true

  constructor(
    readonly path: string,
    readonly raw: DatabaseSync,
    readonly migration: MigrationResult,
    private readonly ctx: SqlContext,
  ) {
    this.tokens = new TokensRepo(ctx)
    this.pools = new PoolsRepo(ctx)
    this.snapshots = new SnapshotsRepo(ctx)
    this.volume = new VolumeRepo(ctx)
    this.positions = new PositionsRepo(ctx)
    this.prices = new PricesRepo(ctx)
    this.scores = new ScoresRepo(ctx)
    this.syncState = new SyncStateRepo(ctx)
    this.mandates = new MandatesRepo(ctx)
    this.mmSamples = new MmSamplesRepo(ctx)
    this.mmAlerts = new MmAlertsRepo(ctx)
    this.stocks = new StocksRepo(ctx)
    this.stockReadings = new StockReadingsRepo(ctx)
  }

  get isOpen(): boolean {
    return this.open
  }

  transaction<T>(fn: () => T): T {
    return this.ctx.transaction(fn)
  }

  get inTransaction(): boolean {
    return this.ctx.inTransaction
  }

  analyze(): void {
    this.raw.exec('ANALYZE')
  }

  checkpoint(): void {
    this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  close(): void {
    if (!this.open) return
    this.open = false
    try {
      // SQLite's advice for a long-lived connection: refresh stale statistics before closing.
      this.raw.exec('PRAGMA optimize')
    } catch {
      // A database that cannot be written (a read-only file) keeps the statistics it has.
    }
    this.raw.close()
  }
}

export const IN_MEMORY = ':memory:'

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Database {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  const { DatabaseSync } = loadSqlite()
  const raw = new DatabaseSync(path)
  try {
    if (path !== IN_MEMORY) {
      raw.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
      useWal(raw)
      raw.exec('PRAGMA synchronous = NORMAL')
    }
    raw.exec('PRAGMA temp_store = MEMORY')
    raw.exec(`PRAGMA analysis_limit = ${ANALYSIS_LIMIT}`)
    registerSummaryFunctions(raw)
    const migration = applyMigrations(raw, now)
    return new SqliteDatabase(path, raw, migration, new SqlContext(raw, now))
  } catch (error) {
    raw.close()
    throw error
  }
}
