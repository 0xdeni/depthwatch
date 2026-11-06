/**
 * `positions`: LP positions of every tracked concentrated pool, for owner concentration, and of
 * every concentrated pool with an active mandate, for market-maker attribution. Mandated pools are
 * indexed whether or not they are tracked yet: the snapshot tracks them whatever their rank, and
 * its samples read these positions; until a pool's positions are published (`positionsPublished`)
 * the snapshot does not sample its mandates (an attribution failure, mm.ts, never a false
 * `noLiquidity` breach); `depthwatch run` runs this step for the mandated pools before every
 * snapshot (`mandatedConcentratedPools`) and `depthwatch start` as soon as such a pool exists
 * (`unindexedMandatedPools`).
 *
 * `readPositions` is range based (positions *touched* in the block range, with their current
 * liquidity and owner), so the first run scans from the pool's creation block and later runs
 * continue from the cursor `positions:<pool>:lastBlock`, merging into the stored set. Positions
 * whose liquidity dropped to zero are removed. v2 pools (Aerodrome and Aero) have no positions;
 * Aero Slipstream pools are read through their own NFPM like Aerodrome's.
 *
 * Windowed runs (`windowBlocks`, what `depthwatch start` uses) bound the work: pools less than a
 * window behind the head read from their cursors to the head, as above; pools further behind are
 * read in shared windows of `windowBlocks` from the oldest cursor, so all the pools of a position
 * manager share one log scan and one set of `positions()` reads per window (the reader caches the
 * latest range per manager). A first scan that ends a window short of the head is kept under
 * `positionsStagingId(pool)` with the cursor `positions:<pool>:catchUpBlock`, unpublished, and
 * becomes the pool's position set once a window reaches the head, so the snapshot never computes
 * owner concentration from half a history. A mandated pool whose positions are not published yet
 * joins the pools near the head instead: it reads from its own cursor (its creation block) to the
 * head on its own range, as the unwindowed command does, so its scorecard has positions after one
 * run. Once `budgetMs` is spent no further round or pool starts; the next run resumes from the
 * cursors. A stop signal (`depthwatch start`) starts no further pool and ends the run.
 *
 * A logs endpoint that cannot serve the configured chunk (LogRangeLimitError) fails every pool the
 * same way, so after the first one no further pool is started and the step throws that one error:
 * only the pools already in flight (`concurrency`) send a request.
 */
import { isLogRangeLimitError } from '@depthwatch/chain'
import { minBigint, type PoolMeta, type Position } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import { errorMessage } from '../log.js'
import { type PipelineContext, StepBudget, settleConcurrent, syncKeys } from './context.js'

/**
 * Blocks per catch-up window of `depthwatch start`, a request budget: 250 requests at 2 000-block
 * chunks. That is 11.6 days of Base's 2 s blocks (before Denim, block 53 556 127) and about 28 h
 * of its 200 ms blocks since.
 */
export const POSITIONS_WINDOW_BLOCKS = 500_000n

/** Where a pool's unfinished first scan is kept (a positions-table key, never a pool id). */
export const positionsStagingId = (poolId: string): string => `${poolId}#catch-up`

export interface PositionsPoolResult {
  poolId: string
  fromBlock: bigint
  toBlock: bigint
  /** Positions touched in the range. */
  touched: number
  /** Positions stored after the merge (staged ones while the pool catches up). */
  stored: number
  skipped: boolean
}

export interface PositionsResult {
  blockNumber: bigint
  pools: PositionsPoolResult[]
  /** Positions of the pools whose set is published (read up to a head). */
  positions: number
  failed: Array<{ item: string; error: string }>
  /** Pools still behind the head when the run ended (budget spent); 0 without a budget. */
  deferred: number
  /** Block ranges read: 1 without a window. */
  rounds: number
}

/** Stable identity of a position: the NFT id, or (owner, range) for positions without one. */
export function positionKey(position: Position): string {
  if (position.tokenId !== null) return `id:${position.tokenId}`
  return `anon:${position.owner.toLowerCase()}:${position.tickLower}:${position.tickUpper}`
}

/** `fresh` overrides `existing` by key; closed positions (liquidity 0) are dropped. */
export function mergePositions(
  existing: readonly Position[],
  fresh: readonly Position[],
): Position[] {
  const merged = new Map<string, Position>()
  for (const position of existing) merged.set(positionKey(position), position)
  for (const position of fresh) merged.set(positionKey(position), position)
  return [...merged.entries()]
    .filter(([, position]) => position.liquidity > 0n)
    .sort(([ka, a], [kb, b]) => {
      if (a.tickLower !== b.tickLower) return a.tickLower - b.tickLower
      if (a.tickUpper !== b.tickUpper) return a.tickUpper - b.tickUpper
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })
    .map(([, position]) => position)
}

export interface PositionsOptions {
  /** Pools to index instead of the default ones (non-concentrated pools are ignored). */
  pools?: readonly PoolMeta[]
  /** Catch-up window in blocks (see the header); unset, every pool reads to the head at once. */
  windowBlocks?: bigint
  /** Milliseconds after which no further round or pool starts (the first pool always does). */
  budgetMs?: number
  /** Milliseconds for the budget (default `performance.now`). */
  clockMs?: () => number
}

/** The known pools of the active mandates, each once (a pool not discovered yet is left out). */
function mandatedPools(db: Database): PoolMeta[] {
  const out = new Map<string, PoolMeta>()
  for (const mandate of db.mandates.list({ active: true })) {
    const pool = db.pools.get(mandate.poolId)
    if (pool !== undefined) out.set(pool.id, pool)
  }
  return [...out.values()]
}

/**
 * The pools `positions` indexes by default: the tracked ones, then the known pools of active
 * mandates that are not tracked (yet). A mandate on a pool not discovered yet adds nothing; the
 * snapshot logs it.
 */
export function defaultPositionPools(db: Database): PoolMeta[] {
  const pools = db.pools.list({ tracked: true })
  const ids = new Set(pools.map((pool) => pool.id))
  for (const pool of mandatedPools(db)) {
    if (ids.has(pool.id)) continue
    ids.add(pool.id)
    pools.push(pool)
  }
  return pools
}

/** True once the pool's positions are published: its cursor exists (a staged first scan is not). */
export function positionsPublished(db: Database, poolId: string): boolean {
  return db.syncState.get(syncKeys.positions(poolId)) !== undefined
}

/** The known concentrated pools of the active mandates: what `run` indexes before every snapshot. */
export function mandatedConcentratedPools(db: Database): PoolMeta[] {
  return mandatedPools(db).filter((pool) => pool.kind === 'concentrated')
}

/**
 * Concentrated pools of active mandates whose positions are not published yet: their mandates
 * cannot be sampled (mm.ts), so `depthwatch start` runs positions while there is one.
 */
export function unindexedMandatedPools(db: Database): PoolMeta[] {
  return mandatedConcentratedPools(db).filter((pool) => !positionsPublished(db, pool.id))
}

/** Where a pool stands: its published cursor, its staged first scan, or nothing yet. */
interface PoolPlan {
  pool: PoolMeta
  next: bigint
  mode: 'cursor' | 'staged' | 'new'
}

function planOf(db: Database, pool: PoolMeta): PoolPlan {
  const cursor = db.syncState.getBigInt(syncKeys.positions(pool.id))
  if (cursor !== undefined) return { pool, next: cursor + 1n, mode: 'cursor' }
  const staged = db.syncState.getBigInt(syncKeys.positionsCatchUp(pool.id))
  if (staged !== undefined) return { pool, next: staged + 1n, mode: 'staged' }
  return { pool, next: pool.createdAtBlock, mode: 'new' }
}

interface Round {
  /** Shared start of the range; undefined: each pool from its own `next`. */
  fromBlock: bigint | undefined
  toBlock: bigint
  plans: PoolPlan[]
}

/**
 * The next round over the `open` pools (all behind `head`); see the header. `own` pools (mandated,
 * unpublished) read to the head on their own range whatever their distance from it.
 */
function nextRound(
  open: readonly PoolPlan[],
  head: bigint,
  window: bigint | undefined,
  own: ReadonlySet<string>,
): Round {
  if (window === undefined) return { fromBlock: undefined, toBlock: head, plans: [...open] }
  const near = open.filter((plan) => head - plan.next < window || own.has(plan.pool.id))
  if (near.length > 0) return { fromBlock: undefined, toBlock: head, plans: near }
  const fromBlock = open.reduce((min, plan) => minBigint(min, plan.next), head)
  const toBlock = minBigint(fromBlock + window - 1n, head)
  return { fromBlock, toBlock, plans: open.filter((plan) => plan.next <= toBlock) }
}

/** True when a read of `plan` up to `toBlock` publishes the pool's set (see `store`). */
function publishes(plan: PoolPlan, toBlock: bigint, head: bigint): boolean {
  return plan.mode === 'cursor' || toBlock >= head
}

/** The pool's custodians as `positions` last recorded them (lowercase; [] when none). */
export function storedCustodians(db: Database, poolId: string): string[] {
  const value = db.syncState.get(syncKeys.positionsCustodians(poolId))
  return value === undefined || value === '' ? [] : value.split(',')
}

/**
 * Merges `fresh` into the pool's set and moves its cursor; publishes once it reaches `head`, with
 * the pool's `custodians` read at that head. The stored set is read inside the write transaction,
 * so a set another process stored meanwhile is merged rather than overwritten.
 */
function store(
  db: Database,
  plan: PoolPlan,
  fresh: readonly Position[],
  toBlock: bigint,
  head: bigint,
  custodians: readonly string[],
): { stored: number; published: boolean } {
  const { pool, mode } = plan
  const staging = positionsStagingId(pool.id)
  const existingId = mode === 'cursor' ? pool.id : mode === 'staged' ? staging : undefined
  const published = publishes(plan, toBlock, head)
  return db.transaction(() => {
    const merged = mergePositions(existingId ? db.positions.forPool(existingId) : [], fresh)
    if (published) {
      db.positions.replaceForPool(pool.id, merged, { updatedBlock: toBlock })
      db.syncState.setBigInt(syncKeys.positions(pool.id), toBlock)
      const custodiansKey = syncKeys.positionsCustodians(pool.id)
      if (custodians.length > 0) db.syncState.set(custodiansKey, custodians.join(','))
      else db.syncState.delete(custodiansKey)
      if (mode === 'staged') {
        db.positions.deleteForPool(staging)
        db.syncState.delete(syncKeys.positionsCatchUp(pool.id))
      }
    } else {
      db.positions.replaceForPool(staging, merged, { updatedBlock: toBlock })
      db.syncState.setBigInt(syncKeys.positionsCatchUp(pool.id), toBlock)
    }
    return { stored: merged.length, published }
  })
}

/** Thrown for a pool the spent budget did not start: deferred, not failed. */
const DEFERRED = Symbol('deferred')

export async function positionsStep(
  ctx: PipelineContext,
  opts: PositionsOptions = {},
): Promise<PositionsResult> {
  const { db, chain, log, config } = ctx
  const window = opts.windowBlocks
  if (window !== undefined && window <= 0n)
    throw new RangeError('positions window must be positive')
  const latest = await chain.getLatestBlock()
  const head = latest.number
  const candidates = opts.pools ?? defaultPositionPools(db)
  const pools = candidates.filter((pool) => pool.kind === 'concentrated')
  const result: PositionsResult = {
    blockNumber: head,
    pools: [],
    positions: 0,
    failed: [],
    deferred: 0,
    rounds: 0,
  }
  if (pools.length === 0) {
    log.warn('no tracked or mandated concentrated pools; run snapshot first')
    return result
  }
  log.info('reading positions', { pools: pools.length, block: head })

  const own = new Set(unindexedMandatedPools(db).map((pool) => pool.id))
  const budget = new StepBudget(opts.budgetMs, opts.clockMs ?? (() => performance.now()))
  const byPool = new Map<string, PositionsPoolResult>()
  const published = new Set<string>()
  const failedIds = new Set<string>()
  let unusable: unknown
  for (const pool of pools) {
    const plan = planOf(db, pool)
    if (plan.next <= head) continue
    if (plan.mode === 'cursor') published.add(pool.id)
    const stored = db.positions.countForPool(pool.id)
    const entry = { poolId: pool.id, fromBlock: plan.next, toBlock: head, touched: 0, stored }
    byPool.set(pool.id, { ...entry, skipped: true })
  }

  const openPlans = () =>
    pools
      .filter((pool) => !failedIds.has(pool.id))
      .map((pool) => planOf(db, pool))
      .filter((plan) => plan.next <= head)
  for (let open = openPlans(); open.length > 0 && !budget.spent; open = openPlans()) {
    const round = nextRound(open, head, window, own)
    result.rounds++
    const settled = await settleConcurrent(
      round.plans,
      config.concurrency,
      (plan) => plan.pool.id,
      async (plan) => {
        if (unusable !== undefined) throw unusable
        if (budget.spent) throw DEFERRED
        budget.use()
        const fromBlock = round.fromBlock ?? plan.next
        const fresh = await chain
          .readPositions(plan.pool, { fromBlock, toBlock: round.toBlock })
          .catch((error) => {
            if (isLogRangeLimitError(error)) unusable ??= error
            throw error
          })
        // A Slipstream gauge (Aerodrome or Aero) holds the staked NFTs: recorded with the set.
        const custodians = publishes(plan, round.toBlock, head)
          ? await chain.readCustodians(plan.pool, round.toBlock)
          : []
        const { stored, published: isPublished } = store(
          db,
          plan,
          fresh,
          round.toBlock,
          head,
          custodians,
        )
        if (isPublished) published.add(plan.pool.id)
        log.debug('positions merged', { pool: plan.pool.id, touched: fresh.length, stored })
        const before = byPool.get(plan.pool.id)
        byPool.set(plan.pool.id, {
          poolId: plan.pool.id,
          fromBlock: before?.fromBlock ?? fromBlock,
          toBlock: round.toBlock,
          touched: (before?.touched ?? 0) + fresh.length,
          stored,
          skipped: false,
        })
      },
      ctx.signal,
    )
    // An endpoint that only serves tiny log ranges fails every pool the same way: one error.
    if (unusable !== undefined) throw unusable
    for (const failure of settled.failed) {
      if (failure.error === DEFERRED) continue
      failedIds.add(failure.item)
      const error = errorMessage(failure.error)
      result.failed.push({ item: failure.item, error })
      log.warn('readPositions failed', { pool: failure.item, error })
    }
    if (window === undefined) break
  }

  result.pools = [...byPool.values()]
  result.positions = result.pools
    .filter((entry) => published.has(entry.poolId))
    .reduce((n, entry) => n + entry.stored, 0)
  result.deferred = openPlans().length
  log.info('stored positions', {
    pools: result.pools.length,
    positions: result.positions,
    failed: result.failed.length,
    deferred: result.deferred,
  })
  return result
}
