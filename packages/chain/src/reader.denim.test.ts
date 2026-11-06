/**
 * Swap timestamps and block lookups on Base's real block schedule across Denim (2 s blocks up to
 * block 53,556,126, five a second from 53,556,127 on): exact, for a handful of headers.
 */
import type { Hex } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { uniswapV3PoolAbi } from './abi/uniswapV3Pool.js'
import { addLogs, makeLog, setClock } from './fixtures/builders.js'
import { createChainReader } from './reader.js'
import { BASE_BLOCK_SCHEDULE, BASE_DENIM_BLOCK, scheduledTimestamp } from './schedule.js'
import { addr, countingTransport, newFixture, poolMeta, TOKEN_A, TOKEN_D } from './test/helpers.js'
import { createFixtureTransport } from './transport/fixture.js'

const HEAD = BASE_DENIM_BLOCK + 300_000n
const POOL = poolMeta({
  dex: 'uniswap-v3',
  address: addr(0x401),
  token0: TOKEN_A,
  token1: TOKEN_D,
  feePips: 500,
  tickSpacing: 10,
})
const SWAP_BLOCKS = [
  BASE_DENIM_BLOCK - 20_000n,
  BASE_DENIM_BLOCK - 1n,
  BASE_DENIM_BLOCK,
  BASE_DENIM_BLOCK + 4n,
  BASE_DENIM_BLOCK + 5n,
  HEAD - 1_000n,
]

function setup() {
  const fixture = newFixture()
  setClock(fixture, { latestBlock: HEAD, schedule: BASE_BLOCK_SCHEDULE })
  addLogs(
    fixture,
    SWAP_BLOCKS.map((blockNumber) =>
      makeLog({
        address: POOL.address as Hex,
        abi: uniswapV3PoolAbi,
        eventName: 'Swap',
        args: {
          sender: addr(0x7007),
          recipient: addr(0x7007),
          amount0: 1n,
          amount1: -1n,
          sqrtPriceX96: 1n << 96n,
          liquidity: 1n,
          tick: 0,
        },
        blockNumber,
        logIndex: 0,
      }),
    ),
  )
  const counts = new Map<string, number>()
  const reader = createChainReader({
    transport: countingTransport(createFixtureTransport(fixture), counts),
    logChunkSize: 1_000_000,
  })
  return { reader, counts }
}

describe('Base across Denim', () => {
  it('times every swap exactly from the schedule, for four headers', async () => {
    const { reader, counts } = setup()
    const events = await reader.readSwaps([POOL], BASE_DENIM_BLOCK - 21_600n, HEAD)
    expect(events.map((e) => e.blockNumber)).toEqual(SWAP_BLOCKS)
    expect(events.map((e) => e.timestamp)).toEqual(
      SWAP_BLOCKS.map((b) => scheduledTimestamp(BASE_BLOCK_SCHEDULE, b)),
    )
    // 17:59:59, then 18:00:01 for the first 200 ms block and the four after it, then 18:00:02.
    expect(events.slice(1, 5).map((e) => e.timestamp)).toEqual([
      1_793_901_599, 1_793_901_601, 1_793_901_601, 1_793_901_602,
    ])
    // The scan's end, both sides of the Denim block and the first swap's block.
    expect(counts.get('eth_getBlockByNumber')).toBe(4)
  })

  it('finds the first block of an hour from two headers', async () => {
    const { reader, counts } = setup()
    // 18:00 UTC falls between the last 2 s block and the first 200 ms block.
    expect(await reader.blockAtOrAfter(1_793_901_600, HEAD)).toBe(BASE_DENIM_BLOCK)
    // 20:00 UTC: 7 199 s of 200 ms blocks after the first one.
    expect(await reader.blockAtOrAfter(1_793_908_800, HEAD)).toBe(BASE_DENIM_BLOCK + 35_995n)
    expect(counts.get('eth_getBlockByNumber')).toBe(5)
  })
})
