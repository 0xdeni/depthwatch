import type { SwapEvent } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { BASE_BLOCK_SCHEDULE, BASE_DENIM_BLOCK, scheduledTimestamp } from '../schedule.js'
import { DEFAULT_TIMESTAMP_SPAN, fillTimestamps } from './timestamps.js'

const swapAt = (blockNumber: bigint): SwapEvent => ({
  poolId: 'uniswap-v3:0x01',
  blockNumber,
  logIndex: 0,
  txHash: '0x01',
  amount0: 1n,
  amount1: -1n,
  timestamp: null,
})

/** A header source over `tsOf` that records which blocks were fetched (no cache). */
function headers(tsOf: (block: bigint) => number) {
  const fetched: bigint[] = []
  const timestampOf = async (block: bigint) => {
    fetched.push(block)
    return tsOf(block)
  }
  return { fetched, timestampOf }
}

describe('fillTimestamps', () => {
  it('interpolates exactly on a 2 s cadence from anchors every span blocks', async () => {
    const tsOf = (b: bigint) => 1_700_000_000 + Number(b) * 2
    const { fetched, timestampOf } = headers(tsOf)
    const events = [12_345n, 19_999n, 20_000n, 31_000n, 45_300n].map(swapAt)
    await fillTimestamps(events, 45_300n, DEFAULT_TIMESTAMP_SPAN, timestampOf)
    expect(events.map((e) => e.timestamp)).toEqual(events.map((e) => tsOf(e.blockNumber)))
    // Segments [10 000, 20 000], [20 000, 30 000], [30 000, 40 000] and [40 000, 45 300]
    // (45 300 is the scan's end, the newest block it may read).
    expect(fetched).toEqual([
      10_000n,
      20_000n,
      20_000n,
      30_000n,
      30_000n,
      40_000n,
      40_000n,
      45_300n,
    ])
  })

  it('takes the anchor itself for a swap on a segment start that is also the scan end', async () => {
    const { fetched, timestampOf } = headers((b) => Number(b))
    const events = [swapAt(30_000n)]
    await fillTimestamps(events, 30_000n, 10_000n, timestampOf)
    expect(events[0]?.timestamp).toBe(30_000)
    expect(fetched).toEqual([30_000n])
  })

  it('bisects a segment whose endpoints do not show a whole number of seconds per block', async () => {
    // 2 s blocks up to block 1 000, then 1 s blocks: a cadence change inside one segment.
    const tsOf = (b: bigint) => (b <= 1_000n ? Number(b) * 2 : 2_000 + Number(b - 1_000n))
    const { fetched, timestampOf } = headers(tsOf)
    const blocks = [10n, 999n, 1_000n, 1_001n, 1_500n, 3_999n]
    const events = blocks.map(swapAt)
    await fillTimestamps(events, 4_000n, 4_000n, timestampOf)
    expect(events.map((e) => e.timestamp)).toEqual(blocks.map(tsOf))
    // Linear interpolation over [0, 4 000] alone would put block 1 000 at 1 666 s instead of 2 000.
    expect(fetched.length).toBeGreaterThan(2)
    expect(fetched.length).toBeLessThan(40)
  })

  it('takes the schedule once the first, last and era-boundary headers confirm it', async () => {
    const tsOf = (b: bigint) => scheduledTimestamp(BASE_BLOCK_SCHEDULE, b)
    const { fetched, timestampOf } = headers(tsOf)
    // A day across Denim: 2 s blocks up to 18:00:00, then five blocks a second.
    const blocks = [
      BASE_DENIM_BLOCK - 20_000n,
      BASE_DENIM_BLOCK - 1n,
      BASE_DENIM_BLOCK,
      BASE_DENIM_BLOCK + 4n,
      BASE_DENIM_BLOCK + 5n,
      BASE_DENIM_BLOCK + 300_000n,
    ]
    const events = blocks.map(swapAt)
    const toBlock = BASE_DENIM_BLOCK + 300_001n
    await fillTimestamps(events, toBlock, DEFAULT_TIMESTAMP_SPAN, timestampOf, BASE_BLOCK_SCHEDULE)
    expect(events.map((e) => e.timestamp)).toEqual(blocks.map(tsOf))
    expect(events.slice(2, 5).map((e) => e.timestamp)).toEqual([
      1_793_901_601, 1_793_901_601, 1_793_901_602,
    ])
    expect(fetched).toEqual([
      toBlock,
      BASE_DENIM_BLOCK,
      BASE_DENIM_BLOCK - 1n,
      BASE_DENIM_BLOCK - 20_000n,
    ])
  })

  it('falls back to anchors when a header disagrees with the schedule', async () => {
    // A synthetic 2 s clock that is not Base's: the scan end's header (an anchor the fallback
    // needs anyway) disagrees, and the anchors take over without another header.
    const tsOf = (b: bigint) => 1_700_000_000 + Number(b) * 2
    const { fetched, timestampOf } = headers(tsOf)
    const events = [12_345n, 45_300n].map(swapAt)
    await fillTimestamps(events, 45_300n, DEFAULT_TIMESTAMP_SPAN, timestampOf, BASE_BLOCK_SCHEDULE)
    expect(events.map((e) => e.timestamp)).toEqual(events.map((e) => tsOf(e.blockNumber)))
    expect(fetched).toEqual([45_300n, 10_000n, 20_000n, 40_000n, 45_300n])
  })

  it('interpolates sub-second blocks between anchors instead of bisecting to every block', async () => {
    // 200 ms blocks seen through whole-second headers, with no schedule to read them by.
    const msOf = (b: bigint) => 1_793_901_601_000 + Number(b) * 200
    const tsOf = (b: bigint) => Math.floor(msOf(b) / 1_000)
    const { fetched, timestampOf } = headers(tsOf)
    const blocks = Array.from({ length: 2_000 }, (_, i) => BigInt(i * 211 + 3))
    const events = blocks.map(swapAt)
    await fillTimestamps(events, 430_000n, DEFAULT_TIMESTAMP_SPAN, timestampOf)
    for (const e of events) {
      const truth = tsOf(e.blockNumber)
      expect(e.timestamp).toBeGreaterThanOrEqual(truth - 1)
      expect(e.timestamp).toBeLessThanOrEqual(truth + 1)
    }
    // Each of the 43 segments: its two ends and the midpoint that confirms a steady cadence.
    expect(fetched.length).toBeLessThanOrEqual(3 * 43)
  })

  it('cuts a fallback segment down to the cadence change it holds', async () => {
    // Base's real headers across Denim, read without the schedule: 20 000 swaps over a day.
    const tsOf = (b: bigint) => scheduledTimestamp(BASE_BLOCK_SCHEDULE, b)
    const cache = new Map<bigint, number>()
    const timestampOf = async (b: bigint) => {
      const ts = cache.get(b) ?? tsOf(b)
      cache.set(b, ts)
      return ts
    }
    const from = BASE_DENIM_BLOCK - 21_600n
    const blocks = Array.from({ length: 20_000 }, (_, i) => from + BigInt(i) * 18n + BigInt(i % 7))
    const events = blocks.map(swapAt)
    await fillTimestamps(events, from + 400_000n, DEFAULT_TIMESTAMP_SPAN, timestampOf)
    let worst = 0
    for (const e of events)
      worst = Math.max(worst, Math.abs((e.timestamp ?? 0) - tsOf(e.blockNumber)))
    expect(worst).toBeLessThanOrEqual(2)
    expect(cache.size).toBeLessThan(200)
  })

  it('leaves events untouched when there are none', async () => {
    const { fetched, timestampOf } = headers(() => 0)
    await fillTimestamps([], 100n, 10n, timestampOf)
    expect(fetched).toEqual([])
  })
})
