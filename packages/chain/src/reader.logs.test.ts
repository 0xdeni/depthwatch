/**
 * eth_getLogs plumbing: the logs client is used for logs and only for logs, rate-limited and
 * transient failures are retried with backoff, rejected ranges are split, and an endpoint that only
 * serves tiny ranges stops the reader with LogRangeLimitError instead of crawling.
 */

import type { Hex, Transport } from 'viem'
import {
  custom,
  HttpRequestError,
  hexToBigInt,
  InvalidParamsRpcError,
  ResponseBodyTooLargeError,
  RpcRequestError,
  TimeoutError,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { uniswapV3FactoryAbi } from './abi/uniswapV3Factory.js'
import { BASE_ADDRESSES as A } from './addresses.js'
import { addLogs, makeLog, registerLogsError } from './fixtures/builders.js'
import { POCKET_SCAN_WORK_MESSAGE } from './fixtures/fakeRpc.js'
import type { LogRetryEvent } from './internal/context.js'
import { classifyLogsError, LogRangeLimitError } from './internal/logErrors.js'
import { eventTopics } from './internal/logs.js'
import { type CreateChainReaderOptions, createChainReader } from './reader.js'
import { addr, countingTransport, newFixture, TOKEN_A, TOKEN_D } from './test/helpers.js'
import { createFixtureTransport, type Fixture } from './transport/fixture.js'

const ALCHEMY_FREE =
  'Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range. ' +
  'Based on your parameters, this block range should work: [0x1, 0xa]. Upgrade to PAYG for ' +
  'expanded block range.'
const URL = 'https://logs.example'

type GetLogsParams = [{ fromBlock: Hex; toBlock: Hex }]
interface Seen {
  fromBlock: bigint
  toBlock: bigint
}

/** Wraps `inner`; `fail` may turn an eth_getLogs request (nth, 0-based) into a thrown error. */
function scripted(
  inner: Transport,
  fail: (range: Seen, n: number) => Error | undefined,
  seen: Seen[] = [],
): Transport {
  return (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_getLogs') {
        const [{ fromBlock, toBlock }] = params as GetLogsParams
        const range = { fromBlock: hexToBigInt(fromBlock), toBlock: hexToBigInt(toBlock) }
        seen.push(range)
        const error = fail(range, seen.length - 1)
        if (error) throw error
      }
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'scripted', name: 'Scripted', retryCount: 0 })(config)
  }
}

/** Three Uniswap v3 PoolCreated logs at blocks 150, 1 450 and 1 950. */
function poolsFixture(): Fixture {
  const fixture = newFixture()
  addLogs(
    fixture,
    [150n, 1_450n, 1_950n].map((blockNumber, i) =>
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
  )
  return fixture
}

function withRetries(opts: CreateChainReaderOptions = {}) {
  const sleeps: number[] = []
  const events: LogRetryEvent[] = []
  const logRetry = {
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
    onRetry: (event: LogRetryEvent) => events.push(event),
    ...opts.logRetry,
  }
  return { sleeps, events, opts: { ...opts, logRetry } }
}

const http429 = (retryAfter?: string) =>
  new HttpRequestError({
    url: URL,
    status: 429,
    details: 'Too Many Requests',
    headers: new Headers(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }),
  })

describe('logs client', () => {
  it('sends eth_getLogs to the logs transport and every other request to the main one', async () => {
    const fixture = poolsFixture()
    const main = new Map<string, number>()
    const logs = new Map<string, number>()
    const r = createChainReader({
      transport: countingTransport(createFixtureTransport(fixture), main),
      logsTransport: countingTransport(createFixtureTransport(fixture), logs),
      logChunkSize: 1_000,
    })
    const pools = await r.discoverPools('uniswap-v3', 1n, 2_000n)
    expect(pools).toHaveLength(3)
    await r.getLatestBlock()
    await r.readSwaps(pools, 1n, 1_000n)
    expect([...logs.keys()]).toEqual(['eth_getLogs'])
    expect(logs.get('eth_getLogs')).toBe(3) // two discovery chunks + one swap chunk
    expect(main.get('eth_getLogs')).toBeUndefined()
    expect(main.get('eth_call')).toBeGreaterThan(0) // token metadata, multicalled
    expect(main.get('eth_getBlockByNumber')).toBe(1)
  })

  it('defaults to the main transport when no logs endpoint is given', async () => {
    const main = new Map<string, number>()
    const r = createChainReader({
      transport: countingTransport(createFixtureTransport(poolsFixture()), main),
      logChunkSize: 1_000,
    })
    expect(await r.discoverPools('uniswap-v3', 1n, 2_000n)).toHaveLength(3)
    expect(main.get('eth_getLogs')).toBe(2)
  })
})

describe('rate limits and transient failures', () => {
  it('retries HTTP 429 with exponential backoff, honouring Retry-After', async () => {
    const seen: Seen[] = []
    const { sleeps, events, opts } = withRetries({ logChunkSize: 1_000 })
    const transport = scripted(
      createFixtureTransport(poolsFixture()),
      (_, n) => (n === 0 ? http429() : n === 1 ? http429() : n === 3 ? http429('7') : undefined),
      seen,
    )
    const r = createChainReader({ ...opts, transport })
    expect((await r.discoverPools('uniswap-v3', 1n, 2_000n)).map((p) => p.createdAtBlock)).toEqual([
      150n,
      1_450n,
      1_950n,
    ])
    expect(sleeps).toEqual([1_000, 2_000, 7_000])
    expect(events.map((e) => [e.reason, e.attempt, e.fromBlock, e.toBlock])).toEqual([
      ['rate-limit', 1, 1n, 1_000n],
      ['rate-limit', 2, 1n, 1_000n],
      ['rate-limit', 1, 1_001n, 2_000n],
    ])
    expect(seen).toHaveLength(5) // no range was split
  })

  it('retries JSON-RPC rate-limit codes and client timeouts, then gives up with one message', async () => {
    const compute = new RpcRequestError({
      body: {},
      url: URL,
      error: { code: 429, message: 'Your app has exceeded its compute units per second capacity.' },
    })
    const timeout = new TimeoutError({ body: {}, url: URL })
    const { sleeps, opts } = withRetries({ logChunkSize: 2_000 })
    const flaky = createChainReader({
      ...opts,
      transport: scripted(createFixtureTransport(poolsFixture()), (_, n) =>
        n === 0 ? compute : n === 1 ? timeout : undefined,
      ),
    })
    expect(await flaky.discoverPools('uniswap-v3', 1n, 2_000n)).toHaveLength(3)
    expect(sleeps).toEqual([1_000, 2_000])

    const capped = withRetries({ logChunkSize: 2_000, logRetry: { retries: 3, maxDelayMs: 1_500 } })
    const down = createChainReader({
      ...capped.opts,
      transport: scripted(createFixtureTransport(poolsFixture()), () => http429()),
    })
    await expect(down.discoverPools('uniswap-v3', 1n, 2_000n)).rejects.toThrow(
      /blocks 1-2000: still rate limited after 3 retries with backoff \(provider: "Too Many Requests"\)/,
    )
    expect(capped.sleeps).toEqual([1_000, 1_500, 1_500])
  })
})

describe('rejected ranges', () => {
  it("stops at once on Alchemy free tier's 10-block limit, naming the limit", async () => {
    const fixture = poolsFixture()
    registerLogsError(fixture, {
      address: A.uniswapV3.factory,
      topics: [eventTopics(uniswapV3FactoryAbi, 'PoolCreated')],
      fromBlock: 1n,
      toBlock: 2_000n,
      code: -32600,
      message: ALCHEMY_FREE,
    })
    const counts = new Map<string, number>()
    const r = createChainReader({
      transport: countingTransport(createFixtureTransport(fixture), counts),
      logChunkSize: 2_000,
    })
    const error = await r.discoverPools('uniswap-v3', 1n, 40_000n).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LogRangeLimitError)
    expect((error as LogRangeLimitError).details).toMatchObject({
      reason: 'stated',
      maxRange: 10n,
      chunkSize: 2_000n,
      minRange: 100n,
    })
    expect((error as Error).message).toBe(
      `eth_getLogs: the logs endpoint accepts at most 10 blocks per request (provider: "${ALCHEMY_FREE}"), ` +
        'fewer than the 2000-block chunks configured, and the reader does not split ranges below ' +
        '100 blocks. Use a logs endpoint that accepts larger ranges (createChainReader logsRpcUrl / ' +
        'logsTransport), or set logChunkSize to 10 for short scans (a day of Base is 432,000 ' +
        'blocks since Denim).',
    )
    expect(counts.get('eth_getLogs')).toBe(1) // no crawl
  })

  it('halves a rejected range down to the floor, then stops', async () => {
    const seen: Seen[] = []
    const rejectOver = (limit: bigint) => (range: Seen) =>
      range.toBlock - range.fromBlock + 1n > limit
        ? new RpcRequestError({
            body: {},
            url: URL,
            error: { code: -32000, message: 'block range too large' },
          })
        : undefined
    const ok = createChainReader({
      transport: scripted(createFixtureTransport(poolsFixture()), rejectOver(300n), seen),
      logChunkSize: 1_000,
    })
    expect(await ok.discoverPools('uniswap-v3', 1n, 1_000n)).toHaveLength(1)
    // 1 000 → 500 → 250 + 250, then 500 → 250 + 250.
    expect(seen.map((s) => s.toBlock - s.fromBlock + 1n)).toEqual([
      1_000n,
      500n,
      250n,
      250n,
      500n,
      250n,
      250n,
    ])

    seen.length = 0
    const tiny = createChainReader({
      transport: scripted(createFixtureTransport(poolsFixture()), rejectOver(60n), seen),
      logChunkSize: 1_000,
    })
    const error = await tiny.discoverPools('uniswap-v3', 1n, 1_000n).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LogRangeLimitError)
    expect((error as LogRangeLimitError).details).toMatchObject({
      reason: 'floor',
      maxRange: undefined,
      minRange: 100n,
      fromBlock: 1n,
      toBlock: 125n,
    })
    expect((error as Error).message).toMatch(
      /rejected blocks 1-125 \(125 blocks\) \(provider: "block range too large"\), and halving again would go below 100 blocks\..*set logChunkSize to a span the provider accepts/,
    )
    expect(seen.map((s) => s.toBlock - s.fromBlock + 1n)).toEqual([1_000n, 500n, 250n, 125n])
  })

  it('splits by a usable stated maximum and uses it for the following chunks', async () => {
    const seen: Seen[] = []
    const r = createChainReader({
      transport: scripted(
        createFixtureTransport(poolsFixture()),
        (range) =>
          range.toBlock - range.fromBlock + 1n > 400n
            ? new RpcRequestError({
                body: {},
                url: URL,
                error: { code: -32000, message: 'exceed maximum block range: 400' },
              })
            : undefined,
        seen,
      ),
      logChunkSize: 1_000,
    })
    expect(await r.discoverPools('uniswap-v3', 1n, 2_000n)).toHaveLength(3)
    expect(seen.map((s) => [s.fromBlock, s.toBlock])).toEqual([
      [1n, 1_000n],
      [1n, 400n],
      [401n, 800n],
      [801n, 1_000n],
      [1_001n, 1_400n],
      [1_401n, 1_800n],
      [1_801n, 2_000n],
    ])
  })
})

describe('classifyLogsError', () => {
  it('reads kinds, stated maxima and Retry-After from viem errors and their causes', () => {
    const rpc = (code: number, message: string) =>
      new RpcRequestError({ body: {}, url: URL, error: { code, message } })
    expect(classifyLogsError(rpc(-32600, ALCHEMY_FREE))).toMatchObject({
      kind: 'range',
      statedMax: 10n,
      providerMessage: ALCHEMY_FREE,
    })
    expect(
      classifyLogsError(rpc(-32602, 'eth_getLogs is limited to a 10,000 range')),
    ).toMatchObject({
      kind: 'range',
      statedMax: 10_000n,
    })
    expect(classifyLogsError(rpc(-32005, 'query returned more than 10000 results'))).toMatchObject({
      kind: 'range',
      statedMax: undefined,
    })
    expect(
      classifyLogsError(rpc(-32005, 'daily request count exceeded, request rate limited')).kind,
    ).toBe('rate-limit')
    expect(classifyLogsError(rpc(-32007, '10/second request limit reached')).kind).toBe(
      'rate-limit',
    )
    expect(classifyLogsError(http429('3'))).toMatchObject({
      kind: 'rate-limit',
      retryAfterMs: 3_000,
    })
    expect(classifyLogsError(new HttpRequestError({ url: URL, status: 502 })).kind).toBe(
      'transient',
    )
    expect(
      classifyLogsError(new HttpRequestError({ url: URL, cause: new Error('fetch failed') })).kind,
    ).toBe('transient')
    expect(classifyLogsError(new TimeoutError({ body: {}, url: URL })).kind).toBe('transient')
    expect(classifyLogsError(rpc(3, 'execution reverted')).kind).toBe('other')
    expect(classifyLogsError(new Error('Fixture has no answer for eth_getLogs')).kind).toBe('other')
  })

  it("reads the error's data where details only say invalid params (Tenderly, Pocket)", () => {
    // As viem raises them: InvalidParamsRpcError for -32602, the data on its RpcRequestError cause.
    const invalidParams = (message: string, data: unknown) =>
      new InvalidParamsRpcError(
        new RpcRequestError({ body: {}, url: URL, error: { code: -32602, message, data } }),
      )
    const span =
      'Block range too large for public access: maximum 1000 blocks. Try with this block range ' +
      '[0x32c47b0, 0x32c4b98], or use an access key for larger ranges.'
    expect(classifyLogsError(invalidParams('invalid params', span))).toMatchObject({
      kind: 'range',
      statedMax: 1_000n,
      providerMessage: span,
    })
    const results =
      'Query returned more than 20000 results. Try with this block range [0x32bef8b, 0x32bf17e].'
    expect(classifyLogsError(invalidParams('invalid params', results))).toMatchObject({
      kind: 'range',
      statedMax: undefined,
      providerMessage: results,
    })
    expect(
      classifyLogsError(invalidParams('Invalid params', POCKET_SCAN_WORK_MESSAGE)),
    ).toMatchObject({
      kind: 'range',
      statedMax: undefined,
      providerMessage: POCKET_SCAN_WORK_MESSAGE,
    })
    // Without data it stays a failure; an object is read as brief JSON, a URL cut to its origin.
    expect(classifyLogsError(invalidParams('invalid params', undefined))).toMatchObject({
      kind: 'other',
      providerMessage: 'invalid params',
    })
    expect(
      classifyLogsError(invalidParams('invalid params', { reason: 'see https://x.example/k/1' })),
    ).toMatchObject({ kind: 'other', providerMessage: '{"reason":"see https://x.example"}' })
    // Bare hex (revert data) is not a message: the details stay, and so does the kind.
    const hexData = new RpcRequestError({
      body: {},
      url: URL,
      error: { code: -32603, message: 'internal error', data: '0x08c379a0' },
    })
    expect(classifyLogsError(hexData)).toMatchObject({
      kind: 'transient',
      providerMessage: 'internal error',
    })
  })

  it("reads viem's ResponseBodyTooLargeError as a range to split, by its name", () => {
    const tooLarge = new ResponseBodyTooLargeError({ maxSize: 10_485_760, size: 11_000_000 })
    expect(classifyLogsError(tooLarge)).toMatchObject({ kind: 'range', statedMax: undefined })
    expect(classifyLogsError({ name: 'ResponseBodyTooLargeError', message: 'too big' }).kind).toBe(
      'range',
    )
  })
})
