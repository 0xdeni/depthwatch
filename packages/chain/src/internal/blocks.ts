/**
 * Block headers on the main client: the head, a block's timestamp (cached per reader, at most
 * `TIMESTAMP_CACHE_LIMIT` of them) and the first block at or after a time. For the last, the block
 * schedule (schedule.ts) names a candidate, which two headers confirm: its own timestamp reaches
 * the time and its parent's does not. Without a schedule, or when they disagree, a binary search
 * over the headers of `[0, toBlock]` finds it (about 26 headers for Base's height; header
 * timestamps never decrease).
 */
import { type BlockSchedule, scheduledBlockAtOrAfter } from '../schedule.js'
import { callWithBackoff } from './backoff.js'
import type { ReaderContext } from './context.js'
import type { TimestampOf } from './timestamps.js'

/** Block timestamps a reader keeps; a full cache starts over (a long `start` reads ever new heads). */
export const TIMESTAMP_CACHE_LIMIT = 10_000

function remember(ctx: ReaderContext, block: bigint, timestamp: number): void {
  if (ctx.timestampCache.size >= TIMESTAMP_CACHE_LIMIT) ctx.timestampCache.clear()
  ctx.timestampCache.set(block, timestamp)
}

export function blockReads(ctx: ReaderContext) {
  async function getLatestBlock(): Promise<{ number: bigint; timestamp: number }> {
    const block = await callWithBackoff(ctx, 'eth_getBlockByNumber latest', () =>
      ctx.client.getBlock({ blockTag: 'latest' }),
    )
    if (block.number === null) throw new Error('latest block has no number')
    const timestamp = Number(block.timestamp)
    remember(ctx, block.number, timestamp)
    return { number: block.number, timestamp }
  }

  async function getBlockTimestamp(blockNumber: bigint): Promise<number> {
    const cached = ctx.timestampCache.get(blockNumber)
    if (cached !== undefined) return cached
    const block = await callWithBackoff(ctx, `eth_getBlockByNumber ${blockNumber}`, () =>
      ctx.client.getBlock({ blockNumber }),
    )
    const timestamp = Number(block.timestamp)
    remember(ctx, blockNumber, timestamp)
    return timestamp
  }

  return { getLatestBlock, getBlockTimestamp }
}

/** First block ≤ `toBlock` whose timestamp is ≥ `timestamp`, or `toBlock + 1n` when none is. */
export async function blockAtOrAfter(
  timestamp: number,
  toBlock: bigint,
  timestampOf: TimestampOf,
  schedule: BlockSchedule | null,
): Promise<bigint> {
  if ((await timestampOf(toBlock)) < timestamp) return toBlock + 1n
  const isFirst = async (block: bigint) =>
    (await timestampOf(block)) >= timestamp &&
    (block === 0n || (await timestampOf(block - 1n)) < timestamp)
  if (schedule !== null) {
    const candidate = scheduledBlockAtOrAfter(schedule, timestamp)
    if (candidate >= 0n && candidate <= toBlock && (await isFirst(candidate))) return candidate
  }
  let low = 0n
  let high = toBlock
  while (low < high) {
    const mid = (low + high) / 2n
    if ((await timestampOf(mid)) >= timestamp) high = mid
    else low = mid + 1n
  }
  return low
}
