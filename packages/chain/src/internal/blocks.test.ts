import { describe, expect, it } from 'vitest'
import { BASE_BLOCK_SCHEDULE, BASE_DENIM_BLOCK, scheduledTimestamp } from '../schedule.js'
import { blockAtOrAfter } from './blocks.js'

function headers(tsOf: (block: bigint) => number) {
  const fetched = new Set<bigint>()
  const timestampOf = async (block: bigint) => {
    fetched.add(block)
    return tsOf(block)
  }
  return { fetched, timestampOf }
}

describe('blockAtOrAfter', () => {
  const head = BASE_DENIM_BLOCK + 50_000n

  it('confirms the schedule’s block with its own and its parent’s header', async () => {
    const { fetched, timestampOf } = headers((b) => scheduledTimestamp(BASE_BLOCK_SCHEDULE, b))
    // 18:00:00, between the last 2 s block (17:59:59) and the first 200 ms block (18:00:01).
    expect(await blockAtOrAfter(1_793_901_600, head, timestampOf, BASE_BLOCK_SCHEDULE)).toBe(
      BASE_DENIM_BLOCK,
    )
    expect([...fetched]).toEqual([head, BASE_DENIM_BLOCK, BASE_DENIM_BLOCK - 1n])
    expect(await blockAtOrAfter(1_793_901_602, head, timestampOf, BASE_BLOCK_SCHEDULE)).toBe(
      BASE_DENIM_BLOCK + 5n,
    )
  })

  it('searches the headers when the schedule does not hold, or there is none', async () => {
    const tsOf = (b: bigint) => 1_800_000_000 - Number(100_000n - b) * 2
    for (const schedule of [BASE_BLOCK_SCHEDULE, null]) {
      const { fetched, timestampOf } = headers(tsOf)
      // 1 800 000 000 − 1 000 is block 99 500; one second later is still block 99 501.
      expect(await blockAtOrAfter(1_799_999_000, 100_000n, timestampOf, schedule)).toBe(99_500n)
      expect(await blockAtOrAfter(1_799_999_001, 100_000n, timestampOf, schedule)).toBe(99_501n)
      expect(fetched.size).toBeLessThan(45)
    }
  })

  it('returns block 0 before the first block and the block after `toBlock` past it', async () => {
    const { timestampOf } = headers((b) => 1_000 + Number(b))
    expect(await blockAtOrAfter(10, 500n, timestampOf, null)).toBe(0n)
    expect(await blockAtOrAfter(1_500, 500n, timestampOf, null)).toBe(500n)
    expect(await blockAtOrAfter(1_501, 500n, timestampOf, null)).toBe(501n)
  })
})
