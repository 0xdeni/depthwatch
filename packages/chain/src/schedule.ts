/**
 * Base mainnet's block schedule: the time of every block, as the protocol defines it. Base's
 * derivation pipeline gives each block a scheduled timestamp computed from its number and the
 * activation schedule, not from a wall clock, and blocks cannot skip a slot (docs.base.org,
 * upgrades/denim/200ms-blocks.md, "Scheduled timestamps" and "Full block timestamp"):
 *
 * - from genesis, one block every 2 s;
 * - from Denim's activation block on, five per second, 200 ms apart. The header `timestamp` stays
 *   whole Unix seconds, so about five consecutive blocks share one.
 *
 * The eras and their on-chain check are recorded in docs/research/base-contracts.md §2.13. The
 * reader checks the schedule against real headers before it relies on it and reads headers
 * instead when they disagree (reader.ts, internal/timestamps.ts), so a cadence change missing
 * here costs requests, not wrong hours.
 */
import { minBigint } from '@depthwatch/core'

/** Blocks from `fromBlock` on, each `msPerBlock` after the one before. */
export interface BlockEra {
  fromBlock: bigint
  /** Unix milliseconds of `fromBlock`. */
  fromMs: number
  msPerBlock: number
}

/** Eras by increasing `fromBlock`, the first starting at block 0. */
export type BlockSchedule = readonly BlockEra[]

/** Base mainnet's genesis block timestamp (Unix seconds, 2023-06-15 00:35:47 UTC). */
export const BASE_GENESIS_TIMESTAMP = 1_686_789_347
/** First block of 200 ms blocks: Denim's activation on Base mainnet, 2026-11-05 18:00:01 UTC. */
export const BASE_DENIM_BLOCK = 53_556_127n

export const BASE_BLOCK_SCHEDULE: BlockSchedule = Object.freeze([
  Object.freeze({ fromBlock: 0n, fromMs: BASE_GENESIS_TIMESTAMP * 1_000, msPerBlock: 2_000 }),
  Object.freeze({ fromBlock: BASE_DENIM_BLOCK, fromMs: 1_793_901_601_000, msPerBlock: 200 }),
])

function eraOf(schedule: BlockSchedule, block: bigint): BlockEra {
  let found: BlockEra | undefined
  for (const era of schedule) if (era.fromBlock <= block) found = era
  if (found === undefined) throw new RangeError(`no block era holds block ${block}`)
  return found
}

/** Unix milliseconds of `block` on `schedule`. */
export function scheduledTimeMs(schedule: BlockSchedule, block: bigint): number {
  const era = eraOf(schedule, block)
  return era.fromMs + Number(block - era.fromBlock) * era.msPerBlock
}

/** The header `timestamp` (whole Unix seconds) of `block` on `schedule`. */
export function scheduledTimestamp(schedule: BlockSchedule, block: bigint): number {
  return Math.floor(scheduledTimeMs(schedule, block) / 1_000)
}

/** First block whose header timestamp is ≥ `timestamp` (Unix seconds) on `schedule`. */
export function scheduledBlockAtOrAfter(schedule: BlockSchedule, timestamp: number): bigint {
  const targetMs = timestamp * 1_000
  let block = schedule[0]?.fromBlock ?? 0n
  for (const era of schedule) {
    if (era.fromMs >= targetMs) return minBigint(block, era.fromBlock)
    const steps = Math.ceil((targetMs - era.fromMs) / era.msPerBlock)
    block = era.fromBlock + BigInt(steps)
  }
  return block
}

/** Milliseconds between blocks at `block`. */
export function msPerBlockAt(schedule: BlockSchedule, block: bigint): number {
  return eraOf(schedule, block).msPerBlock
}

/** Whether `schedule` gives `block` the header timestamp a real header showed. */
export function scheduleMatches(
  schedule: BlockSchedule,
  block: { number: bigint; timestamp: number },
): boolean {
  return block.number >= 0n && scheduledTimestamp(schedule, block.number) === block.timestamp
}
