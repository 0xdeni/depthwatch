/**
 * Block timestamps for swaps. Logs carry no timestamp a fixture or every provider serves, and
 * `eth_getBlockByNumber` cannot be multicalled, so swaps take their block's time from the block
 * schedule (schedule.ts) once a few real headers confirm it, else from anchor headers.
 *
 * - **Schedule.** Base gives each block a scheduled timestamp from its number (2 s blocks, then
 *   200 ms from Denim on). When the headers of the scan's first swap block, of its last block and
 *   of both sides of every era boundary between them show the schedule's timestamps, every swap
 *   takes its block's scheduled timestamp: exact, for two to four headers a scan.
 * - **Anchors**, when the headers disagree (another chain, a synthetic fixture clock, a cadence
 *   change the schedule does not record yet): the multiples of a fixed span
 *   (`DEFAULT_TIMESTAMP_SPAN`, 10 000 blocks: 5.6 h of 2 s blocks, 33 min of 200 ms blocks) and
 *   the scan's last block are fetched, and a swap gets the linear interpolation between the anchors
 *   around its block. A segment whose endpoints do not show a whole number of seconds per block (a
 *   cadence change inside it) is bisected until it does or until its endpoints are adjacent, so an
 *   irregular segment costs extra headers but never a wrong hour bucket. A segment with fewer
 *   seconds than blocks (sub-second blocks, whose cadence whole-second headers cannot show) is
 *   interpolated once its midpoint's header lies within a second of the line, else bisected: a
 *   steady cadence costs one header more per segment instead of one per swap, a cadence change
 *   is cut down to where it happens, and every swap is right to within about a second; only the
 *   schedule is exact there.
 *
 * The span is independent of the `eth_getLogs` chunk size, so a scan in 10-block log chunks still
 * fetches a handful of headers, and a later scan of an overlapping window in the same process
 * reuses the cached ones.
 */
import type { SwapEvent } from '@depthwatch/core'
import { type BlockSchedule, scheduledTimestamp } from '../schedule.js'

/** Blocks between two timestamp anchors (5.6 h of 2 s blocks, 33 min of 200 ms blocks). */
export const DEFAULT_TIMESTAMP_SPAN = 10_000n

export type TimestampOf = (blockNumber: bigint) => Promise<number>

/** Timestamp of every event: exact at `start` and `end`, linear in between. */
async function fillSegment(
  events: readonly SwapEvent[],
  start: bigint,
  end: bigint,
  timestampOf: TimestampOf,
): Promise<void> {
  const tsStart = await timestampOf(start)
  if (end === start) {
    for (const e of events) e.timestamp = tsStart
    return
  }
  const tsEnd = await timestampOf(end)
  const blocks = end - start
  const seconds = BigInt(tsEnd - tsStart)
  const mid = start + blocks / 2n
  const linearAt = (block: bigint) => tsStart + Number(((block - start) * seconds) / blocks)
  const irregular =
    blocks > 1n &&
    (seconds >= blocks
      ? seconds % blocks !== 0n
      : Math.abs((await timestampOf(mid)) - linearAt(mid)) > 1)
  if (irregular) {
    const left = events.filter((e) => e.blockNumber <= mid)
    const right = events.filter((e) => e.blockNumber > mid)
    if (left.length > 0) await fillSegment(left, start, mid, timestampOf)
    if (right.length > 0) await fillSegment(right, mid, end, timestampOf)
    return
  }
  for (const e of events) e.timestamp = linearAt(e.blockNumber)
}

/**
 * Whether `schedule` gives the scan's first swap block, its last block and both sides of every era
 * boundary between them the timestamps their headers show.
 */
async function scheduleHolds(
  schedule: BlockSchedule,
  first: bigint,
  toBlock: bigint,
  timestampOf: TimestampOf,
): Promise<boolean> {
  if (first < (schedule[0]?.fromBlock ?? 0n)) return false
  // The scan's last block first: the anchors need its header anyway, so a chain the schedule does
  // not describe costs no header more than the anchors do.
  const checks = new Set([toBlock])
  for (const era of schedule)
    if (era.fromBlock > first && era.fromBlock <= toBlock) {
      checks.add(era.fromBlock)
      checks.add(era.fromBlock - 1n)
    }
  checks.add(first)
  for (const block of checks)
    if ((await timestampOf(block)) !== scheduledTimestamp(schedule, block)) return false
  return true
}

/**
 * Sets `timestamp` on every event (blocks ≤ `toBlock`, the newest block the caller may read): from
 * `schedule` when the headers confirm it, else from anchors (see the header). Anchors below the
 * scan's first block are real blocks too, so nothing is extrapolated.
 */
export async function fillTimestamps(
  events: readonly SwapEvent[],
  toBlock: bigint,
  span: bigint,
  timestampOf: TimestampOf,
  schedule: BlockSchedule | null = null,
): Promise<void> {
  if (events.length === 0) return
  let first = toBlock
  for (const e of events) if (e.blockNumber < first) first = e.blockNumber
  if (schedule !== null && (await scheduleHolds(schedule, first, toBlock, timestampOf))) {
    for (const e of events) e.timestamp = scheduledTimestamp(schedule, e.blockNumber)
    return
  }
  const segments = new Map<bigint, SwapEvent[]>()
  for (const e of events) {
    const start = (e.blockNumber / span) * span
    const group = segments.get(start)
    if (group === undefined) segments.set(start, [e])
    else group.push(e)
  }
  for (const [start, group] of segments) {
    const end = start + span < toBlock ? start + span : toBlock
    await fillSegment(group, start, end, timestampOf)
  }
}
