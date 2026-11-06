/**
 * `ChainReader.readStocks` on the fixture transport: the ten stocks as read at block 53,663,272
 * (docs/research/base-contracts.md §2.14) in one request of 60 calls; each call decoded on its own,
 * so a reverted or malformed call nulls only its fields; a failed request gives every stock
 * `raw: null` and never throws; the block passed through; the stock list validated. Statuses come
 * from core's `evaluateStockReading`, which the reader's answers feed.
 */
import { type Address, evaluateStockReading, type StockRawRead } from '@depthwatch/core'
import { http } from 'viem'
import { describe, expect, it } from 'vitest'
import { alchemyRateLimitResponse, createFakeRpcFetch } from './fixtures/fakeRpc.js'
import { addStockFixture, type StockFixtureSpec } from './fixtures/stocks.js'
import { type CreateChainReaderOptions, createChainReader } from './reader.js'
import {
  BASE_STOCKS,
  STOCK_FEEDS,
  STOCK_TOKENS,
  type StockFeed,
  type StockList,
  stockInfos,
} from './stocks.js'
import { callRecorder } from './test/aeroHelpers.js'
import { addr, countingTransport } from './test/helpers.js'
import { createFixture, createFixtureTransport, type Fixture } from './transport/fixture.js'

/** Block 53,663,272: 2026-11-05 23:57:10 UTC. */
const BLOCK = 53_663_272n
const T = 1_793_923_030
const WAD = 10n ** 18n

/** §2.14's feed table and multipliers: answer (8 decimals), age at the block, multiplier. */
const READ: Record<keyof typeof STOCK_TOKENS, [bigint, number, bigint]> = {
  NVDAC: [18_026_191_788n, 1_268, 1_000_537_939_576_369_481n],
  METAC: [59_659_514_823n, 1_165, 1_000_313_792_289_598_084n],
  AAPLC: [34_372_000_000n, 42, WAD],
  GOOGLC: [27_877_509_166n, 2_657, 1_000_377_118_676_784_179n],
  AMZNC: [25_507_500_000n, 765, WAD],
  MSFTC: [52_919_499_999n, 1_767, WAD],
  MSTRC: [12_746_000_000n, 1_832, WAD],
  SNDKC: [81_056_015_000n, 832, WAD],
  SPCXC: [12_221_900_000n, 2_776, WAD],
  TSLAC: [33_866_000_000n, 1_830, WAD],
}
const KEYS = Object.keys(STOCK_TOKENS) as (keyof typeof STOCK_TOKENS)[]
const NVDAC = STOCK_TOKENS.NVDAC.address
const NVDA_FEED = STOCK_FEEDS[NVDAC] as StockFeed

/** Every stock's §2.14 answers at `block`; `nvda` changes NVDAc's. */
function world(nvda: Partial<StockFixtureSpec> = {}, block = BLOCK): Fixture {
  const fixture = createFixture()
  for (const key of KEYS) {
    const [answer, age, multiplierWad] = READ[key]
    const stock = STOCK_TOKENS[key].address
    const spec = { stock, feed: STOCK_FEEDS[stock] ?? null, block, answer, multiplierWad }
    addStockFixture(fixture, { ...spec, updatedAt: T - age, ...(key === 'NVDAC' ? nvda : {}) })
  }
  return fixture
}

function reader(fixture: Fixture, opts: CreateChainReaderOptions = {}) {
  const counts = new Map<string, number>()
  const recorded = callRecorder(createFixtureTransport(fixture))
  const transport = countingTransport(recorded.transport, counts)
  return { r: createChainReader({ transport, ...opts }), counts, requests: recorded.requests }
}

/** No answer at all. */
const NONE: StockRawRead = {
  roundId: null,
  answer: null,
  updatedAt: null,
  decimals: null,
  description: null,
  oracleMultiplierWad: null,
  oraclePaused: null,
  tokenMultiplierWad: null,
  pausedOrdinals: null,
}

/** A sound reading's answers. */
const sound = (answer: bigint, updatedAt: number, multiplier: bigint): StockRawRead => ({
  roundId: 1n,
  answer,
  updatedAt,
  decimals: 8,
  description: '',
  oracleMultiplierWad: multiplier,
  oraclePaused: false,
  tokenMultiplierWad: multiplier,
  pausedOrdinals: [],
})

const infos = stockInfos(BASE_STOCKS)
const judge = (index: number, raw: StockRawRead | null, error?: string) => {
  const info = infos[index]
  if (info === undefined) throw new Error(`no stock ${index}`)
  return evaluateStockReading(info, raw, { blockNumber: BLOCK, timestamp: T }, error)
}
const nvda = async (spec: Partial<StockFixtureSpec>) => {
  const [first] = await reader(world(spec)).r.readStocks(BLOCK)
  if (first === undefined) throw new Error('no reading')
  return { result: first, reading: judge(0, first.raw, first.error ?? undefined) }
}

describe('readStocks', () => {
  it('reads the ten stocks of §2.14 in one request of 60 calls, in list order', async () => {
    const { r, counts, requests } = reader(world())
    expect(r.stocks).toEqual(BASE_STOCKS)
    const results = await r.readStocks(BLOCK)
    expect(counts.get('eth_call')).toBe(1)
    expect(requests.map((calls) => calls.length)).toEqual([60])
    expect(results.map((s) => s.token)).toEqual(BASE_STOCKS.tokens.map((t) => t.address))
    results.forEach((result, i) => {
      const [answer, age, multiplier] = READ[KEYS[i] as keyof typeof READ]
      const ticker = infos[i]?.ticker
      expect(result).toEqual({
        token: BASE_STOCKS.tokens[i]?.address,
        raw: { ...sound(answer, T - age, multiplier), description: `Coinbase ${ticker}` },
        error: null,
      })
      const reading = judge(i, result.raw)
      expect(reading).toMatchObject({ referenceStatus: 'live', feedAgeSeconds: age, error: null })
      expect(reading.referenceUsd).toBeCloseTo(Number(answer) / 1e8, 8)
    })
    // NVDA: 180.26191788 USD per token, the multiplier passed on and never applied.
    expect(judge(0, results[0]?.raw ?? null)).toMatchObject({
      referenceUsd: 180.26191788,
      tokenMultiplierWad: 1_000_537_939_576_369_481n,
      pausedFeatures: [],
      transfersPaused: false,
    })
  })

  it('a reverted or malformed getOracleParams nulls both its fields: unread', async () => {
    for (const fault of [{ revert: ['getOracleParams'] }, { malformed: ['getOracleParams'] }]) {
      const { result, reading } = await nvda(fault as Partial<StockFixtureSpec>)
      expect(result.raw).toMatchObject({
        answer: 18_026_191_788n,
        oracleMultiplierWad: null,
        oraclePaused: null,
        tokenMultiplierWad: 1_000_537_939_576_369_481n,
      })
      expect(result.error).toMatch(fault.revert ? /^getOracleParams: reverted\.$/ : /^getOracle/)
      expect(result.error).not.toMatch(/;|Version: viem/)
      expect(reading).toMatchObject({ referenceStatus: 'unread', referenceUsd: null })
      expect(reading.error).toBe(result.error)
    }
  })

  it('an oracle registry paused answer reads paused, its answer still published', async () => {
    const { result, reading } = await nvda({ oraclePaused: true })
    expect(result.raw?.oraclePaused).toBe(true)
    expect(reading).toMatchObject({
      referenceStatus: 'paused',
      referenceUsd: 180.26191788,
      feedAgeSeconds: 1_268,
      transfersPaused: false,
    })
  })

  it('a reverted pausedFeatures or multiplier nulls those fields and changes no status', async () => {
    const { result, reading } = await nvda({ revert: ['multiplier', 'pausedFeatures'] })
    expect(result.raw).toMatchObject({ tokenMultiplierWad: null, pausedOrdinals: null })
    expect(result.raw?.oracleMultiplierWad).toBe(1_000_537_939_576_369_481n)
    expect(result.error).toBe('multiplier: reverted.; pausedFeatures: reverted.')
    expect(reading).toMatchObject({
      referenceStatus: 'live',
      tokenMultiplierWad: null,
      pausedFeatures: null,
      transfersPaused: null,
    })
  })

  it('passes pausedFeatures on as ordinals: TRANSFER paused is a transfer pause', async () => {
    const { result, reading } = await nvda({ pausedOrdinals: [2, 0] })
    expect(result.raw?.pausedOrdinals).toEqual([2, 0])
    expect(reading).toMatchObject({
      referenceStatus: 'live',
      pausedFeatures: ['transfer', 'burn'],
      transfersPaused: true,
    })
  })

  it('every call malformed nulls every field without throwing', async () => {
    const malformed = [
      'latestRoundData',
      'decimals',
      'description',
      'getOracleParams',
      'multiplier',
      'pausedFeatures',
    ] as const
    const { result, reading } = await nvda({ malformed })
    expect(result.raw).toEqual(NONE)
    const named = (result.error ?? '').split('; ').map((part) => part.split(':')[0])
    expect(named).toEqual([...malformed])
    expect(result.error).toContain('decimals: Data size of 1 bytes is too small')
    expect(reading.referenceStatus).toBe('unread')
  })

  it('a failed request gives every stock raw: null and the request error, and never throws', async () => {
    const rpc = createFakeRpcFetch(world(), {
      respond: (request) => alchemyRateLimitResponse(request.id),
    })
    const r = createChainReader({
      transport: http('https://base-mainnet.g.alchemy.com/v2', { fetchFn: rpc.fetch }),
      logRetry: { retries: 1, sleep: async () => {} },
    })
    const results = await r.readStocks(BLOCK)
    expect(results).toHaveLength(10)
    const [first] = results
    expect(first?.error).toMatch(/eth_call aggregate3 ×60 @ 53663272 \(stocks\)/)
    for (const result of results) expect(result).toEqual({ ...first, token: result.token })
    expect(results.every((s) => s.raw === null)).toBe(true)
    expect(judge(0, null, first?.error ?? undefined)).toMatchObject({
      referenceStatus: 'unread',
      error: first?.error,
    })
  })

  it('reads at the block it is given', async () => {
    const fixture = world()
    const later = world({ answer: 18_100_000_000n, updatedAt: T + 30, roundId: 2n }, BLOCK + 150n)
    Object.assign(fixture.calls, later.calls)
    const { r } = reader(fixture)
    const [at] = await r.readStocks(BLOCK)
    const [after] = await r.readStocks(BLOCK + 150n)
    expect(at?.raw).toMatchObject({ roundId: 1n, answer: 18_026_191_788n })
    expect(after?.raw).toMatchObject({ roundId: 2n, answer: 18_100_000_000n, updatedAt: T + 30 })
    // Nothing is registered at the block between: the one request misses.
    const [between] = await r.readStocks(BLOCK + 1n)
    expect(between).toMatchObject({ raw: null, error: expect.stringMatching(/no answer/) })
  })

  it('splits the calls over several multicalls and keeps each answer with its stock', async () => {
    const one = await reader(world()).r.readStocks(BLOCK)
    const { r, requests } = reader(world(), { maxCallsPerMulticall: 7 })
    expect(await r.readStocks(BLOCK)).toEqual(one)
    expect(requests.map((calls) => calls.length)).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 4])
  })

  it('rethrows the reader’s abort instead of reading the stocks unread', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    const { r } = reader(world(), { signal: controller.signal })
    await expect(r.readStocks(BLOCK)).rejects.toBe(controller.signal.reason)
  })
})

describe('the stock list', () => {
  const TOKEN = addr(0xb2c1)
  const BARE = addr(0xb2c2)
  const FEED = addr(0xfe01)
  const REGISTRY = addr(0x0ac1e)
  const checksummed = (a: Address) => a.replace(/[a-f]/g, (c) => c.toUpperCase()) as Address
  const synthetic: StockList = {
    tokens: [
      { address: checksummed(TOKEN), symbol: 'TESTc', name: 'Test Inc.', decimals: 8 },
      { address: BARE, symbol: 'BAREc', name: 'Bare Corp.', decimals: 8 },
    ],
    feeds: { [checksummed(TOKEN)]: { ...NVDA_FEED, feed: checksummed(FEED), ticker: 'TEST' } },
    oracleRegistry: checksummed(REGISTRY),
  }

  it('is injected, lowercased, and a stock without a feed gets its token calls only', async () => {
    const fixture = createFixture()
    const at = { block: BLOCK, answer: 4_200_000_000n, updatedAt: T - 60 }
    const feed = { ...NVDA_FEED, feed: FEED, ticker: 'TEST' }
    addStockFixture(fixture, { ...at, stock: TOKEN, feed, oracleRegistry: REGISTRY })
    addStockFixture(fixture, { ...at, stock: BARE, feed: null })
    const { r, requests } = reader(fixture, { stocks: synthetic })
    expect(r.stocks.tokens.map((t) => t.address)).toEqual([TOKEN, BARE])
    expect(Object.keys(r.stocks.feeds)).toEqual([TOKEN])
    expect(r.stocks.feeds[TOKEN]?.feed).toBe(FEED)
    expect(r.stocks.oracleRegistry).toBe(REGISTRY)
    const [test, bare] = await r.readStocks(BLOCK)
    expect(requests.map((calls) => calls.length)).toEqual([8])
    expect(test).toMatchObject({ token: TOKEN, raw: { answer: 4_200_000_000n }, error: null })
    expect(bare).toEqual({
      token: BARE,
      raw: { ...NONE, tokenMultiplierWad: WAD, pausedOrdinals: [] },
      error: null,
    })
    const [testInfo, bareInfo] = stockInfos(r.stocks)
    expect(bareInfo).toEqual({ token: r.stocks.tokens[1], ticker: 'BARE', feed: null })
    const block = { blockNumber: BLOCK, timestamp: T }
    if (testInfo === undefined || bareInfo === undefined) throw new Error('no stock info')
    expect(evaluateStockReading(testInfo, test?.raw ?? null, block).referenceStatus).toBe('live')
    expect(evaluateStockReading(bareInfo, bare?.raw ?? null, block)).toMatchObject({
      referenceStatus: 'no-feed',
      tokenMultiplierWad: WAD,
      transfersPaused: false,
    })
  })

  it('refuses a malformed address, a token listed twice and a feed for no listed token', () => {
    const make = (stocks: StockList) => () => createChainReader({ stocks })
    const [first] = synthetic.tokens
    if (first === undefined) throw new Error('no token')
    expect(make({ ...synthetic, oracleRegistry: '0x1234' as Address })).toThrow(/oracleRegistry/)
    expect(make({ ...synthetic, tokens: [first, { ...first, address: TOKEN }] })).toThrow(
      /listed twice/,
    )
    const stray = { ...synthetic.feeds, [addr(0xb2c3)]: NVDA_FEED }
    expect(make({ ...synthetic, feeds: stray })).toThrow(/not a token of the list/)
  })

  it('reads no request for an empty list', async () => {
    const { r, counts } = reader(createFixture(), {
      stocks: { tokens: [], feeds: {}, oracleRegistry: REGISTRY },
    })
    expect(await r.readStocks(BLOCK)).toEqual([])
    expect(counts.size).toBe(0)
  })
})
