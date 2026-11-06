import {
  addLogs,
  BASE_ADDRESSES,
  createChainReader,
  createFixture,
  createFixtureTransport,
  erc20Abi,
  type Fixture,
  LogRangeLimitError,
  makeLog,
  registerCall,
  setClock,
  uniswapV3FactoryAbi,
} from '@depthwatch/chain'
import { type Address, DEXES, type Dex } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { custom, type Hex, hexToBigInt, RpcRequestError, type Transport } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createLogger } from '../log.js'
import { describeError } from '../rpc.js'
import { createPipelineContext } from './context.js'
import {
  DISCOVER_WARN_CHUNKS,
  defaultStartBlock,
  discoverStep,
  formatDuration,
} from './discover.js'
import { runIteration } from './run.js'

const HEAD = 1_000n
const KEY = 'discover:uniswap-v3:lastBlock'
const addr = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address
const TOKENS = [addr(0xaa), addr(0xdd)] as const
const ALCHEMY_FREE =
  'Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range. ' +
  'Based on your parameters, this block range should work: [0x1, 0xa]. Upgrade to PAYG for ' +
  'expanded block range.'

/** Uniswap v3 pools created at blocks 150, 450 and 850; both test DEXes start at block 1. */
function world(head = HEAD): Fixture {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: head, latestTimestamp: 1_800_000_000 })
  for (const [i, to] of TOKENS.entries()) {
    registerCall(fixture, { to, abi: erc20Abi, functionName: 'symbol', result: `T${i}` })
    registerCall(fixture, { to, abi: erc20Abi, functionName: 'name', result: `Token ${i}` })
    registerCall(fixture, { to, abi: erc20Abi, functionName: 'decimals', result: 18 })
  }
  addLogs(
    fixture,
    [150n, 450n, 850n].map((blockNumber, i) =>
      makeLog({
        address: BASE_ADDRESSES.uniswapV3.factory,
        abi: uniswapV3FactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: TOKENS[0],
          token1: TOKENS[1],
          fee: 500,
          tickSpacing: 10,
          pool: addr(i + 1),
        },
        blockNumber,
        logIndex: 0,
      }),
    ),
  )
  return fixture
}

interface Range {
  fromBlock: bigint
  toBlock: bigint
}

/** The fixture behind a transport that records eth_getLogs ranges and may fail some of them. */
function transport(
  seen: Range[],
  fail: (range: Range) => Error | undefined,
  head = HEAD,
): Transport {
  const inner = createFixtureTransport(world(head))
  return (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_getLogs') {
        const [filter] = params as [{ fromBlock: Hex; toBlock: Hex }]
        const range = {
          fromBlock: hexToBigInt(filter.fromBlock),
          toBlock: hexToBigInt(filter.toBlock),
        }
        seen.push(range)
        const error = fail(range)
        if (error) throw error
      }
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'scripted', name: 'Scripted', retryCount: 0 })(config)
  }
}

const rpcError = (code: number, message: string) =>
  new RpcRequestError({ body: {}, url: 'https://logs.example', error: { code, message } })

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

/** 100-block log chunks, 2 chunks per window: windows 1-200, 201-400, …, 801-1000. */
function context(
  db: Database,
  opts: {
    fail?: (range: Range) => Error | undefined
    dexes?: Dex[]
    fromBlock?: string
    head?: bigint
  } = {},
) {
  const seen: Range[] = []
  const lines: string[] = []
  const chain = createChainReader({
    transport: transport(seen, opts.fail ?? (() => undefined), opts.head),
    logChunkSize: 100,
    addresses: {
      uniswapV3: { ...BASE_ADDRESSES.uniswapV3, startBlock: 1n },
      aerodromeV2: { ...BASE_ADDRESSES.aerodromeV2, startBlock: 1n },
    },
  })
  const config = {
    ...loadConfig({}, { fromBlock: opts.fromBlock }),
    logChunkSize: 100,
    dexes: opts.dexes ?? ['uniswap-v3'],
  }
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  let ms = 0
  const clockMs = () => {
    ms += 10_000
    return ms
  }
  const ctx = createPipelineContext({ db, chain, config, log })
  return { ctx, seen, lines, run: () => discoverStep(ctx, { windowChunks: 2, clockMs }) }
}

function freshDb(): Database {
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  return db
}

describe('discoverStep: resumable windows', () => {
  it('advances the cursor per window and resumes after a late failure without rescanning', async () => {
    const db = freshDb()
    const first = context(db, {
      fail: (range) =>
        range.fromBlock === 601n ? rpcError(-32000, 'header not found') : undefined,
    })
    await expect(first.run()).rejects.toThrow(
      /discover failed for 1\/1 dexes: uniswap-v3 \(.*header not found/,
    )
    expect(db.syncState.getBigInt(KEY)).toBe(600n)
    expect(db.pools.count({ dex: 'uniswap-v3' })).toBe(2)
    expect(first.seen.at(-1)).toEqual({ fromBlock: 601n, toBlock: 700n })
    expect(first.lines.filter((l) => l.includes('INFO  window'))).toHaveLength(3)
    expect(first.lines.some((l) => /ERROR discovery failed.* cursor=600 head=1000/.test(l))).toBe(
      true,
    )

    const second = context(db)
    const result = await second.run()
    expect(second.seen.map((r) => r.fromBlock)).toEqual([601n, 701n, 801n, 901n])
    expect(result.dexes).toEqual([
      {
        dex: 'uniswap-v3',
        fromBlock: 601n,
        toBlock: HEAD,
        found: 1,
        windows: 2,
        skipped: false,
        complete: true,
      },
    ])
    expect(db.syncState.getBigInt(KEY)).toBe(HEAD)
    expect(db.pools.count({ dex: 'uniswap-v3' })).toBe(3)
    // The step leaves planner statistics for the pools it wrote.
    expect(
      db.raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_stat1 WHERE tbl = 'pools'`).get()?.n,
    ).toBeGreaterThan(0)

    const third = context(db)
    expect((await third.run()).dexes[0]).toMatchObject({ skipped: true, windows: 0 })
    expect(third.seen).toEqual([])
  })

  it('logs window, blocks done of total, percent, pools so far, elapsed and ETA', async () => {
    const { run, lines } = context(freshDb())
    await run()
    const windows = lines.filter((l) => l.includes('INFO  window'))
    expect(windows).toHaveLength(5)
    // Clock: started at 10 s, each window ends 10 s later.
    expect(windows[0]).toContain(
      'window dex=uniswap-v3 window=1/5 fromBlock=1 toBlock=200 blocks=200/1000 pct=20.0% pools=1 elapsed=10s eta=40s',
    )
    expect(windows[4]).toContain(
      'window=5/5 fromBlock=801 toBlock=1000 blocks=1000/1000 pct=100.0% pools=3 elapsed=50s eta=0s',
    )
    expect(
      lines.some((l) => /INFO {2}scanning dex=uniswap-v3 .* chunks=10 windows=5/.test(l)),
    ).toBe(true)
    expect([formatDuration(4_000), formatDuration(245_000), formatDuration(11_220_000)]).toEqual([
      '4s',
      '4m05s',
      '3h07m',
    ])
  })

  it('keeps --from-block semantics and never moves the cursor backwards', async () => {
    const db = freshDb()
    db.syncState.setBigInt(KEY, 800n)
    const failing = context(db, {
      fromBlock: '1',
      fail: (range) =>
        range.fromBlock === 401n ? rpcError(-32000, 'header not found') : undefined,
    })
    await expect(failing.run()).rejects.toThrow(/header not found/)
    expect(failing.seen[0]).toEqual({ fromBlock: 1n, toBlock: 100n })
    expect(db.syncState.getBigInt(KEY)).toBe(800n) // windows ending at 200 and 400 left it alone

    const rescan = context(db, { fromBlock: '1' })
    expect((await rescan.run()).dexes[0]).toMatchObject({ fromBlock: 1n, found: 3, windows: 5 })
    expect(db.syncState.getBigInt(KEY)).toBe(HEAD)
  })
})

describe('discoverStep: unusable logs endpoint', () => {
  it("stops at once on Alchemy free tier's 10-block limit, for every DEX and for run", async () => {
    const db = freshDb()
    const alchemy = () => rpcError(-32600, ALCHEMY_FREE)
    const { run, seen, lines } = context(db, {
      fail: alchemy,
      dexes: ['uniswap-v3', 'aerodrome-v2'],
    })
    const error = await run().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LogRangeLimitError)
    expect(
      lines.some((l) =>
        l.includes('WARN  the logs endpoint cannot serve factory log scans dex=uniswap-v3'),
      ),
    ).toBe(true)
    expect(lines.some((l) => l.includes('discover --seed finds the reference-token pools'))).toBe(
      true,
    )
    expect(seen).toHaveLength(1) // aerodrome-v2 is not attempted, nothing is halved
    expect(db.syncState.getBigInt(KEY)).toBeUndefined()
    expect(describeError(error)).toBe(
      `eth_getLogs: the logs endpoint accepts at most 10 blocks per request (provider: "${ALCHEMY_FREE}"), ` +
        'fewer than the 100-block chunks configured, and the reader does not split ranges below ' +
        '100 blocks. Either set DEPTHWATCH_LOGS_RPC_URL (or --logs-rpc-url) to an endpoint that ' +
        'accepts larger eth_getLogs ranges, for example https://mainnet.base.org, or, for short ' +
        "scans (24 h of volume is 432,000 blocks of Base's 200 ms blocks: 43,200 requests per " +
        "event source at 10), set DEPTHWATCH_LOG_CHUNK (or --log-chunk) to the provider's " +
        'limit, 10.',
    )

    const looping = context(db, { fail: alchemy })
    await expect(runIteration(looping.ctx, 1, false)).rejects.toBeInstanceOf(LogRangeLimitError)
  })
})

describe('discoverStep: request budget', () => {
  const fail = () => rpcError(-32000, 'header not found')

  it('warns before a scan that needs more than DISCOVER_WARN_CHUNKS requests per DEX', async () => {
    expect(DISCOVER_WARN_CHUNKS).toBe(5_000n)
    // 500 100 blocks at 100-block chunks: 5 001 requests. The first one fails, so none follow.
    const { run, lines, seen } = context(freshDb(), { head: 500_100n, fail })
    await expect(run()).rejects.toThrow(/header not found/)
    expect(seen).toHaveLength(1)
    expect(
      lines.some((l) =>
        /WARN {2}this scan needs one eth_getLogs per factory per chunk dex=uniswap-v3 chunks=5001 logChunk=100 fix="DEPTHWATCH_LOGS_RPC_URL.* alternative="discover --seed finds the reference-token pools without eth_getLogs"$/.test(
          l,
        ),
      ),
    ).toBe(true)
    // 5 000 requests exactly: no warning; nor for a short scan.
    const at = context(freshDb(), { head: 500_000n, fail })
    await expect(at.run()).rejects.toThrow(/header not found/)
    expect(at.lines.some((l) => l.includes('this scan needs'))).toBe(false)
    const normal = context(freshDb())
    await normal.run()
    expect(normal.lines.some((l) => l.includes('WARN'))).toBe(false)
  })

  it('announces a first scan of any DEX from its deployment at the default 2 000-block chunks', () => {
    const chunk = BigInt(loadConfig({}).logChunkSize)
    expect(chunk).toBe(2_000n)
    // A head on 2026-10-25; every first scan of the older DEXes is far past the threshold. Aero's
    // factories date from 2026-10-21, so its first scans are short.
    const head = 53_061_869n
    const young = new Set<string>(['aero-v2', 'aero-slipstream'])
    for (const dex of DEXES) {
      const chunks = (head - defaultStartBlock(BASE_ADDRESSES, dex) + chunk) / chunk
      if (young.has(dex)) expect(chunks, dex).toBeLessThan(DISCOVER_WARN_CHUNKS)
      else expect(chunks, dex).toBeGreaterThan(DISCOVER_WARN_CHUNKS)
    }
  })

  it("starts the Aero DEXes at their factories' first blocks", () => {
    expect(defaultStartBlock(BASE_ADDRESSES, 'aero-v2')).toBe(52_880_042n)
    expect(defaultStartBlock(BASE_ADDRESSES, 'aero-slipstream')).toBe(52_881_649n)
    const later = { ...BASE_ADDRESSES.aeroSlipstream[0]!, name: 'later', startBlock: 53_000_000n }
    const addresses = {
      ...BASE_ADDRESSES,
      aeroSlipstream: [later, ...BASE_ADDRESSES.aeroSlipstream],
    }
    expect(defaultStartBlock(addresses, 'aero-slipstream')).toBe(52_881_649n)
    expect(defaultStartBlock({ ...BASE_ADDRESSES, aeroSlipstream: [] }, 'aero-slipstream')).toBe(0n)
  })
})

describe('discoverStep: time budget', () => {
  it('starts no window once the budget is spent and resumes there on the next run', async () => {
    const db = freshDb()
    let now = 0
    // Every eth_getLogs (one 100-block chunk) takes 10 s: a window of two chunks takes 20 s.
    const tick = () => {
      now += 10_000
      return undefined
    }
    const first = context(db, { fail: tick, dexes: ['uniswap-v3', 'aerodrome-v2'] })
    const partial = await discoverStep(first.ctx, {
      windowChunks: 2,
      budgetMs: 30_000,
      clockMs: () => now,
    })
    expect(partial.complete).toBe(false)
    expect(partial.dexes).toMatchObject([
      { dex: 'uniswap-v3', windows: 2, found: 1, complete: false },
      { dex: 'aerodrome-v2', windows: 0, found: 0, complete: false },
    ])
    expect(db.syncState.getBigInt(KEY)).toBe(400n)
    expect(first.lines.some((l) => l.includes('budget spent; the next pass resumes here'))).toBe(
      true,
    )
    expect(first.lines.some((l) => l.includes('budget spent; the next pass scans this DEX'))).toBe(
      true,
    )

    const second = context(db, { fail: tick, dexes: ['uniswap-v3', 'aerodrome-v2'] })
    const rest = await discoverStep(second.ctx, {
      windowChunks: 2,
      budgetMs: 1_000_000,
      clockMs: () => now,
    })
    expect(second.seen[0]).toEqual({ fromBlock: 401n, toBlock: 500n })
    expect(rest.complete).toBe(true)
    expect(rest.dexes.map((d) => d.complete)).toEqual([true, true])
    expect(db.pools.count({ dex: 'uniswap-v3' })).toBe(3)
  })

  it('always runs one window, however small the budget', async () => {
    const db = freshDb()
    const { ctx, seen } = context(db)
    const result = await discoverStep(ctx, { windowChunks: 2, budgetMs: 0, clockMs: () => 0 })
    expect(result.dexes[0]).toMatchObject({ windows: 1, complete: false })
    expect(seen).toHaveLength(2)
  })
})
