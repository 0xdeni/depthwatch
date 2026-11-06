/**
 * Where a `volume` pass reads from (volume.ts): the whole window, or, for a pool whose stored
 * coverage reaches back to the window's first hour, the first block of the hour that holds its
 * `lastBlock`. Hours and blocks are matched by time (`ChainReader.blockAtOrAfter`,
 * `getBlockTimestamp`), never by counting blocks.
 */
import { BASE_DENIM_BLOCK } from '@depthwatch/chain'
import { maxBigint, minBigint } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import { HOUR_SECONDS, type PipelineContext, syncKeys } from './context.js'

/**
 * The `volume:windows` mark of coverage stored by a pass that finds its blocks by time. Coverage
 * that ends at or after Denim's first block without it was written by a version that counted
 * 2 s blocks after Denim: its hours are short, so those pools read their whole window once more.
 */
export const VOLUME_WINDOWS_BY_TIME = 'by-time'

export function hourStartOf(timestamp: number): number {
  return Math.floor(timestamp / HOUR_SECONDS) * HOUR_SECONDS
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

export function coverageOf(
  db: Database,
  poolId: string,
  byTime: boolean,
): VolumeCoverage | undefined {
  const lastBlock = db.syncState.getBigInt(syncKeys.volumeLastBlock(poolId))
  const fromTs = db.syncState.get(syncKeys.volumeFromTs(poolId))
  if (lastBlock === undefined || fromTs === undefined || !/^\d+$/.test(fromTs)) return undefined
  if (!byTime && lastBlock >= BASE_DENIM_BLOCK) return undefined
  return { lastBlock, fromTs: Number(fromTs) }
}
