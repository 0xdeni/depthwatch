/**
 * `demo`: the whole pipeline over the time-varying synthetic Base world from `@depthwatch/chain`
 * (eight pools on all six DEXes, LP positions rebalanced hourly, drifting prices, hourly swaps,
 * an Aero Slipstream fee that moves by the hour, two scripted market makers) into an in-memory
 * database (or an explicit `--db` file; the live `DEPTHWATCH_DB` is never opened), then the API
 * and dashboard. Nothing here touches the network, so it works offline and doubles as the
 * end-to-end test. The demo chain dates the Aero factories inside the synthetic history
 * (`syntheticAddresses`), so discovery at the first point finds the Aero pools.
 *
 * History (docs/design/web-v2.md §3): `runDemoPipeline` discovers once, then runs positions and
 * snapshot (with mandate sampling) at every point from now − 7 d to now, every 2 h (85 points),
 * each against the fixture of that moment with the pipeline clock at the point's timestamp, and
 * finally volume and score at now. Snapshots, samples and persistence therefore come from the
 * real pipeline, never from rows written directly.
 *
 * Two market-maker mandates are registered before the pipeline runs (docs/design/scorecards.md
 * §5): `demo-slipstream-weth-usdc` (a gauge-staked Slipstream position) meets its KPIs except
 * during one ~6 h dip, and `demo-aero-usdc-aero` (an Aerodrome v2 LP share) alternates between
 * breached and within KPI as its market maker pulls and restores its LP. Like `serve`, the demo
 * hands `DEPTHWATCH_ADMIN_TOKEN` to the API, so registration over `POST /api/mm` can be tried
 * offline.
 */
import {
  type ChainReader,
  createChainReader,
  createFixtureTransport,
  createSyntheticFixture,
  STOCK_PROTOCOL,
  type StockList,
  SYNTHETIC_DEFAULTS,
  SYNTHETIC_HISTORY,
  SYNTHETIC_OWNERS,
  SYNTHETIC_POOL_IDS,
  type SyntheticOptions,
  syntheticAddresses,
} from '@depthwatch/chain'
import { type Mandate, type MandateRegistration, parseMandate } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import type { Config } from './config.js'
import { type Logger, quietLogger, silentLogger } from './log.js'
import { createPipelineContext, HOUR_SECONDS, type PipelineContext } from './pipeline/context.js'
import { type DiscoverResult, discoverStep } from './pipeline/discover.js'
import { type PositionsResult, positionsStep } from './pipeline/positions.js'
import { type ScoreResult, scoreStep } from './pipeline/score.js'
import { type SnapshotResult, snapshotStep } from './pipeline/snapshot.js'
import { type VolumeResult, volumeStep } from './pipeline/volume.js'
import { serveUntilAborted } from './serve.js'

/** The fixture transport has no range limits, so discovery scans in big chunks. */
export const DEMO_LOG_CHUNK_SIZE = 100_000
/** …and in one window per DEX (1 000 chunks = 100 M blocks): no progress lines to resume from. */
export const DEMO_DISCOVER_WINDOW_CHUNKS = 1_000

/**
 * The demo world holds no tokenized stock (docs/design/stocks.md §8): its stock list is empty, so
 * the snapshot step sends no stock read and stores no reading, and the stock routes answer empty.
 */
export const DEMO_STOCKS: StockList = Object.freeze({
  tokens: [],
  feeds: {},
  oracleRegistry: STOCK_PROTOCOL.oracleRegistry,
})

/**
 * The chain of the synthetic world at `opts`, with the Aero start blocks of its anchor and the
 * demo's empty stock list.
 */
export function createDemoChain(opts: SyntheticOptions = {}): ChainReader {
  return createChainReader({
    transport: createFixtureTransport(createSyntheticFixture(opts)),
    addresses: syntheticAddresses(opts.latestBlock ?? SYNTHETIC_DEFAULTS.latestBlock),
    logChunkSize: DEMO_LOG_CHUNK_SIZE,
    stocks: DEMO_STOCKS,
  })
}

/** Registration JSON of the two demo mandates (the shape `mm register --file` takes). */
export const DEMO_MANDATES: readonly MandateRegistration[] = Object.freeze([
  {
    id: 'demo-slipstream-weth-usdc',
    name: 'Demo: WETH/USDC Slipstream (staked position)',
    poolId: SYNTHETIC_POOL_IDS.wethUsdcSlipstream,
    marketMaker: 'Bob Liquidity (synthetic)',
    addresses: [SYNTHETIC_OWNERS[1] as string],
    // The [-300, 300] position staked in the CLGauge provides far more than this on each side.
    kpis: { minDepthUsd: 250_000 },
    // Shown on the scorecard page as product copy: plain language, no code identifiers.
    notes:
      "Synthetic mandate: the demo market maker's single gauge-staked Slipstream position, " +
      'about ±3 % around the price; it dips below the KPI once for about 6 h and recovers.',
  },
  {
    id: 'demo-aero-usdc-aero',
    name: 'Demo: USDC/AERO Aerodrome v2 (LP share)',
    poolId: SYNTHETIC_POOL_IDS.usdcAeroV2,
    marketMaker: 'Alice Markets (synthetic)',
    addresses: [SYNTHETIC_OWNERS[0] as string],
    // Half of the base LP supply (40 % in wallet, 10 % staked), all it keeps while pulled back
    // (and in the static world), is nowhere near this depth at ±2 %; topped up to 8× that
    // (SYNTHETIC_EVENTS.aeroMarketMaker) it clears it.
    kpis: { minDepthUsd: 50_000 },
    notes:
      'Synthetic mandate: the market maker tops its LP up and pulls most of it back on a ' +
      'schedule, so the scorecard alternates between within KPI and breached.',
  },
])

/** Registers (upserts) the demo mandates with `createdAt`; returns them in order. */
export function registerDemoMandates(db: Database, createdAt: number): Mandate[] {
  const mandates = DEMO_MANDATES.map((registration) => parseMandate(registration, createdAt))
  db.mandates.upsertMany(mandates)
  return mandates
}

/** The demo history: one point every 2 h over seven days, the last one at the world's now. */
export const DEMO_HISTORY = Object.freeze({
  stepSeconds: 2 * HOUR_SECONDS,
  points: 85,
})

/** Timestamps of `points` history points ending at `now`, ascending, `DEMO_HISTORY.stepSeconds` apart. */
export function demoHistoryTimestamps(now: number, points: number = DEMO_HISTORY.points): number[] {
  const maxPoints = Math.floor(SYNTHETIC_HISTORY.maxAgeSeconds / DEMO_HISTORY.stepSeconds) + 1
  if (!Number.isInteger(points) || points < 1 || points > maxPoints)
    throw new RangeError(`demo: historyPoints must be an integer between 1 and ${maxPoints}`)
  return Array.from({ length: points }, (_, i) => now - (points - 1 - i) * DEMO_HISTORY.stepSeconds)
}

/** The synthetic world's anchor ("now") and seed; epochs are taken against it. */
export type DemoWorld = Pick<SyntheticOptions, 'latestBlock' | 'latestTimestamp' | 'seed'>

export interface DemoPipelineOptions {
  db: Database
  config: Config
  log?: Logger
  /** History points (default `DEMO_HISTORY.points`, seven days); tests run a short history. */
  historyPoints?: number
  /** Defaults to `SYNTHETIC_DEFAULTS`. */
  world?: DemoWorld
}

export interface DemoHistoryResult {
  /** The points' timestamps, ascending; the last one is the world's now. */
  timestamps: number[]
  /** Snapshots and market-maker samples stored over all points. */
  snapshots: number
  samples: number
  /** Positions and snapshot failures over all points (pool or mandate, with the error). */
  failed: Array<{ item: string; error: string }>
}

export interface DemoPipelineResult {
  mandates: Mandate[]
  /** The synthetic world's now: the last history point, where volume and score ran. */
  now: number
  discover: DiscoverResult
  /** Positions and snapshot of the last history point. */
  positions: PositionsResult
  snapshot: SnapshotResult
  history: DemoHistoryResult
  volume: VolumeResult
  score: ScoreResult
}

/**
 * Clears what an earlier demo run left in a reused, demo-marked `--db` file (snapshots, samples,
 * alerts, volume, positions and their cursors), so a rerun rebuilds the same history instead of
 * appending a second copy. Pools, tokens, mandates and discovery cursors stay. The volume cursors
 * go with the buckets: left behind, they would make the next pass read only the latest hour.
 * Databases without the demo marker are left alone.
 */
export function resetDemoHistory(db: Database): void {
  if (db.syncState.get(DEMO_MARKER_KEY) === undefined) return
  const everything = Number.MAX_SAFE_INTEGER
  db.transaction(() => {
    db.snapshots.pruneBefore(everything)
    db.mmSamples.pruneBefore(everything)
    db.mmAlerts.pruneBefore(everything)
    db.volume.pruneBefore(everything)
    for (const pool of db.pools.list()) db.positions.deleteForPool(pool.id)
    for (const [key] of db.syncState.entries())
      if (key.startsWith('positions:') || key.startsWith('volume:')) db.syncState.delete(key)
  })
}

/**
 * Register the demo mandates (created at the first point), discover once at the first point,
 * then positions → snapshot at every history point against the fixture of that moment (positions
 * over every discovered pool, so owner concentration and the mandates' attribution are populated
 * from the first snapshot on), then volume → score at now. Throws when a point fails: the world
 * is deterministic, so a failure is a bug, not weather.
 */
export async function runDemoPipeline(opts: DemoPipelineOptions): Promise<DemoPipelineResult> {
  const { db } = opts
  const log = opts.log ?? silentLogger
  const world = {
    latestBlock: opts.world?.latestBlock ?? SYNTHETIC_DEFAULTS.latestBlock,
    latestTimestamp: opts.world?.latestTimestamp ?? SYNTHETIC_DEFAULTS.latestTimestamp,
    seed: opts.world?.seed ?? SYNTHETIC_DEFAULTS.seed,
  }
  const timestamps = demoHistoryTimestamps(world.latestTimestamp, opts.historyPoints)
  const config: Config = { ...opts.config, logChunkSize: DEMO_LOG_CHUNK_SIZE }
  const contextAt = (epochTimestamp: number): PipelineContext =>
    createPipelineContext({
      db,
      chain: createDemoChain({ ...world, epochTimestamp }),
      config,
      log,
      now: () => epochTimestamp,
    })

  resetDemoHistory(db)
  const mandates = registerDemoMandates(db, timestamps[0] as number)
  log.info('registered demo mandates', { mandates: mandates.map((m) => m.id) })
  let ctx = contextAt(timestamps[0] as number)
  const discover = await log.timed(
    'discover',
    (step) => discoverStep({ ...ctx, log: step }, { windowChunks: DEMO_DISCOVER_WINDOW_CHUNKS }),
    (r) => ({ found: r.found }),
  )
  const history: DemoHistoryResult = { timestamps, snapshots: 0, samples: 0, failed: [] }
  let last: { positions: PositionsResult; snapshot: SnapshotResult } | undefined
  await log.timed(
    'history',
    async (step) => {
      const quiet = quietLogger(step)
      for (const [i, timestamp] of timestamps.entries()) {
        if (i > 0) ctx = contextAt(timestamp)
        const point = { ...ctx, log: quiet }
        const positions = await positionsStep(point, { pools: db.pools.list() })
        const snapshot = await snapshotStep(point)
        history.snapshots += snapshot.snapshots
        history.samples += snapshot.samples
        history.failed.push(...positions.failed, ...snapshot.failed)
        last = { positions, snapshot }
        if ((i + 1) % 12 === 0 || i === timestamps.length - 1)
          step.info('progress', {
            points: i + 1,
            of: timestamps.length,
            at: new Date(timestamp * 1000).toISOString(),
          })
      }
      if (history.failed.length > 0)
        throw new Error(
          `demo history failed for ${history.failed.map((f) => `${f.item} (${f.error})`).join('; ')}`,
        )
    },
    () => ({ points: timestamps.length, snapshots: history.snapshots, samples: history.samples }),
  )
  if (last === undefined) throw new Error('demo: no history point ran')
  const volume = await log.timed(
    'volume',
    (step) => volumeStep({ ...ctx, log: step }),
    (r) => ({ buckets: r.buckets }),
  )
  const score = await log.timed(
    'score',
    (step) => scoreStep({ ...ctx, log: step }),
    (r) => ({ scored: r.scored }),
  )
  return {
    mandates,
    now: world.latestTimestamp,
    discover,
    positions: last.positions,
    snapshot: last.snapshot,
    history,
    volume,
    score,
  }
}

export interface DemoOptions {
  config: Config
  log: Logger
  signal: AbortSignal
  stdout?: (line: string) => void
  /** Called once the server listens (tests use it to probe the URL before aborting). */
  onListening?: (url: string) => void
  /** History points (default `DEMO_HISTORY.points`); tests run a short history. */
  historyPoints?: number
}

/** `sync_state` marker every demo database carries, so a later demo run may reuse the file. */
export const DEMO_MARKER_KEY = 'demo:synthetic'

/** `--db` named a file holding data that no demo run wrote: it is never overwritten. */
export class DemoDatabaseError extends Error {
  override readonly name = 'DemoDatabaseError'
}

/**
 * Opens the demo database: in-memory unless `--db` names a file. `DEPTHWATCH_DB` is deliberately
 * ignored: `.env` points it at the live database, and seeding the synthetic world there would
 * replace its pools, prices and tracked set and move every `discover` cursor to the synthetic
 * chain head. A `--db` file is accepted only while it is empty or was seeded by an earlier demo.
 */
export function openDemoDatabase(config: Config): Database {
  if (config.dbPathSource !== 'flag') return openDatabase(IN_MEMORY)
  const db = openDatabase(config.dbPath)
  try {
    if (db.syncState.get(DEMO_MARKER_KEY) === undefined) {
      const pools = db.pools.count()
      const cursors = db.syncState.entries().length
      if (pools > 0 || cursors > 0) {
        throw new DemoDatabaseError(
          `demo: "${config.dbPath}" already holds ${pools} pool(s) and ${cursors} sync_state ` +
            'row(s) that no demo run wrote; refusing to overwrite them (omit --db for an ' +
            'in-memory database, or point --db at a new file)',
        )
      }
    }
    db.syncState.set(DEMO_MARKER_KEY, '1')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export async function demoCommand(opts: DemoOptions): Promise<void> {
  const { config, log, signal } = opts
  const db = openDemoDatabase(config)
  try {
    const points = opts.historyPoints ?? DEMO_HISTORY.points
    log.info('demo: synthetic Base world, no network', {
      db: db.path,
      block: SYNTHETIC_DEFAULTS.latestBlock,
      at: new Date(SYNTHETIC_DEFAULTS.latestTimestamp * 1000).toISOString(),
      historyPoints: points,
      historyHours: ((points - 1) * DEMO_HISTORY.stepSeconds) / HOUR_SECONDS,
    })
    const started = Date.now()
    const result = await runDemoPipeline({ db, config, log, historyPoints: points })
    log.info('demo pipeline done', {
      ms: Date.now() - started,
      snapshots: result.history.snapshots,
    })
    if (signal.aborted) return
    await serveUntilAborted({
      db,
      port: config.port,
      hostname: config.hostname,
      adminToken: config.adminToken,
      log,
      now: () => result.now,
      // `/api/health` says `source: 'demo'`, so the dashboard shows the demo banner.
      source: 'demo',
      signal,
      stdout: opts.stdout,
      onListening: opts.onListening,
    })
  } finally {
    db.close()
  }
}
