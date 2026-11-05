/**
 * `volume`: Swap events of every tracked pool over the last N hours, bucketed per hour.
 *
 * The window runs from the first block of the hour N hours before the head (`ChainReader
 * .blockAtOrAfter`: Base's block schedule confirmed by headers, so 2 s blocks before Denim and
 * 200 ms blocks after it are both exact; a day is 432 000 blocks of 200 ms), so its first hour
 * bucket is complete and nothing before it is read. USD volume counts |amount| of one priced side per swap — the USD stablecoin side when there is
 * one, else token1 (the quote), else token0 — valued with the prices the snapshot step stored.
 *
 * Incremental: each pool's coverage (`volume:<pool>:lastBlock`, the last block in its buckets, and
 * `volume:<pool>:fromTs`, the first hour from which they are complete) lets the next pass start at
 * the first block of the hour that holds `lastBlock` (its header's hour, then `blockAtOrAfter`):
 * that hour, cut short by the last pass, comes back complete, the hours
 * before it are kept as stored, and a pass costs the blocks since that hour instead of the whole
 * window. A pool without coverage of the window (newly tracked, `--hours` wider than before, or
 * coverage older than the window) gets the whole window. Each log scan (one per `Swap` event
 * source: Uniswap v3 and both Slipstreams share one, Aerodrome v2 and Aero v2 another) is read
 * once, from the earliest start of its pools, since a log request costs the same for one pool or
 * many. The kept buckets of the window are revalued from their token totals at the current
 * prices, so every hour of the window is valued alike, as a full rescan would. The head's
 * timestamp is stored (`volume:lastTs`): it anchors the score's 24 h window. Every 30 s: blocks
 * and chunks done/total, %, elapsed, ETA, backoffs. A stop signal (`depthwatch start`) ends the
 * scan and stores nothing.
 */
import {
  BASE_DENIM_BLOCK,
  type SwapScanProgress,
  swapScanGroups,
  swapScanOf,
} from '@depthwatch/chain'
import type { Address, Dex, PoolMeta, SwapEvent, VolumeBucket } from '@depthwatch/core'
import { maxBigint, minBigint, rawToHuman } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import { HOUR_SECONDS, type PipelineContext, syncKeys, throwIfStopped } from './context.js'
import { chunkProgress, createProgressReporter } from './progress.js'

/**
 * The `volume:windows` mark of coverage stored by a pass that finds its blocks by time. Coverage
 * that ends at or after Denim's first block without it was written by a version that counted
 * 2 s blocks after Denim: its hours are short, so those pools read their whole window once more.
 */
export const VOLUME_WINDOWS_BY_TIME = 'by-time'

export interface VolumeOptions {
  hours?: number
  /** Milliseconds, for the progress lines (default `Date.now`); tests pass a fake clock. */
  clock?: () => number
  /** Gap between progress lines (default PROGRESS_INTERVAL_MS, 30 s). */
  progressIntervalMs?: number
}

export interface VolumeResult {
  /** First block read (the earliest start of any DEX). */
  fromBlock: bigint
  toBlock: bigint
  /** First hour bucket kept (unix seconds), over every pool. */
  fromTs: number
  pools: number
  /** Pools continued from their coverage instead of reading the whole window. */
  incremental: number
  swaps: number
  /** Swaps without a timestamp or before their pool's first kept hour. */
  dropped: number
  buckets: number
  /** Tracked pools with no priced side (their buckets carry null USD). */
  unpricedPools: number
}

export interface PricedSide {
  /** 0 = token0, 1 = token1. */
  side: 0 | 1
  usd: number
  decimals: number
}

export type UsdLookup = (token: Address) => number | null

/** The side whose amounts are converted to USD: stablecoin > token1 > token0, priced ones only. */
export function pricedSide(
  pool: PoolMeta,
  usd: UsdLookup,
  anchors: Readonly<Record<string, number>>,
): PricedSide | null {
  const candidates: PricedSide[] = []
  for (const [side, token] of [
    [1, pool.token1],
    [0, pool.token0],
  ] as const) {
    const price = usd(token.address)
    if (price !== null && Number.isFinite(price) && price > 0)
      candidates.push({ side, usd: price, decimals: token.decimals })
  }
  const isAnchor = (c: PricedSide) =>
    Object.hasOwn(anchors, (c.side === 1 ? pool.token1 : pool.token0).address.toLowerCase())
  return candidates.find(isAnchor) ?? candidates[0] ?? null
}

/** Smallest of `values` by a loop (a spread call overflows on long lists), else `fallback`. */
function earliest(values: readonly number[], fallback: number): number {
  let min: number | undefined
  for (const value of values) if (min === undefined || value < min) min = value
  return min ?? fallback
}

export function hourStartOf(timestamp: number): number {
  return Math.floor(timestamp / HOUR_SECONDS) * HOUR_SECONDS
}

const abs = (x: bigint): bigint => (x < 0n ? -x : x)

/** USD value of a bucket: the priced side's |amount| summed over the hour, at `side.usd`. */
export function bucketUsd(
  bucket: Pick<VolumeBucket, 'volumeToken0' | 'volumeToken1'>,
  side: PricedSide,
): number {
  const amount = side.side === 1 ? bucket.volumeToken1 : bucket.volumeToken0
  return rawToHuman(amount, side.decimals) * side.usd
}

export interface BucketedSwaps {
  buckets: VolumeBucket[]
  dropped: number
}

/**
 * Hourly buckets from swaps (half-open hours), keeping swaps with `timestamp ≥ fromTs` (one hour
 * for every pool, or one per pool id).
 */
export function bucketSwaps(
  swaps: readonly SwapEvent[],
  pools: ReadonlyMap<string, PoolMeta>,
  sideFor: (pool: PoolMeta) => PricedSide | null,
  fromTs: number | ((poolId: string) => number),
): BucketedSwaps {
  const buckets = new Map<string, VolumeBucket>()
  const sides = new Map<string, PricedSide | null>()
  const keepFrom = typeof fromTs === 'number' ? () => fromTs : fromTs
  let dropped = 0
  for (const swap of swaps) {
    const pool = pools.get(swap.poolId)
    if (pool === undefined || swap.timestamp === null || swap.timestamp < keepFrom(swap.poolId)) {
      dropped++
      continue
    }
    const hourStart = hourStartOf(swap.timestamp)
    const key = `${swap.poolId}:${hourStart}`
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = {
        poolId: swap.poolId,
        hourStart,
        volumeToken0: 0n,
        volumeToken1: 0n,
        volumeUsd: null,
        swapCount: 0,
      }
      buckets.set(key, bucket)
    }
    bucket.volumeToken0 += abs(swap.amount0)
    bucket.volumeToken1 += abs(swap.amount1)
    bucket.swapCount += 1
    if (!sides.has(pool.id)) sides.set(pool.id, sideFor(pool))
  }
  for (const bucket of buckets.values()) {
    const side = sides.get(bucket.poolId) ?? null
    bucket.volumeUsd = side === null ? null : bucketUsd(bucket, side)
  }
  const sorted = [...buckets.values()].sort((a, b) =>
    a.poolId !== b.poolId ? (a.poolId < b.poolId ? -1 : 1) : a.hourStart - b.hourStart,
  )
  return { buckets: sorted, dropped }
}

/** What one pool's buckets hold: blocks up to `lastBlock`, complete from hour `fromTs` on. */
export interface VolumeCoverage {
  lastBlock: bigint
  fromTs: number
}

/** Where one pool's scan starts, and the hours it rewrites. */
export interface VolumeScan {
  /** First block to read. */
  fromBlock: bigint
  /** Swaps before this hour are dropped: the stored buckets of earlier hours are complete. */
  keepFromTs: number
  /** First hour of the pool's complete buckets once this scan is stored. */
  coveredFromTs: number
}

/** The hour that holds a pool's `lastBlock` (its header's) and that hour's first block. */
export interface CoverageHour {
  hour: number
  firstBlock: bigint
}

/**
 * The scan of one pool for the window `{ fromBlock, fromTs }` (see the header): the whole window,
 * or, when `coverage` reaches back to the window's first hour, from `start`, the hour of its
 * `lastBlock` (`coverageHour`).
 */
export function planVolumeScan(
  window: { fromBlock: bigint; fromTs: number },
  coverage: VolumeCoverage | undefined,
  start: CoverageHour | undefined,
): VolumeScan {
  const whole = {
    fromBlock: window.fromBlock,
    keepFromTs: window.fromTs,
    coveredFromTs: window.fromTs,
  }
  if (coverage === undefined || coverage.fromTs > window.fromTs) return whole
  if (start === undefined || start.hour <= window.fromTs) return whole
  return {
    fromBlock: maxBigint(window.fromBlock, start.firstBlock),
    keepFromTs: start.hour,
    coveredFromTs: coverage.fromTs,
  }
}

/**
 * `start` for `planVolumeScan`: the hour of `lastBlock` (capped at the head: a lagging node) and its
 * first block, or undefined when the block lies before the window (then the whole window is read).
 */
export async function coverageHour(
  chain: PipelineContext['chain'],
  window: { fromBlock: bigint; fromTs: number },
  head: { number: bigint },
  lastBlock: bigint,
): Promise<CoverageHour | undefined> {
  const last = minBigint(lastBlock, head.number)
  if (last < window.fromBlock) return undefined
  const hour = hourStartOf(await chain.getBlockTimestamp(last))
  if (hour <= window.fromTs) return undefined
  return { hour, firstBlock: await chain.blockAtOrAfter(hour, head.number) }
}

function coverageOf(db: Database, poolId: string, byTime: boolean): VolumeCoverage | undefined {
  const lastBlock = db.syncState.getBigInt(syncKeys.volumeLastBlock(poolId))
  const fromTs = db.syncState.get(syncKeys.volumeFromTs(poolId))
  if (lastBlock === undefined || fromTs === undefined || !/^\d+$/.test(fromTs)) return undefined
  if (!byTime && lastBlock >= BASE_DENIM_BLOCK) return undefined
  return { lastBlock, fromTs: Number(fromTs) }
}

/**
 * The tracked pools grouped by first block: each log scan (one per `Swap` event source, see chain
 * `swapScanOf`) reads once, from its pools' earliest start.
 */
function scanGroups(
  tracked: readonly PoolMeta[],
  scans: ReadonlyMap<string, VolumeScan>,
): Array<[bigint, PoolMeta[]]> {
  const fromBySource = new Map<Dex, bigint>()
  for (const pool of tracked) {
    const from = scans.get(pool.id)?.fromBlock
    const source = swapScanOf(pool.dex)
    const current = fromBySource.get(source)
    if (from !== undefined)
      fromBySource.set(source, current === undefined ? from : minBigint(current, from))
  }
  const groups = new Map<bigint, PoolMeta[]>()
  for (const pool of tracked) {
    const from = fromBySource.get(swapScanOf(pool.dex))
    if (from !== undefined) groups.set(from, [...(groups.get(from) ?? []), pool])
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Blocks one group's scans read: `scans × (head − from + 1)`. Percent and ETA count blocks: chunks
 * shrink below `--log-chunk` on a capped endpoint, so their total is estimated (`chunkProgress`).
 */
function groupBlocks(from: bigint, pools: readonly PoolMeta[], head: bigint): bigint {
  return BigInt(swapScanGroups(pools).size) * (head - from + 1n)
}

/**
 * The stored buckets of the window that this pass does not rewrite, whose USD value changes at the
 * current prices (null for a pool without a priced side now).
 */
function revaluedBuckets(
  db: Database,
  tracked: readonly PoolMeta[],
  sideFor: (pool: PoolMeta) => PricedSide | null,
  fromTs: number,
  rewritten: readonly VolumeBucket[],
): VolumeBucket[] {
  const fresh = new Set(rewritten.map((bucket) => `${bucket.poolId}:${bucket.hourStart}`))
  const out: VolumeBucket[] = []
  for (const pool of tracked) {
    const side = sideFor(pool)
    for (const bucket of db.volume.series(pool.id, fromTs)) {
      if (fresh.has(`${bucket.poolId}:${bucket.hourStart}`)) continue
      const volumeUsd = side === null ? null : bucketUsd(bucket, side)
      if (volumeUsd !== bucket.volumeUsd) out.push({ ...bucket, volumeUsd })
    }
  }
  return out
}

export async function volumeStep(
  ctx: PipelineContext,
  opts: VolumeOptions = {},
): Promise<VolumeResult> {
  const { db, chain, log } = ctx
  const hours = opts.hours ?? ctx.config.hours
  const latest = await chain.getLatestBlock()
  const tracked = db.pools.list({ tracked: true })
  const fromTs = hourStartOf(latest.timestamp - hours * HOUR_SECONDS)
  const window = { fromBlock: await chain.blockAtOrAfter(fromTs, latest.number), fromTs }
  const starts = new Map<bigint, CoverageHour | undefined>()
  const scans = new Map<string, VolumeScan>()
  const byTime = db.syncState.get(syncKeys.volumeWindows()) === VOLUME_WINDOWS_BY_TIME
  for (const pool of tracked) {
    const coverage = coverageOf(db, pool.id, byTime)
    if (
      coverage !== undefined &&
      coverage.fromTs <= window.fromTs &&
      !starts.has(coverage.lastBlock)
    )
      starts.set(coverage.lastBlock, await coverageHour(chain, window, latest, coverage.lastBlock))
    const start = coverage === undefined ? undefined : starts.get(coverage.lastBlock)
    scans.set(pool.id, planVolumeScan(window, coverage, start))
  }
  const groups = scanGroups(tracked, scans)
  const keepFrom = (poolId: string) => scans.get(poolId)?.keepFromTs ?? window.fromTs
  const result: VolumeResult = {
    fromBlock: groups[0]?.[0] ?? window.fromBlock,
    toBlock: latest.number,
    fromTs: earliest(
      tracked.map((pool) => keepFrom(pool.id)),
      window.fromTs,
    ),
    pools: tracked.length,
    incremental: [...scans.values()].filter((scan) => scan.keepFromTs > window.fromTs).length,
    swaps: 0,
    dropped: 0,
    buckets: 0,
    unpricedPools: 0,
  }
  if (tracked.length === 0) {
    log.warn('no tracked pools; run snapshot first')
    return result
  }

  const swaps: SwapEvent[] = []
  let totalBlocks = 0n
  for (const [from, pools] of groups) totalBlocks += groupBlocks(from, pools, latest.number)
  const progress = createProgressReporter({
    log,
    message: 'swap scan progress',
    unit: 'blocks',
    total: Number(totalBlocks),
    intervalMs: opts.progressIntervalMs,
    clock: opts.clock,
  })
  // `chunkBlocks`: blocks served by chunks (a scan with no filter target serves none).
  const before = { blocks: 0n, chunkBlocks: 0n, chunks: 0, rateLimited: 0, transient: 0 }
  for (const [fromBlock, pools] of groups) {
    log.info('reading swaps', {
      pools: pools.length,
      dexes: [...new Set(pools.map((pool) => pool.dex))].join(','),
      fromBlock,
      toBlock: latest.number,
      hours,
    })
    let last: Readonly<SwapScanProgress> | undefined
    const onProgress = (p: Readonly<SwapScanProgress>) => {
      last = p
      const done = before.blocks + p.blocksDone
      progress.update(Number(done), {
        chunks: chunkProgress(
          before.chunks + p.chunks,
          Number(before.chunkBlocks + p.blocksDone),
          Number(totalBlocks - done),
          ctx.config.logChunkSize,
        ),
        rateLimited: before.rateLimited + p.rateLimited,
        transient: before.transient + p.transient,
      })
    }
    // One by one, not push(...): a day of swaps (> 125 000 on Base) overflows the call stack.
    for (const swap of await chain.readSwaps(pools, fromBlock, latest.number, { onProgress }))
      swaps.push(swap)
    // The whole group, not `last.blocksDone`: a scan with no filter target returns at once.
    before.blocks += groupBlocks(fromBlock, pools, latest.number)
    before.chunkBlocks += last?.blocksDone ?? 0n
    before.chunks += last?.chunks ?? 0
    before.rateLimited += last?.rateLimited ?? 0
    before.transient += last?.transient ?? 0
  }
  result.swaps = swaps.length

  const stored = db.prices.all()
  if (stored.size === 0) log.warn('no stored prices; USD volume will be null (run snapshot first)')
  const usd: UsdLookup = (token) => stored.get(token.toLowerCase() as Address)?.usd ?? null
  const anchors = chain.addresses.stablecoinAnchors
  const pools = new Map(tracked.map((pool) => [pool.id, pool]))
  const sideFor = (pool: PoolMeta) => pricedSide(pool, usd, anchors)
  result.unpricedPools = tracked.filter((pool) => sideFor(pool) === null).length

  const { buckets, dropped } = bucketSwaps(swaps, pools, sideFor, keepFrom)
  result.dropped = dropped
  const revalued = revaluedBuckets(db, tracked, sideFor, window.fromTs, buckets)
  throwIfStopped(ctx)
  db.transaction(() => {
    db.volume.upsertBuckets([...buckets, ...revalued])
    for (const pool of tracked) {
      db.syncState.setBigInt(syncKeys.volumeLastBlock(pool.id), latest.number)
      const coveredFromTs = scans.get(pool.id)?.coveredFromTs ?? window.fromTs
      db.syncState.set(syncKeys.volumeFromTs(pool.id), String(coveredFromTs))
    }
    db.syncState.setBigInt(syncKeys.volume(), latest.number)
    db.syncState.set(syncKeys.volumeHeadTs(), String(latest.timestamp))
    db.syncState.set(syncKeys.volumeWindows(), VOLUME_WINDOWS_BY_TIME)
  })
  result.buckets = buckets.length
  log.info('stored hourly volume', {
    chunks: before.chunks,
    rateLimited: before.rateLimited,
    swaps: swaps.length,
    dropped,
    buckets: buckets.length,
    revalued: revalued.length,
    incremental: result.incremental,
    unpricedPools: result.unpricedPools,
  })
  return result
}
