/**
 * `discover`: incremental factory / PoolManager log scan per DEX, in windows of
 * `DISCOVER_WINDOW_CHUNKS` log chunks. After each window the pools it found are upserted and the
 * cursor `discover:<dex>:lastBlock` in sync_state advances to the window's last block, in one
 * transaction, so a first scan of tens of millions of blocks (about 52 M for Uniswap v3 at Denim's
 * activation, and 432 000 more a day since) that fails after hours resumes at the failed window
 * on the next run instead of starting over. `--from-block` restarts the scan at that block for this
 * run (a rescan upserts, so it is always safe); the cursor only ever moves forward, so a rescan
 * below it that fails part-way leaves it where it was.
 *
 * With `budgetMs` (`depthwatch start`) the step starts no further window once the budget is spent
 * (the window in flight finishes) and reports `complete: false`; the next pass resumes at the
 * cursors. DEXes are scanned in order, so a long first scan finishes one DEX before the next.
 *
 * A logs endpoint that cannot serve usable ranges (LogRangeLimitError) stops the step at once,
 * whatever the remaining DEXes: they would fail the same way. `discover --seed` (./seed.ts) needs
 * no logs at all.
 */
import { type ChainAddresses, isLogRangeLimitError } from '@depthwatch/chain'
import { type Dex, minBigint } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import { errorMessage, type Logger } from '../log.js'
import { type PipelineContext, StepBudget, syncKeys, throwIfStopped } from './context.js'

/**
 * Log chunks per window: 100 000 blocks at the CLI's 2 000-block chunks (about 2.3 days of Base's
 * 2 s blocks before Denim, block 53 556 127; 5.6 h of its 200 ms blocks since), so 50
 * `eth_getLogs` per factory per window, typically under a minute against a public endpoint (as
 * measured on 2 s blocks). A failure loses at most one window; a first scan of Uniswap v3's
 * 52 M blocks to Denim's activation logs about 520 windows, and every day since adds 4.32 more.
 */
export const DISCOVER_WINDOW_CHUNKS = 50

/**
 * More `eth_getLogs` per DEX than this and the scan logs a warning first: 5 000 requests take
 * about 17 minutes at the 5 requests a second Base's public endpoint allows per IP. 5 000 chunks of
 * 2 000 blocks are 10 M blocks: 231 days of 2 s blocks, 23 days of the 200 ms blocks Base makes
 * since Denim, so a cursor that far behind warns too. A first scan of Base at 2 000-block chunks
 * needs up to about 26 000 per DEX at Denim's activation (about 97 000 in all on 2026-10-28,
 * docs/ROADMAP.md) and about 216 more per factory every day since (432 000 blocks a day); at a free
 * tier's 10-block chunks, up to about 5.2 M per DEX, and 43 200 more per factory a day.
 */
export const DISCOVER_WARN_CHUNKS = 5_000n

export interface DiscoverDexResult {
  dex: Dex
  fromBlock: bigint
  toBlock: bigint
  /** Pools found in the range (upserted). */
  found: number
  /** Windows completed (each one upserted and advanced the cursor). */
  windows: number
  /** True when the cursor was already at the chain head. */
  skipped: boolean
  /** True when the cursor reached the head (false: the budget ran out first). */
  complete: boolean
}

export interface DiscoverResult {
  blockNumber: bigint
  dexes: DiscoverDexResult[]
  found: number
  /** True when every DEX reached the head; false when the budget ran out first. */
  complete: boolean
  /** DEXes whose scan failed; the next run resumes after `cursor` (undefined: from the start). */
  failed: Array<{ dex: Dex; error: string; cursor: bigint | undefined }>
}

export interface DiscoverOptions {
  dexes?: readonly Dex[]
  fromBlock?: bigint
  /** Log chunks per window (default DISCOVER_WINDOW_CHUNKS). */
  windowChunks?: number
  /** Milliseconds for elapsed time, ETA and the budget (default `performance.now`). */
  clockMs?: () => number
  /** Milliseconds after which no further window starts (the first always does); unset: none. */
  budgetMs?: number
}

/**
 * First block worth scanning for a DEX: its factory deployment (the earliest deployment for both
 * Slipstreams; for Aero v2 the earlier of its two factories).
 */
export function defaultStartBlock(addresses: ChainAddresses, dex: Dex): bigint {
  switch (dex) {
    case 'uniswap-v3':
      return addresses.uniswapV3.startBlock
    case 'uniswap-v4':
      return addresses.uniswapV4.startBlock
    case 'aerodrome-v2':
      return addresses.aerodromeV2.startBlock
    case 'aerodrome-slipstream':
      return earliestStart(addresses.aerodromeSlipstream)
    case 'aero-v2':
      return addresses.aeroV2.startBlock
    case 'aero-slipstream':
      return earliestStart(addresses.aeroSlipstream)
  }
}

function earliestStart(deployments: readonly { startBlock: bigint }[]): bigint {
  const starts = deployments.map((d) => d.startBlock)
  return starts.length === 0 ? 0n : starts.reduce((min, b) => minBigint(min, b))
}

export function resolveFromBlock(ctx: PipelineContext, dex: Dex, override?: bigint): bigint {
  if (override !== undefined) return override
  const cursor = ctx.db.syncState.getBigInt(syncKeys.discover(dex))
  if (cursor !== undefined) return cursor + 1n
  return defaultStartBlock(ctx.chain.addresses, dex)
}

/** `12s`, `4m05s`, `3h07m`. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const pad = (n: number) => String(n).padStart(2, '0')
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`
  return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}m`
}

/** Moves the cursor to `block` unless it is already further along. */
function advanceCursor(db: Database, dex: Dex, block: bigint): void {
  const current = db.syncState.getBigInt(syncKeys.discover(dex))
  if (current === undefined || block > current)
    db.syncState.setBigInt(syncKeys.discover(dex), block)
}

interface ScanRange {
  dex: Dex
  fromBlock: bigint
  toBlock: bigint
  windowBlocks: bigint
}

/** Scans one DEX window by window; returns pools found, windows completed and whether it ended. */
async function scanDex(
  ctx: PipelineContext,
  range: ScanRange,
  clockMs: () => number,
  budget: StepBudget,
  log: Logger,
): Promise<{ found: number; windows: number; complete: boolean }> {
  const { db, chain } = ctx
  const { dex, fromBlock, toBlock, windowBlocks } = range
  const total = toBlock - fromBlock + 1n
  const windows = (total + windowBlocks - 1n) / windowBlocks
  const started = clockMs()
  let found = 0
  let index = 0n
  for (let start = fromBlock; start <= toBlock; start += windowBlocks) {
    if (budget.spent) {
      log.info('budget spent; the next pass resumes here', { dex, cursor: start - 1n })
      return { found, windows: Number(index), complete: false }
    }
    budget.use()
    const end = minBigint(start + windowBlocks - 1n, toBlock)
    const pools = await chain.discoverPools(dex, start, end)
    db.transaction(() => {
      db.pools.upsertMany(pools)
      advanceCursor(db, dex, end)
    })
    found += pools.length
    index++
    const done = end - fromBlock + 1n
    const elapsed = clockMs() - started
    // Basis points keep the ratio in bigint; the ETA assumes the rest goes at the same pace.
    const bps = Number((done * 10_000n) / total)
    const eta = done === total ? 0 : (elapsed * Number(total - done)) / Number(done)
    log.info('window', {
      dex,
      window: `${index}/${windows}`,
      fromBlock: start,
      toBlock: end,
      blocks: `${done}/${total}`,
      pct: `${(bps / 100).toFixed(1)}%`,
      pools: found,
      elapsed: formatDuration(elapsed),
      eta: formatDuration(eta),
    })
  }
  return { found, windows: Number(index), complete: true }
}

export async function discoverStep(
  ctx: PipelineContext,
  opts: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const { db, chain, log } = ctx
  const dexes = opts.dexes ?? ctx.config.dexes
  const override = opts.fromBlock ?? ctx.config.fromBlock
  const chunk = BigInt(ctx.config.logChunkSize)
  const windowBlocks = chunk * BigInt(opts.windowChunks ?? DISCOVER_WINDOW_CHUNKS)
  if (windowBlocks <= 0n) throw new RangeError('discover window must be positive')
  const clockMs = opts.clockMs ?? (() => performance.now())
  const budget = new StepBudget(opts.budgetMs, clockMs)
  const latest = await chain.getLatestBlock()
  const result: DiscoverResult = {
    blockNumber: latest.number,
    dexes: [],
    found: 0,
    complete: true,
    failed: [],
  }

  for (const dex of dexes) {
    const fromBlock = resolveFromBlock(ctx, dex, override)
    const toBlock = latest.number
    if (fromBlock > toBlock) {
      log.info('up to date', { dex, cursor: fromBlock - 1n, head: toBlock })
      result.dexes.push({
        dex,
        fromBlock,
        toBlock,
        found: 0,
        windows: 0,
        skipped: true,
        complete: true,
      })
      continue
    }
    if (budget.spent) {
      log.info('budget spent; the next pass scans this DEX', { dex, cursor: fromBlock - 1n })
      result.dexes.push({
        dex,
        fromBlock,
        toBlock,
        found: 0,
        windows: 0,
        skipped: false,
        complete: false,
      })
      result.complete = false
      continue
    }
    const blocks = toBlock - fromBlock + 1n
    const chunks = (blocks + chunk - 1n) / chunk
    log.info('scanning', {
      dex,
      fromBlock,
      toBlock,
      blocks,
      chunks,
      windows: (blocks + windowBlocks - 1n) / windowBlocks,
    })
    if (chunks > DISCOVER_WARN_CHUNKS)
      log.warn('this scan needs one eth_getLogs per factory per chunk', {
        dex,
        chunks,
        logChunk: chunk,
        fix: 'DEPTHWATCH_LOGS_RPC_URL to an endpoint that accepts larger ranges, then a larger DEPTHWATCH_LOG_CHUNK',
        alternative: 'discover --seed finds the reference-token pools without eth_getLogs',
      })
    try {
      const range = { dex, fromBlock, toBlock, windowBlocks }
      const scan = await scanDex(ctx, range, clockMs, budget, log)
      result.dexes.push({ dex, fromBlock, toBlock, ...scan, skipped: false })
      result.found += scan.found
      if (!scan.complete) result.complete = false
      log.info('upserted pools', { dex, found: scan.found, total: db.pools.count({ dex }) })
    } catch (error) {
      // A stop (`depthwatch start`) is not a failed scan: the windows done are stored already.
      throwIfStopped(ctx)
      if (isLogRangeLimitError(error)) {
        log.warn('the logs endpoint cannot serve factory log scans', {
          dex,
          alternative: 'discover --seed finds the reference-token pools without eth_getLogs',
        })
        throw error
      }
      const message = errorMessage(error)
      const cursor = db.syncState.getBigInt(syncKeys.discover(dex))
      result.failed.push({ dex, error: message, cursor })
      log.error('discovery failed; the next run resumes after the cursor', {
        dex,
        cursor: cursor ?? null,
        head: toBlock,
        error: message,
      })
    }
  }

  // Planner statistics for the pools written, so the feeds search the scored set, not every pool.
  db.analyze()
  if (result.failed.length > 0) {
    const names = result.failed.map((f) => `${f.dex} (${f.error})`).join('; ')
    throw new Error(`discover failed for ${result.failed.length}/${dexes.length} dexes: ${names}`)
  }
  return result
}
