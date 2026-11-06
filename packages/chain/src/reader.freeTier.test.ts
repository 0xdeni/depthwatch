/**
 * The reader against the HTTP answers of real endpoints, replayed by a fake `fetch` behind viem's
 * own `http()` transport: Alchemy's free tier (HTTP 400, -32600, 10-block `eth_getLogs`), Base's
 * public endpoint (HTTP 429, -32011), Tenderly's public gateway (HTTP 200, -32602, a span or result
 * limit in the error's `data`), Pocket (HTTP 400, -32602, a scan-work cap in `data`) and an answer
 * over viem's response size limit. Also: `rpcUrl` / `logsRpcUrl` routing by URL, and swap
 * timestamps that cost a handful of headers however small the log chunk is.
 */
import type { Hex } from '@depthwatch/core'
import { http } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uniswapV3FactoryAbi } from './abi/uniswapV3Factory.js'
import { uniswapV3PoolAbi } from './abi/uniswapV3Pool.js'
import { BASE_ADDRESSES as A } from './addresses.js'
import { addLogs, makeLog, setClock } from './fixtures/builders.js'
import {
  alchemyFreeTierGetLogs,
  alchemyFreeTierMessage,
  basePublicRateLimitResponse,
  createFakeRpcFetch,
  type FakeRpcOptions,
  pocketScanWorkTooLargeResponse,
  tenderlyPublicGetLogs,
} from './fixtures/fakeRpc.js'
import { LogRangeLimitError } from './internal/logErrors.js'
import { type CreateChainReaderOptions, createChainReader } from './reader.js'
import { BASE_BLOCK_SCHEDULE, BASE_DENIM_BLOCK, scheduledTimestamp } from './schedule.js'
import { addr, newFixture, poolMeta, TOKEN_A, TOKEN_D } from './test/helpers.js'
import type { Fixture } from './transport/fixture.js'

const URL = 'https://base-mainnet.example/v2'
const HEAD = 200_000n
const HEAD_TS = 1_800_000_000
/**
 * The fixture's 2 s clock (Base's spacing before Denim, not Base's own schedule), so the reader
 * times swaps from anchor headers.
 */
const tsOf = (block: bigint) => HEAD_TS - Number(HEAD - block) * 2

const v3 = poolMeta({
  dex: 'uniswap-v3',
  address: addr(0x401),
  token0: TOKEN_A,
  token1: TOKEN_D,
  feePips: 500,
  tickSpacing: 10,
})

/** Uniswap v3 PoolCreated at blocks 150 and 1 950, and v3 swaps at `swapBlocks`. */
function world(swapBlocks: readonly bigint[] = []): Fixture {
  const fixture = newFixture(HEAD, HEAD_TS)
  addLogs(fixture, [
    ...[150n, 1_950n].map((blockNumber, i) =>
      makeLog({
        address: A.uniswapV3.factory,
        abi: uniswapV3FactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: TOKEN_A.address,
          token1: TOKEN_D.address,
          fee: 500,
          tickSpacing: 10,
          pool: addr(0x5000 + i),
        },
        blockNumber,
        logIndex: 0,
      }),
    ),
    ...swapBlocks.map((blockNumber) =>
      makeLog({
        address: v3.address as Hex,
        abi: uniswapV3PoolAbi,
        eventName: 'Swap',
        args: {
          sender: addr(0x7007),
          recipient: addr(0x7007),
          amount0: 1_000n,
          amount1: -2_000n,
          sqrtPriceX96: 1n << 96n,
          liquidity: 1n,
          tick: 0,
        },
        blockNumber,
        logIndex: 0,
      }),
    ),
  ])
  return fixture
}

/** A reader whose only endpoint is the fake one; backoff sleeps are recorded, not waited. */
function overHttp(fixture: Fixture, fake: FakeRpcOptions, opts: CreateChainReaderOptions = {}) {
  const rpc = createFakeRpcFetch(fixture, fake)
  const sleeps: number[] = []
  const reader = createChainReader({
    transport: http(URL, { fetchFn: rpc.fetch, retryCount: 0 }),
    logRetry: { sleep: async (ms) => void sleeps.push(ms) },
    ...opts,
  })
  const count = (method: string) => rpc.calls.filter((c) => c.method === method).length
  return { reader, calls: rpc.calls, sleeps, count }
}

describe('Alchemy free tier: HTTP 400, -32600, at most 10 blocks per eth_getLogs', () => {
  it('stops after one request at the CLI default chunk, naming the limit', async () => {
    const { reader, count } = overHttp(
      world(),
      { getLogs: alchemyFreeTierGetLogs() },
      { logChunkSize: 2_000 },
    )
    const error = await reader.discoverPools('uniswap-v3', 1n, 40_000n).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LogRangeLimitError)
    expect((error as LogRangeLimitError).details).toEqual({
      reason: 'stated',
      maxRange: 10n,
      chunkSize: 2_000n,
      minRange: 100n,
      fromBlock: 1n,
      toBlock: 2_000n,
      providerMessage: alchemyFreeTierMessage(1n),
    })
    expect(alchemyFreeTierMessage(1n)).toContain('this block range should work: [0x1, 0xa]')
    expect(count('eth_getLogs')).toBe(1)
  })

  it('also stops when an explicit chunk is above the limit (20 blocks)', async () => {
    const { reader, count } = overHttp(
      world(),
      { getLogs: alchemyFreeTierGetLogs() },
      { logChunkSize: 20 },
    )
    const error = await reader.discoverPools('uniswap-v3', 1n, 2_000n).catch((e: unknown) => e)
    expect((error as LogRangeLimitError).details).toMatchObject({
      reason: 'stated',
      maxRange: 10n,
      chunkSize: 20n,
      minRange: 20n,
    })
    expect((error as Error).message).toMatch(
      /set logChunkSize to 10 for short scans \(a day of Base is 432,000 blocks since Denim\)\.$/,
    )
    expect(count('eth_getLogs')).toBe(1)
  })

  it('works at an explicit 10-block chunk: a pre-Denim day of 2 s blocks (43,200), no fail-fast, six headers', async () => {
    const swapBlocks = [156_805n, 160_000n, 171_234n, 185_001n, 199_999n, HEAD]
    const { reader, calls, count } = overHttp(
      world(swapBlocks),
      { getLogs: alchemyFreeTierGetLogs() },
      { logChunkSize: 10 },
    )
    const from = HEAD - 43_200n
    const swaps = await reader.readSwaps([v3], from, HEAD)
    expect(swaps.map((s) => [s.blockNumber, s.timestamp])).toEqual(
      swapBlocks.map((b) => [b, tsOf(b)]),
    )
    const logs = calls.filter((c) => c.method === 'eth_getLogs')
    expect(logs).toHaveLength(4_321) // ⌈43 201 / 10⌉, one filter
    expect(logs.every((c) => (c.toBlock ?? 0n) - (c.fromBlock ?? 0n) < 10n)).toBe(true)
    // Anchors 150 000, 160 000, …, 200 000: independent of the 10-block log chunk.
    expect(count('eth_getBlockByNumber')).toBe(6)

    expect(await reader.discoverPools('uniswap-v3', 1n, 2_000n)).toHaveLength(2)
  })

  it("works at an explicit 10-block chunk since Denim: an hour of Base's 200 ms blocks, two headers", async () => {
    const head = BASE_DENIM_BLOCK + 300_000n
    const from = head - 18_000n // 2026-11-06 09:40:01 UTC, an hour before the head
    const swapBlocks = [from, from + 4n, from + 5n, head - 1n, head]
    const fixture = world(swapBlocks)
    setClock(fixture, { latestBlock: head, schedule: BASE_BLOCK_SCHEDULE })
    const { reader, calls, count } = overHttp(
      fixture,
      { getLogs: alchemyFreeTierGetLogs() },
      { logChunkSize: 10 },
    )
    const swaps = await reader.readSwaps([v3], from, head)
    expect(swaps.map((s) => [s.blockNumber, s.timestamp])).toEqual(
      swapBlocks.map((b) => [b, scheduledTimestamp(BASE_BLOCK_SCHEDULE, b)]),
    )
    // Five 200 ms blocks share each whole-second header timestamp.
    expect(swaps.slice(0, 3).map((s) => s.timestamp)).toEqual([
      1_793_958_001, 1_793_958_001, 1_793_958_002,
    ])
    const logs = calls.filter((c) => c.method === 'eth_getLogs')
    expect(logs).toHaveLength(1_801) // ⌈18 001 / 10⌉, one filter
    expect(logs.every((c) => (c.toBlock ?? 0n) - (c.fromBlock ?? 0n) < 10n)).toBe(true)
    // The schedule, confirmed by the scan's last block and its first swap's block.
    expect(count('eth_getBlockByNumber')).toBe(2)
  })
})

describe('Base public endpoint: HTTP 429, -32011 "request limit reached"', () => {
  it('backs off and retries the same range until it is served', async () => {
    const { reader, calls, sleeps } = overHttp(
      world(),
      { getLogs: ({ id, n }) => (n < 3 ? basePublicRateLimitResponse(id) : undefined) },
      { logChunkSize: 2_000 },
    )
    expect(await reader.discoverPools('uniswap-v3', 1n, 2_000n)).toHaveLength(2)
    expect(sleeps).toEqual([1_000, 2_000, 4_000])
    const logs = calls.filter((c) => c.method === 'eth_getLogs')
    expect(logs.map((c) => [c.fromBlock, c.toBlock])).toEqual(Array(4).fill([1n, 2_000n]))
  })

  it('gives up after the retry cap with one message', async () => {
    const { reader, count, sleeps } = overHttp(
      world(),
      { getLogs: ({ id }) => basePublicRateLimitResponse(id) },
      { logChunkSize: 2_000, logRetry: { retries: 2, sleep: async () => {} } },
    )
    await expect(reader.discoverPools('uniswap-v3', 1n, 2_000n)).rejects.toThrow(
      'eth_getLogs blocks 1-2000: still rate limited after 2 retries with backoff (provider: "request limit reached")',
    )
    expect(count('eth_getLogs')).toBe(3)
    expect(sleeps).toEqual([])
  })
})

describe("Tenderly's public gateway: HTTP 200, -32602, the reason only in the error's data", () => {
  const spans = (calls: readonly { method: string; fromBlock?: bigint; toBlock?: bigint }[]) =>
    calls
      .filter((c) => c.method === 'eth_getLogs')
      .map((c) => [c.fromBlock ?? 0n, c.toBlock ?? 0n] as const)

  it('splits 2,000-block chunks straight to the stated 1,000 and keeps that size', async () => {
    const { reader, calls } = overHttp(
      world(),
      { getLogs: tenderlyPublicGetLogs() },
      { logChunkSize: 2_000 },
    )
    expect(await reader.discoverPools('uniswap-v3', 1n, 4_000n)).toHaveLength(2)
    expect(spans(calls)).toEqual([
      [1n, 2_000n],
      [1n, 1_000n],
      [1_001n, 2_000n],
      [2_001n, 3_000n],
      [3_001n, 4_000n],
    ])
  })

  it('halves a range that would return more than 20,000 results', async () => {
    const { reader, calls } = overHttp(
      world(),
      { getLogs: tenderlyPublicGetLogs((from, to) => to - from + 1n > 250n) },
      { logChunkSize: 1_000 },
    )
    expect(await reader.discoverPools('uniswap-v3', 1n, 1_000n)).toHaveLength(1)
    expect(spans(calls).map(([from, to]) => to - from + 1n)).toEqual([
      1_000n,
      500n,
      250n,
      250n,
      500n,
      250n,
      250n,
    ])
  })
})

describe('Pocket: HTTP 400, -32602, a scan-work cap in the data', () => {
  it('halves the rejected range until it is served', async () => {
    const { reader, count } = overHttp(
      world(),
      {
        getLogs: ({ id, fromBlock, toBlock }) =>
          toBlock - fromBlock + 1n > 500n ? pocketScanWorkTooLargeResponse(id) : undefined,
      },
      { logChunkSize: 2_000 },
    )
    expect(await reader.discoverPools('uniswap-v3', 1n, 2_000n)).toHaveLength(2)
    expect(count('eth_getLogs')).toBe(7) // 2 000 → 1 000 → 500 + 500, twice
  })
})

describe("viem's response size limit (maxResponseBodySize, 10 MiB by default)", () => {
  it('halves a range whose answer is over the limit', async () => {
    const big = (id: unknown) =>
      new Response(`${JSON.stringify({ jsonrpc: '2.0', id, result: [] })}${' '.repeat(20_000)}`, {
        headers: { 'Content-Type': 'application/json' },
      })
    const rpc = createFakeRpcFetch(world(), {
      getLogs: ({ id, fromBlock, toBlock }) =>
        toBlock - fromBlock + 1n > 500n ? big(id) : undefined,
    })
    const reader = createChainReader({
      transport: http(URL, { fetchFn: rpc.fetch, retryCount: 0, maxResponseBodySize: 10_000 }),
      logChunkSize: 1_000,
    })
    expect(await reader.discoverPools('uniswap-v3', 1n, 1_000n)).toHaveLength(1)
    const logs = rpc.calls.filter((c) => c.method === 'eth_getLogs')
    expect(logs.map((c) => [c.fromBlock, c.toBlock])).toEqual([
      [1n, 1_000n],
      [1n, 500n],
      [501n, 1_000n],
    ])
  })
})

describe('rpcUrl and logsRpcUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const MAIN = 'https://main.example/v2'
  const LOGS = 'https://logs.example/'

  it('sends eth_getLogs to logsRpcUrl and every other request to rpcUrl', async () => {
    const rpc = createFakeRpcFetch(world([1_010n]))
    vi.stubGlobal('fetch', rpc.fetch)
    const reader = createChainReader({ rpcUrl: MAIN, logsRpcUrl: LOGS, logChunkSize: 1_000 })
    expect(await reader.discoverPools('uniswap-v3', 1n, 2_000n)).toHaveLength(2)
    expect(await reader.readSwaps([v3], 1_000n, 1_999n)).toHaveLength(1)
    const byUrl = (url: string) =>
      new Set(rpc.calls.filter((c) => c.url === url).map((c) => c.method))
    expect([...byUrl(LOGS)]).toEqual(['eth_getLogs'])
    expect(byUrl(MAIN).has('eth_getLogs')).toBe(false)
    expect(byUrl(MAIN).has('eth_call')).toBe(true)
    expect(byUrl(MAIN).has('eth_getBlockByNumber')).toBe(true)
  })

  it('uses rpcUrl for logs by default, without viem retries under our backoff', async () => {
    const rpc = createFakeRpcFetch(world(), {
      getLogs: ({ n }) =>
        n === 0
          ? new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '3' } })
          : undefined,
    })
    vi.stubGlobal('fetch', rpc.fetch)
    const sleeps: number[] = []
    const reader = createChainReader({
      rpcUrl: MAIN,
      logChunkSize: 2_000,
      logRetry: { sleep: async (ms) => void sleeps.push(ms) },
    })
    expect(await reader.discoverPools('uniswap-v3', 1n, 2_000n)).toHaveLength(2)
    expect(new Set(rpc.calls.map((c) => c.url))).toEqual(new Set([MAIN]))
    // One 429, honoured Retry-After, one retry: viem's own retries would add requests here.
    expect(rpc.calls.filter((c) => c.method === 'eth_getLogs')).toHaveLength(2)
    expect(sleeps).toEqual([3_000])
  })
})
