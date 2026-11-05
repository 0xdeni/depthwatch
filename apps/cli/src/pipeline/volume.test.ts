import {
  BASE_BLOCK_SCHEDULE,
  BASE_DENIM_BLOCK,
  type ChainReader,
  createChainReader,
  createFixtureTransport,
  createSyntheticFixture,
  scheduledBlockAtOrAfter,
  scheduledTimestamp,
  syntheticAddresses,
  syntheticWorld,
} from '@depthwatch/chain'
import type { Address, PoolMeta, SwapEvent, TokenInfo } from '@depthwatch/core'
import { DEXES, minBigint } from '@depthwatch/core'
import { IN_MEMORY, openDatabase } from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createLogger } from '../log.js'
import { createPipelineContext, syncKeys } from './context.js'
import { discoverStep } from './discover.js'
import {
  bucketSwaps,
  hourStartOf,
  pricedSide,
  type UsdLookup,
  VOLUME_WINDOWS_BY_TIME,
  volumeStep,
} from './volume.js'

const token = (address: string, symbol: string, decimals: number): TokenInfo => ({
  address: address as Address,
  symbol,
  name: symbol,
  decimals,
})
const USDC = token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 6)
const WETH = token('0x4200000000000000000000000000000000000006', 'WETH', 18)
const AERO = token('0x940181a94a35a4569e4529a3cdfb74e38fd98631', 'AERO', 18)
const ANCHORS = { [USDC.address]: 1 }

function pool(id: string, token0: TokenInfo, token1: TokenInfo): PoolMeta {
  return {
    id,
    dex: 'uniswap-v3',
    kind: 'concentrated',
    address: '0x0000000000000000000000000000000000000001',
    poolId: null,
    token0,
    token1,
    feePips: 500,
    tickSpacing: 10,
    stable: false,
    hooks: null,
    createdAtBlock: 1n,
  }
}

const usd: UsdLookup = (address) =>
  ({ [USDC.address]: 1, [WETH.address]: 2500, [AERO.address]: 1.2 })[address] ?? null

describe('pricedSide', () => {
  it('prefers the stablecoin side, then token1, then token0', () => {
    expect(pricedSide(pool('a', USDC, WETH), usd, ANCHORS)).toEqual({
      side: 0,
      usd: 1,
      decimals: 6,
    })
    expect(pricedSide(pool('b', WETH, USDC), usd, ANCHORS)).toEqual({
      side: 1,
      usd: 1,
      decimals: 6,
    })
    expect(pricedSide(pool('c', WETH, AERO), usd, ANCHORS)).toEqual({
      side: 1,
      usd: 1.2,
      decimals: 18,
    })
    const unpricedToken1 = pool(
      'd',
      WETH,
      token('0x00000000000000000000000000000000000000ff', 'XYZ', 18),
    )
    expect(pricedSide(unpricedToken1, usd, ANCHORS)).toEqual({ side: 0, usd: 2500, decimals: 18 })
    expect(
      pricedSide(pool('e', token('0x01', 'A', 18), token('0x02', 'B', 18)), usd, ANCHORS),
    ).toBeNull()
  })
})

describe('bucketSwaps', () => {
  const wethUsdc = pool('uniswap-v3:0x1', WETH, USDC)
  const pools = new Map([[wethUsdc.id, wethUsdc]])
  const swap = (
    timestamp: number | null,
    amount0: bigint,
    amount1: bigint,
    logIndex = 0,
  ): SwapEvent => ({
    poolId: wethUsdc.id,
    blockNumber: 10n,
    logIndex,
    txHash: '0x01',
    amount0,
    amount1,
    timestamp,
  })
  const sideFor = (p: PoolMeta) => pricedSide(p, usd, ANCHORS)

  it('aligns to hours, sums |amounts|, counts swaps and values the USDC side', () => {
    const base = 1_700_000_000 - (1_700_000_000 % 3600)
    const swaps = [
      swap(base + 10, 10n ** 18n, -2_500_000_000n, 0), // sell 1 WETH for 2 500 USDC
      swap(base + 20, -(10n ** 18n), 2_510_000_000n, 1), // buy 1 WETH for 2 510 USDC
      swap(base + 3600, 2n * 10n ** 18n, -5_000_000_000n, 2), // next hour
    ]
    const { buckets, dropped } = bucketSwaps(swaps, pools, sideFor, base)
    expect(dropped).toBe(0)
    expect(buckets).toEqual([
      {
        poolId: wethUsdc.id,
        hourStart: base,
        volumeToken0: 2n * 10n ** 18n,
        volumeToken1: 5_010_000_000n,
        volumeUsd: 5010,
        swapCount: 2,
      },
      {
        poolId: wethUsdc.id,
        hourStart: base + 3600,
        volumeToken0: 2n * 10n ** 18n,
        volumeToken1: 5_000_000_000n,
        volumeUsd: 5000,
        swapCount: 1,
      },
    ])
  })

  it('drops swaps before the window, without a timestamp or for unknown pools', () => {
    const base = hourStartOf(1_700_000_000)
    const swaps = [
      swap(base - 1, 1n, -1n),
      swap(null, 1n, -1n),
      { ...swap(base + 1, 1n, -1n), poolId: 'nope' },
      swap(base + 1, 10n ** 18n, -2_500_000_000n),
    ]
    const { buckets, dropped } = bucketSwaps(swaps, pools, sideFor, base)
    expect(dropped).toBe(3)
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.swapCount).toBe(1)
  })

  it('keeps USD null for pools with no priced side', () => {
    const base = hourStartOf(1_700_000_000)
    const { buckets } = bucketSwaps([swap(base, 10n ** 18n, -1n)], pools, () => null, base)
    expect(buckets[0]).toMatchObject({ volumeUsd: null, swapCount: 1, volumeToken0: 10n ** 18n })
  })
})

/**
 * A head 100 000 s after Denim, on Base's block schedule (200 ms blocks). Its 24 h window starts at
 * hour 1 793 912 400, block BASE_DENIM_BLOCK + 53 995: 446 006 blocks.
 */
const HEAD = BASE_DENIM_BLOCK + 500_000n
const SCHEDULED = {
  head: { number: HEAD, timestamp: scheduledTimestamp(BASE_BLOCK_SCHEDULE, HEAD) },
  getBlockTimestamp: async (block: bigint) => scheduledTimestamp(BASE_BLOCK_SCHEDULE, block),
  blockAtOrAfter: async (timestamp: number) =>
    scheduledBlockAtOrAfter(BASE_BLOCK_SCHEDULE, timestamp),
}

describe('volumeStep', () => {
  it('stores a day with more swaps than a spread call takes (> 125 000)', async () => {
    const { head } = SCHEDULED
    const target = pool(`uniswap-v3:${'0x'.padEnd(41, '0')}1`, WETH, USDC)
    const count = 200_000
    const swaps: SwapEvent[] = Array.from({ length: count }, (_, i) => ({
      poolId: target.id,
      blockNumber: head.number - BigInt(i % 400),
      logIndex: i,
      txHash: '0x01',
      amount0: 1n,
      amount1: -2n,
      timestamp: head.timestamp - (i % 400) * 2,
    }))
    const chain = {
      addresses: { stablecoinAnchors: ANCHORS },
      getLatestBlock: async () => head,
      getBlockTimestamp: SCHEDULED.getBlockTimestamp,
      blockAtOrAfter: SCHEDULED.blockAtOrAfter,
      readSwaps: async () => swaps,
    } as unknown as ChainReader
    const db = openDatabase(IN_MEMORY)
    try {
      db.pools.upsertMany([target])
      db.pools.setTracked([target.id], true)
      const ctx = createPipelineContext({ db, chain, config: loadConfig({}) })
      const result = await volumeStep(ctx)
      expect(result).toMatchObject({ swaps: count, dropped: 0 })
      const stored = db.volume.series(target.id, 0)
      expect(stored.reduce((sum, bucket) => sum + bucket.swapCount, 0)).toBe(count)
      expect(stored.reduce((sum, bucket) => sum + bucket.volumeToken1, 0n)).toBe(2n * BigInt(count))
    } finally {
      db.close()
    }
  })

  /**
   * Runs the volume step over a v3 and a Slipstream pool (one shared scan) against a fake reader
   * that serves `served`-block chunks, one progress callback per chunk, each 0.1 s of wall time.
   */
  async function progressLines(logChunk: string, served: bigint, intervalMs: number) {
    const { head } = SCHEDULED
    const v3 = pool(`uniswap-v3:${'0x'.padEnd(41, '0')}1`, WETH, USDC)
    const slip: PoolMeta = {
      ...pool(`aerodrome-slipstream:${'0x'.padEnd(41, '0')}2`, WETH, USDC),
      dex: 'aerodrome-slipstream',
    }
    const chain = {
      addresses: { stablecoinAnchors: ANCHORS },
      getLatestBlock: async () => head,
      getBlockTimestamp: SCHEDULED.getBlockTimestamp,
      blockAtOrAfter: SCHEDULED.blockAtOrAfter,
      readSwaps: async (
        _pools: unknown,
        from: bigint,
        to: bigint,
        opts?: { onProgress?: (p: unknown) => void },
      ) => {
        const span = to - from + 1n
        const chunks = Number((span + served - 1n) / served)
        for (let i = 1; i <= chunks; i++) {
          const blocksDone = minBigint(BigInt(i) * served, span)
          const rateLimited = i > 1 ? 1 : 0
          opts?.onProgress?.({ scans: 1, blocksDone, blocksTotal: span, chunks: i, rateLimited })
        }
        return []
      },
    } as unknown as ChainReader
    const lines: string[] = []
    const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
    let ms = 0
    const db = openDatabase(IN_MEMORY)
    try {
      db.pools.upsertMany([v3, slip])
      db.pools.setTracked([v3.id, slip.id], true)
      const config = loadConfig({ DEPTHWATCH_LOG_CHUNK: logChunk })
      const ctx = createPipelineContext({ db, chain, config, log })
      await volumeStep(ctx, { clock: () => (ms += 100), progressIntervalMs: intervalMs })
    } finally {
      db.close()
    }
    return lines
  }

  it('logs scan progress in blocks at the configured cadence, with chunks and 429s', async () => {
    const lines = await progressLines('10', 10n, 30_000)
    const progress = lines.filter((line) => line.includes('swap scan progress'))
    // One scan for both DEXes (shared Swap event): 446 006 blocks of 200 ms, 44 601 chunks.
    expect(progress.length).toBe(Math.floor((44_601 * 100) / 30_000))
    expect(progress[0]).toMatch(
      /blocks=\d+\/446006 pct=\d+\.\d% elapsed=30s eta=\S+ chunks=\d+\/44601 rateLimited=1/,
    )
    expect(progress.every((line) => /chunks=\d+\/44601 /.test(line))).toBe(true)
    expect(lines.some((line) => line.includes('stored hourly volume chunks=44601'))).toBe(true)
  })

  it('reads the whole window again over coverage a 2 s-block version stored after Denim', async () => {
    const { head } = SCHEDULED
    const target = pool(`uniswap-v3:${'0x'.padEnd(41, '0')}1`, WETH, USDC)
    const reads: bigint[] = []
    const chain = {
      addresses: { stablecoinAnchors: ANCHORS },
      getLatestBlock: async () => head,
      getBlockTimestamp: SCHEDULED.getBlockTimestamp,
      blockAtOrAfter: SCHEDULED.blockAtOrAfter,
      readSwaps: async (_pools: unknown, from: bigint) => {
        reads.push(from)
        return []
      },
    } as unknown as ChainReader
    const db = openDatabase(IN_MEMORY)
    try {
      db.pools.upsertMany([target])
      db.pools.setTracked([target.id], true)
      // Coverage of a pass ten minutes earlier, past Denim, from before the windows were by time.
      db.syncState.setBigInt(syncKeys.volumeLastBlock(target.id), HEAD - 3_000n)
      db.syncState.set(syncKeys.volumeFromTs(target.id), '0')
      const ctx = createPipelineContext({ db, chain, config: loadConfig({}) })
      const whole = BASE_DENIM_BLOCK + 53_995n
      expect(await volumeStep(ctx)).toMatchObject({ incremental: 0, fromBlock: whole })
      expect(db.syncState.get(syncKeys.volumeWindows())).toBe(VOLUME_WINDOWS_BY_TIME)
      // Marked now: the next pass continues from the hour of the head it stored.
      const next = await volumeStep(ctx)
      expect(next.incremental).toBe(1)
      expect(reads).toEqual([
        whole,
        scheduledBlockAtOrAfter(BASE_BLOCK_SCHEDULE, hourStartOf(head.timestamp)),
      ])
    } finally {
      db.close()
    }
  })

  it('reads the Aero pools in the shared scans: three eth_getLogs for six DEXes', async () => {
    let logs = 0
    const chain = createChainReader({
      transport: createFixtureTransport(createSyntheticFixture()),
      addresses: syntheticAddresses(),
      logChunkSize: 100_000,
      onRequest: ({ method }) => {
        if (method === 'eth_getLogs') logs++
      },
    })
    const db = openDatabase(IN_MEMORY)
    try {
      const config = loadConfig({ DEPTHWATCH_LOG_CHUNK: '100000' })
      const ctx = createPipelineContext({ db, chain, config })
      await discoverStep(ctx, { windowChunks: 1_000 })
      const pools = db.pools.list()
      expect(new Set(pools.map((p) => p.dex))).toEqual(new Set(DEXES))
      db.pools.setTracked(
        pools.map((p) => p.id),
        true,
      )
      logs = 0
      const result = await volumeStep(ctx)
      // One 100 000-block chunk per scan: Uniswap v3 with both Slipstreams, Uniswap v4, and
      // Aerodrome v2 with Aero v2.
      expect(logs).toBe(3)
      const world = syntheticWorld()
      expect(result.swaps).toBe(world.pools.reduce((n, p) => n + p.swapCount, 0))
      for (const pool of world.pools)
        expect(db.volume.series(pool.meta.id, 0).reduce((n, b) => n + b.swapCount, 0)).toBe(
          pool.swapCount,
        )
    } finally {
      db.close()
    }
  })

  it('keeps progress below 100 % until the end when the provider caps chunks lower', async () => {
    // --log-chunk 2000, but the provider stated a 1 000-block cap: 447 chunks, not 224.
    const lines = await progressLines('2000', 1_000n, 0)
    const pcts = lines
      .filter((line) => line.includes('swap scan progress'))
      .map((line) => Number(/pct=([\d.]+)%/.exec(line)?.[1]))
    expect(pcts).toHaveLength(447)
    expect(pcts.slice(0, -1).every((pct) => pct < 100)).toBe(true)
    expect(pcts[223]).toBeCloseTo((100 * 224_000) / 446_006, 1)
    expect(pcts.at(-1)).toBe(100)
    // The chunk total follows the served 1 000-block chunks from the first one on: 447, not 224.
    const totals = lines
      .filter((line) => line.includes('swap scan progress'))
      .map((line) => /chunks=\d+\/(\d+) /.exec(line)?.[1])
    expect(new Set(totals)).toEqual(new Set(['447']))
    expect(lines.some((line) => line.includes('stored hourly volume chunks=447'))).toBe(true)
  })
})
