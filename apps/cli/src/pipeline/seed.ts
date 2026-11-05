/**
 * `discover --seed` (and `run --seed`, `start`): pool discovery without `eth_getLogs`, for an
 * endpoint that cannot serve factory log scans (Alchemy's free tier answers 10-block ranges only).
 * The chain reader asks each DEX for the pools of every pair of the reference tokens and the
 * configured extra tokens (`--seed-token`, DEPTHWATCH_SEED_TOKENS) at the head
 * (`ChainReader.seedPools`, about a dozen multicalls) and finds each new pool's creation block by
 * binary search over archive state (about 26 to 28 requests per pool, the log2 of the height,
 * which grows 432,000 blocks a day since Denim). Pools already in the database
 * keep their stored creation block and cost no search, so a rerun costs only the factory reads.
 *
 * Pools are upserted as the search completes each batch, so a failed or interrupted seed resumes
 * with the pools it had not dated yet; rate-limited requests are retried with backoff, each one
 * logged as a warning. At the end `seed:<dex>:lastBlock` records the seed block of every DEX whose
 * seeder succeeded. A DEX whose factory views failed gets no marker and a warning; its pools are
 * missing, the other DEXes' are stored, and the step then fails naming it, so it is seeded again
 * (under `start`, at the next pass). The log cursors (`discover:<dex>:lastBlock`) are left alone:
 * a later log scan from an endpoint that serves wide ranges still finds every pool outside the
 * seeded pairs.
 *
 * The seed rebuilds the PoolMeta of every pool it finds, and then of every stored Aero Slipstream
 * pool it did not find (found by log discovery, or tracked with `--pool` or a mandate, outside the
 * seeded pairs: `ChainReader.refreshPoolMetas`), so a swap hook or initial fee that changed is
 * stored for every pool and the snapshot no longer fails it ("swap hook changed", "initial fee
 * enabled"). A failed re-read fails `aero-slipstream` like its seeder would. A pool that has a
 * snapshot keeps its stored fee (`pools.upsertMany`): the latest snapshot's reading.
 */
import type { SeedDexFailure, SeedDexResult } from '@depthwatch/chain'
import { type Address, type Dex, isHookedPool } from '@depthwatch/core'
import { errorMessage } from '../log.js'
import { type PipelineContext, syncKeys } from './context.js'

/** DEXes whose stored pools outside the seeded pairs a seed reads again (`refreshPoolMetas`). */
const REFRESHED_DEXES: readonly Dex[] = ['aero-slipstream']

export interface SeedStepResult {
  blockNumber: bigint
  /** Pools found (all upserted). */
  found: number
  /** Of those, pools the database did not have. */
  added: number
  /** Requests of the creation-block search. */
  searchRequests: number
  /** Stored pools the seed did not find whose PoolMeta was read again (Aero Slipstream). */
  refreshed: number
  /** The DEXes seeded (a failed one makes the step throw after storing these). */
  dexes: SeedDexResult[]
}

export interface SeedStepOptions {
  dexes?: readonly Dex[]
  /** Pools per creation-search batch (default: the chain's DEFAULT_SEED_BATCH). */
  batchSize?: number
}

export async function seedStep(
  ctx: PipelineContext,
  opts: SeedStepOptions = {},
): Promise<SeedStepResult> {
  const { db, chain, log } = ctx
  const dexes = opts.dexes ?? ctx.config.dexes
  const tokens = [
    ...new Set<Address>([
      ...chain.addresses.referenceTokens.map((t) => t.address),
      ...ctx.config.seedTokens,
    ]),
  ]
  log.info('seeding from factory views', {
    dexes: dexes.join(','),
    tokens: tokens.length,
    ...(ctx.config.seedTokens.length > 0 ? { extra: ctx.config.seedTokens.join(',') } : {}),
  })
  let added = 0
  const result = await chain.seedPools({
    dexes,
    tokens,
    knownCreatedAt: (id) => db.pools.get(id)?.createdAtBlock,
    concurrency: ctx.config.concurrency,
    batchSize: opts.batchSize,
    onPools: (pools, progress) => {
      added += pools.filter((pool) => db.pools.get(pool.id) === undefined).length
      db.pools.upsertMany(pools)
      if (progress.total > 0 && progress.done > 0)
        log.info('creation blocks found', {
          pools: `${progress.done}/${progress.total}`,
          requests: progress.requests,
        })
    },
    onSearchRound: (p) =>
      log.debug('creation-block search', {
        round: `${p.round}/${p.rounds}`,
        open: p.open,
        requests: p.requests,
      }),
    onRetry: (event) =>
      log.warn('rpc backoff', {
        reason: event.reason,
        retry: `${event.attempt}/${event.retries}`,
        delayMs: event.delayMs,
        request: event.what,
      }),
  })
  const refresh = await refreshStored(
    ctx,
    result.dexes.map((d) => d.dex),
    new Set(result.pools.map((p) => p.id)),
  )
  const failed = [...result.failed, ...refresh.failed]
  const seeded = result.dexes.filter((d) => !failed.some((f) => f.dex === d.dex))
  db.transaction(() => {
    for (const d of seeded) db.syncState.setBigInt(syncKeys.seed(d.dex), result.blockNumber)
  })
  // Planner statistics for the pools written, so the feeds search the scored set, not every pool.
  db.analyze()
  for (const d of seeded)
    log.info('seeded', {
      dex: d.dex,
      candidates: d.candidates,
      found: d.found,
      searched: d.searched,
      total: db.pools.count({ dex: d.dex }),
    })
  for (const f of failed) log.warn('seed failed', { dex: f.dex, error: f.error })
  if (failed.length > 0)
    throw new Error(
      `seeding failed for ${failed.map((f) => f.dex).join(', ')} ` +
        `(${result.pools.length} pools of the other DEXes stored): ${failed[0]?.error}`,
    )
  return {
    blockNumber: result.blockNumber,
    found: result.pools.length,
    added,
    searchRequests: result.searchRequests,
    refreshed: refresh.refreshed,
    dexes: result.dexes,
  }
}

/**
 * The stored pools of the seeded `REFRESHED_DEXES` that the seed did not find, read again and
 * upserted; a pool whose `hooks` changed is logged. A DEX whose re-read fails is a failure.
 */
async function refreshStored(
  ctx: PipelineContext,
  seeded: readonly Dex[],
  found: ReadonlySet<string>,
): Promise<{ refreshed: number; failed: SeedDexFailure[] }> {
  const { db, chain, log } = ctx
  let refreshed = 0
  const failed: SeedDexFailure[] = []
  for (const dex of REFRESHED_DEXES.filter((d) => seeded.includes(d))) {
    const stored = db.pools.list({ dex }).filter((p) => !found.has(p.id))
    if (stored.length === 0) continue
    try {
      const pools = await chain.refreshPoolMetas(stored)
      db.pools.upsertMany(pools)
      refreshed += pools.length
      const before = new Map(stored.map((p) => [p.id, p.hooks]))
      for (const pool of pools)
        if (pool.hooks !== before.get(pool.id))
          log.info('pool configuration read again', { pool: pool.id, hooked: isHookedPool(pool) })
      log.info('stored pools read again', { dex, stored: stored.length, refreshed: pools.length })
    } catch (error) {
      failed.push({ dex, error: errorMessage(error) })
    }
  }
  return { refreshed, failed }
}
