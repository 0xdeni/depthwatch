/**
 * `volume` is incremental: a later pass reads from the first block of the hour that held the last
 * pass's head, rewrites that hour complete and keeps the hours before it,
 * so a looping `run` stops paying the whole 24 h window on every pass. Pools without coverage of
 * the window (newly tracked, a wider `--hours`) still get the whole window, read once per DEX.
 */
import {
  addLogs,
  aerodromePoolAbi,
  createChainReader,
  createFixture,
  createFixtureTransport,
  type Fixture,
  makeLog,
  setClock,
  uniswapV3PoolAbi,
} from '@depthwatch/chain'
import type { Address, PoolMeta } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { custom, hexToBigInt, type Transport } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { DEMO_MARKER_KEY, resetDemoHistory } from '../demo.js'
import { createPipelineContext, syncKeys } from './context.js'
import { coverageHour, planVolumeScan, volumeStep } from './volume.js'

/** 1 800 000 000 is an hour boundary; the head sits 1 000 s into the next hour. */
const HOUR = 1_800_000_000
const HEAD = 100_000n
const HEAD_TS = HOUR + 1_000
const addr = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address
const token = (n: number, symbol: string) => ({
  address: addr(n),
  symbol,
  name: symbol,
  decimals: 18,
})

const V3: PoolMeta = {
  id: `uniswap-v3:${addr(0x401)}`,
  dex: 'uniswap-v3',
  kind: 'concentrated',
  address: addr(0x401),
  poolId: null,
  token0: token(0xaa, 'AAA'),
  token1: token(0xdd, 'DDD'),
  feePips: 500,
  tickSpacing: 10,
  stable: false,
  hooks: null,
  createdAtBlock: 1n,
}
const V2: PoolMeta = {
  ...V3,
  id: `aerodrome-v2:${addr(0x402)}`,
  dex: 'aerodrome-v2',
  kind: 'constant-product',
  address: addr(0x402),
  feePips: 3_000,
  tickSpacing: null,
}

const v3Swap = (blockNumber: bigint) =>
  makeLog({
    address: V3.address as Address,
    abi: uniswapV3PoolAbi,
    eventName: 'Swap',
    args: {
      sender: addr(0x7007),
      recipient: addr(0x7007),
      amount0: 10n ** 18n,
      amount1: -(10n ** 18n),
      sqrtPriceX96: 1n << 96n,
      liquidity: 1n,
      tick: 0,
    },
    blockNumber,
    logIndex: 0,
  })
const v2Swap = (blockNumber: bigint) =>
  makeLog({
    address: V2.address as Address,
    abi: aerodromePoolAbi,
    eventName: 'Swap',
    args: {
      sender: addr(0x7007),
      to: addr(0x7007),
      amount0In: 10n ** 18n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 10n ** 18n,
    },
    blockNumber,
    logIndex: 0,
  })

/** eth_getLogs ranges per filter address, over the fixture. */
function recording(fixture: Fixture, ranges: Map<string, Array<[bigint, bigint]>>): Transport {
  const inner = createFixtureTransport(fixture)
  return (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_getLogs') {
        const [filter] = params as [
          { address: string[]; fromBlock: `0x${string}`; toBlock: `0x${string}` },
        ]
        const key = filter.address.join(',')
        ranges.set(key, [
          ...(ranges.get(key) ?? []),
          [hexToBigInt(filter.fromBlock), hexToBigInt(filter.toBlock)],
        ])
      }
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'recording', name: 'Recording', retryCount: 0 })(config)
  }
}

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

function setup() {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: HEAD_TS })
  // HEAD − 600 is in the hour before HOUR (ts HOUR − 200), HEAD − 100 in hour HOUR.
  addLogs(fixture, [v3Swap(HEAD - 20_000n), v3Swap(HEAD - 600n), v3Swap(HEAD - 100n)])
  const ranges = new Map<string, Array<[bigint, bigint]>>()
  const chain = createChainReader({ transport: recording(fixture, ranges), logChunkSize: 100 })
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  db.pools.upsertMany([V3, V2])
  db.pools.setTracked([V3.id], true)
  const ctx = createPipelineContext({ db, chain, config: loadConfig({}) })
  /** Moves the head on by `blocks` (2 s each). */
  const advance = (blocks: bigint) =>
    setClock(fixture, { latestBlock: HEAD + blocks, latestTimestamp: HEAD_TS + Number(blocks) * 2 })
  /** Blocks requested for `pool` since the last call. */
  const blocksFor = (pool: PoolMeta) => {
    const seen = ranges.get(pool.address as string) ?? []
    ranges.delete(pool.address as string)
    return seen.reduce((n, [from, to]) => n + to - from + 1n, 0n)
  }
  return { fixture, db, ctx, advance, blocksFor }
}

describe('planVolumeScan', () => {
  // The window's first hour is HOUR − 24 h, whose first block is HEAD − 43 700 (2 s blocks).
  const window = { fromBlock: HEAD - 43_700n, fromTs: HOUR - 24 * 3_600 }
  const start = { hour: HOUR, firstBlock: HEAD - 500n }

  it('reads the whole window without coverage of it', () => {
    const whole = {
      fromBlock: window.fromBlock,
      keepFromTs: window.fromTs,
      coveredFromTs: window.fromTs,
    }
    expect(planVolumeScan(window, undefined, undefined)).toEqual(whole)
    // `--hours` wider than the stored coverage, or coverage whose last block is a day old.
    const coverage = { lastBlock: HEAD - 10n, fromTs: window.fromTs + 3_600 }
    expect(planVolumeScan(window, coverage, start)).toEqual(whole)
    expect(planVolumeScan(window, { lastBlock: HEAD - 44_000n, fromTs: 0 }, undefined)).toEqual(
      whole,
    )
    const firstHour = { hour: window.fromTs, firstBlock: window.fromBlock }
    expect(planVolumeScan(window, { lastBlock: HEAD - 43_000n, fromTs: 0 }, firstHour)).toEqual(
      whole,
    )
  })

  it('starts at the first block of the last block’s hour', () => {
    expect(planVolumeScan(window, { lastBlock: HEAD - 150n, fromTs: 0 }, start)).toEqual({
      fromBlock: HEAD - 500n,
      keepFromTs: HOUR,
      coveredFromTs: 0,
    })
  })
})

describe('coverageHour', () => {
  const window = { fromBlock: HEAD - 43_700n, fromTs: HOUR - 24 * 3_600 }
  const head = { number: HEAD }
  // 2 s blocks: block HEAD − 500 has timestamp HOUR.
  const tsOf = (block: bigint) => HEAD_TS - Number(HEAD - block) * 2
  const chain = {
    getBlockTimestamp: async (block: bigint) => tsOf(block),
    blockAtOrAfter: async (timestamp: number) => HEAD - BigInt((HEAD_TS - timestamp) / 2),
  } as unknown as Parameters<typeof coverageHour>[0]

  it('reads the hour from the last block’s header and finds that hour’s first block', async () => {
    // HEAD − 150 is 300 s before the head: hour HOUR, whose first block is HEAD − 500.
    expect(await coverageHour(chain, window, head, HEAD - 150n)).toEqual({
      hour: HOUR,
      firstBlock: HEAD - 500n,
    })
    // A last block past the head (a lagging node) counts as the head.
    expect((await coverageHour(chain, window, head, HEAD + 50n))?.hour).toBe(HOUR)
  })

  it('leaves blocks before the window and in its first hour to a whole-window read', async () => {
    expect(await coverageHour(chain, window, head, HEAD - 44_000n)).toBeUndefined()
    expect(await coverageHour(chain, window, head, HEAD - 43_000n)).toBeUndefined()
  })
})

describe('volumeStep across passes', () => {
  it('reads only from the last head’s hour on, keeping the hours before it', async () => {
    const { fixture, db, ctx, advance, blocksFor } = setup()
    const first = await volumeStep(ctx)
    expect(first).toMatchObject({ fromBlock: HEAD - 43_700n, incremental: 0, swaps: 3, dropped: 0 })
    expect(blocksFor(V3)).toBe(43_701n)
    expect(db.syncState.getBigInt(syncKeys.volumeLastBlock(V3.id))).toBe(HEAD)

    // Five minutes later: one new swap; the head of the first pass was in hour HOUR.
    advance(150n)
    addLogs(fixture, [v3Swap(HEAD + 100n)])
    const second = await volumeStep(ctx)
    const start = HEAD - 500n
    // HEAD − 600 is in the hour before: not read again, its stored bucket stays.
    expect(second).toMatchObject({ fromBlock: start, fromTs: HOUR, incremental: 1, swaps: 2 })
    expect(second.dropped).toBe(0)
    expect(blocksFor(V3)).toBe(HEAD + 150n - start + 1n)
    expect(db.volume.swapCount(V3.id, 0)).toBe(4)
    expect(db.volume.get(V3.id, HOUR - 3_600)?.swapCount).toBe(1)
    expect(db.volume.get(V3.id, HOUR)?.swapCount).toBe(2) // HEAD − 100 and HEAD + 100

    // Rerunning at the same head rewrites the same hour: idempotent.
    await volumeStep(ctx)
    expect(db.volume.swapCount(V3.id, 0)).toBe(4)
  })

  it('gives a newly tracked pool the whole window, on its own DEX only', async () => {
    const { fixture, db, ctx, advance, blocksFor } = setup()
    await volumeStep(ctx)
    blocksFor(V3)
    addLogs(fixture, [v2Swap(HEAD - 30_000n)])
    db.pools.setTracked([V2.id], true)
    advance(150n)
    const result = await volumeStep(ctx)
    expect(result).toMatchObject({ pools: 2, incremental: 1, swaps: 2, dropped: 0 })
    expect(blocksFor(V3)).toBe(HEAD + 150n - (HEAD - 500n) + 1n)
    expect(blocksFor(V2)).toBe(43_701n + 150n)
    expect(db.volume.swapCount(V2.id, 0)).toBe(1)
  })

  it('values the kept hours at the current prices, like a full rescan', async () => {
    const { db, ctx, advance } = setup()
    await volumeStep(ctx) // no stored prices yet: USD unknown
    expect(db.volume.sumUsd(V3.id, 0)).toBeNull()
    // token1 (DDD) at $2: each swap moved 1 DDD, so each kept swap is worth $2.
    db.prices.replaceAll([{ token: V3.token1.address, usd: 2, via: ['test'] }])
    advance(150n)
    const result = await volumeStep(ctx)
    expect(result).toMatchObject({ incremental: 1, swaps: 1, dropped: 0 })
    expect(db.volume.sumUsd(V3.id, 0)).toBe(6) // three swaps, two of them in kept hours
    expect(db.volume.get(V3.id, HOUR - 3_600)?.volumeUsd).toBe(2) // HEAD − 600, kept
    expect(db.volume.get(V3.id, HOUR - 11 * 3_600)?.volumeUsd).toBe(2) // HEAD − 20 000, kept
    expect(db.volume.get(V3.id, HOUR)?.volumeUsd).toBe(2) // HEAD − 100, rewritten
  })

  it('reads the whole window again once a demo reset dropped the buckets', async () => {
    const { db, ctx, blocksFor } = setup()
    db.syncState.set(DEMO_MARKER_KEY, '1')
    await volumeStep(ctx)
    blocksFor(V3)
    resetDemoHistory(db)
    expect(db.syncState.get(syncKeys.volumeFromTs(V3.id))).toBeUndefined()
    expect(await volumeStep(ctx)).toMatchObject({ incremental: 0, swaps: 3 })
    expect(blocksFor(V3)).toBe(43_701n)
    expect(db.volume.swapCount(V3.id, 0)).toBe(3)
  })
})
