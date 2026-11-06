import { describe, expect, it } from 'vitest'
import {
  BASE_BLOCK_SCHEDULE,
  BASE_DENIM_BLOCK,
  BASE_GENESIS_TIMESTAMP,
  type BlockSchedule,
  msPerBlockAt,
  scheduledBlockAtOrAfter,
  scheduledTimeMs,
  scheduledTimestamp,
  scheduleMatches,
} from './schedule.js'

/**
 * Headers read from Base mainnet on 2026-11-05 (`eth_getBlockByNumber`: `timestamp`, and
 * `timestampMs` where the node returns it); docs/research/base-contracts.md §2.13.
 */
const MAINNET_HEADERS: ReadonlyArray<{ number: bigint; timestamp: number; timestampMs?: number }> =
  [
    { number: 0n, timestamp: 1_686_789_347 },
    { number: 1n, timestamp: 1_686_789_349 },
    { number: 30_000_000n, timestamp: 1_746_789_347 },
    { number: 53_554_327n, timestamp: 1_793_898_001 },
    { number: 53_556_126n, timestamp: 1_793_901_599 },
    { number: 53_556_127n, timestamp: 1_793_901_601, timestampMs: 1_793_901_601_000 },
    { number: 53_556_128n, timestamp: 1_793_901_601, timestampMs: 1_793_901_601_200 },
    { number: 53_556_131n, timestamp: 1_793_901_601, timestampMs: 1_793_901_601_800 },
    { number: 53_556_132n, timestamp: 1_793_901_602, timestampMs: 1_793_901_602_000 },
    { number: 53_556_140n, timestamp: 1_793_901_603 },
    { number: 53_604_914n, timestamp: 1_793_911_358, timestampMs: 1_793_911_358_400 },
  ]

describe('BASE_BLOCK_SCHEDULE', () => {
  it('reproduces the mainnet headers on both sides of Denim', () => {
    for (const header of MAINNET_HEADERS) {
      expect(scheduledTimestamp(BASE_BLOCK_SCHEDULE, header.number)).toBe(header.timestamp)
      expect(scheduleMatches(BASE_BLOCK_SCHEDULE, header)).toBe(true)
      if (header.timestampMs !== undefined)
        expect(scheduledTimeMs(BASE_BLOCK_SCHEDULE, header.number)).toBe(header.timestampMs)
    }
  })

  it('starts each era where the one before it ends', () => {
    expect(BASE_BLOCK_SCHEDULE[0]).toEqual({
      fromBlock: 0n,
      fromMs: BASE_GENESIS_TIMESTAMP * 1_000,
      msPerBlock: 2_000,
    })
    for (let i = 1; i < BASE_BLOCK_SCHEDULE.length; i++) {
      const before = BASE_BLOCK_SCHEDULE[i - 1]
      const era = BASE_BLOCK_SCHEDULE[i]
      if (before === undefined || era === undefined) throw new Error('unreachable')
      expect(era.fromBlock > before.fromBlock).toBe(true)
      const end = before.fromMs + Number(era.fromBlock - before.fromBlock) * before.msPerBlock
      expect(era.fromMs).toBe(end)
    }
    expect(msPerBlockAt(BASE_BLOCK_SCHEDULE, BASE_DENIM_BLOCK - 1n)).toBe(2_000)
    expect(msPerBlockAt(BASE_BLOCK_SCHEDULE, BASE_DENIM_BLOCK)).toBe(200)
  })

  it('finds the first block at or after a timestamp', () => {
    const at = (timestamp: number) => scheduledBlockAtOrAfter(BASE_BLOCK_SCHEDULE, timestamp)
    // 18:00:00 falls between the last 2 s block (17:59:59) and the first 200 ms block (18:00:01).
    expect(at(1_793_901_600)).toBe(BASE_DENIM_BLOCK)
    expect(at(1_793_901_601)).toBe(BASE_DENIM_BLOCK)
    expect(at(1_793_901_602)).toBe(53_556_132n)
    expect(at(1_793_901_599)).toBe(53_556_126n)
    expect(at(1_793_898_001)).toBe(53_554_327n)
    expect(at(1_793_898_000)).toBe(53_554_327n)
    expect(at(BASE_GENESIS_TIMESTAMP - 100)).toBe(0n)
    expect(at(BASE_GENESIS_TIMESTAMP + 1)).toBe(1n)
    for (const timestamp of [1_793_905_200, 1_793_911_358, 1_746_789_348, 1_793_901_603]) {
      const block = at(timestamp)
      expect(scheduledTimestamp(BASE_BLOCK_SCHEDULE, block)).toBeGreaterThanOrEqual(timestamp)
      expect(scheduledTimestamp(BASE_BLOCK_SCHEDULE, block - 1n)).toBeLessThan(timestamp)
    }
  })

  it('handles a schedule of one era and refuses blocks before it', () => {
    const late: BlockSchedule = [{ fromBlock: 10n, fromMs: 1_000_000, msPerBlock: 1_000 }]
    expect(scheduledTimestamp(late, 12n)).toBe(1_002)
    expect(() => scheduledTimestamp(late, 9n)).toThrow(RangeError)
    expect(scheduleMatches(late, { number: 12n, timestamp: 1_003 })).toBe(false)
  })
})
