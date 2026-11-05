/**
 * The CLI's RPC endpoints over the HTTP answers of real providers, replayed by a stubbed `fetch`
 * (no network): DEPTHWATCH_LOGS_RPC_URL routing, backoff warnings, and `volume` on Alchemy's free
 * tier, which works with DEPTHWATCH_LOG_CHUNK=10 (over Base's 200 ms blocks) and fails fast with
 * both fixes at the default.
 */
import {
  addLogs,
  alchemyFreeTierGetLogs,
  BASE_BLOCK_SCHEDULE,
  BASE_DENIM_BLOCK,
  createFakeRpcFetch,
  createFixture,
  type FakeRpcOptions,
  type Fixture,
  LogRangeLimitError,
  makeLog,
  setClock,
  uniswapV3PoolAbi,
} from '@depthwatch/chain'
import type { Address, PoolMeta } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Env, loadConfig } from './config.js'
import { createLogger } from './log.js'
import { EXIT_ERROR, main } from './main.js'
import { createPipelineContext } from './pipeline/context.js'
import { volumeStep } from './pipeline/volume.js'
import { createCliChainReader, describeError } from './rpc.js'

const MAIN = 'https://base-mainnet.example/v2'
const LOGS = 'https://logs.example/'
const HEAD = 100_000n
const HEAD_TS = 1_800_000_000
const addr = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address

const POOL: PoolMeta = {
  id: `uniswap-v3:${addr(0x401)}`,
  dex: 'uniswap-v3',
  kind: 'concentrated',
  address: addr(0x401),
  poolId: null,
  token0: { address: addr(0xaa), symbol: 'AAA', name: 'Token A', decimals: 18 },
  token1: { address: addr(0xdd), symbol: 'DDD', name: 'Token D', decimals: 6 },
  feePips: 500,
  tickSpacing: 10,
  stable: false,
  hooks: null,
  createdAtBlock: 1n,
}

/**
 * A head two days past Denim on Base's block schedule (200 ms blocks): its 2 h window starts at
 * the hour 1 794 067 200, block BASE_DENIM_BLOCK + 827 995, 36 006 blocks back.
 */
const DENIM_HEAD = BASE_DENIM_BLOCK + 864_000n

/**
 * Swaps of POOL 100 and 20 000 blocks before the head, both inside the last 24 h on the 2 s clock
 * (HEAD), inside the last 67 min on Base's schedule (`denim`).
 */
function world(denim = false): Fixture {
  const fixture = createFixture()
  const head = denim ? DENIM_HEAD : HEAD
  if (denim) setClock(fixture, { latestBlock: head, schedule: BASE_BLOCK_SCHEDULE })
  else setClock(fixture, { latestBlock: HEAD, latestTimestamp: HEAD_TS })
  addLogs(
    fixture,
    [head - 20_000n, head - 100n].map((blockNumber) =>
      makeLog({
        address: POOL.address as Address,
        abi: uniswapV3PoolAbi,
        eventName: 'Swap',
        args: {
          sender: addr(0x7007),
          recipient: addr(0x7007),
          amount0: 10n ** 18n,
          amount1: -2_000_000n,
          sqrtPriceX96: 1n << 96n,
          liquidity: 1n,
          tick: 0,
        },
        blockNumber,
        logIndex: 0,
      }),
    ),
  )
  return fixture
}

const dbs: Database[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const db of dbs.splice(0)) db.close()
})

/** The `volume` pipeline over `env`, every request answered by the fake endpoint(s). */
function cli(env: Env, fake: FakeRpcOptions = {}, denim = false) {
  const rpc = createFakeRpcFetch(world(denim), fake)
  vi.stubGlobal('fetch', rpc.fetch)
  const lines: string[] = []
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const config = loadConfig(env)
  const chain = createCliChainReader(config, { command: 'volume', live: true }, log)
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  db.pools.upsertMany([POOL])
  db.pools.setTracked([POOL.id], true)
  const ctx = createPipelineContext({ db, chain, config, log })
  const methodsAt = (url: string) =>
    new Set(rpc.calls.filter((c) => c.url === url).map((c) => c.method))
  return { ctx, db, lines, calls: rpc.calls, methodsAt }
}

describe('DEPTHWATCH_LOGS_RPC_URL', () => {
  it('serves eth_getLogs and nothing else; the log names the variable, never a URL', async () => {
    const { ctx, lines, methodsAt } = cli({
      DEPTHWATCH_RPC_URL: MAIN,
      DEPTHWATCH_LOGS_RPC_URL: LOGS,
    })
    expect((await volumeStep(ctx)).swaps).toBe(2)
    expect([...methodsAt(LOGS)]).toEqual(['eth_getLogs'])
    expect(methodsAt(MAIN).has('eth_getLogs')).toBe(false)
    expect(methodsAt(MAIN).has('eth_getBlockByNumber')).toBe(true)
    expect(lines[0]).toContain('INFO  rpc endpoints logs=DEPTHWATCH_LOGS_RPC_URL logChunk=2000')
    expect(lines.some((l) => l.includes('example'))).toBe(false)
  })

  it('defaults to DEPTHWATCH_RPC_URL and logs each eth_getLogs backoff as a warning', async () => {
    const { ctx, lines, calls } = cli(
      { DEPTHWATCH_RPC_URL: MAIN },
      {
        getLogs: ({ n }) =>
          n === 0
            ? new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '0' } })
            : undefined,
      },
    )
    expect((await volumeStep(ctx)).swaps).toBe(2)
    expect(new Set(calls.map((c) => c.url))).toEqual(new Set([MAIN]))
    expect(lines[0]).toContain('rpc endpoints logs=DEPTHWATCH_RPC_URL')
    expect(
      lines.filter((l) => l.includes('WARN  eth_getLogs backoff reason=rate-limit retry=1/8')),
    ).toHaveLength(1)
  })

  it('backs off a rate-limited main-endpoint request and warns with its name only', async () => {
    const tooMany = () =>
      new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '0' } })
    const { ctx, lines, calls } = cli(
      { DEPTHWATCH_RPC_URL: MAIN },
      {
        respond: ({ method, n }) =>
          method === 'eth_getBlockByNumber' && n === 0 ? tooMany() : undefined,
      },
    )
    expect((await volumeStep(ctx)).swaps).toBe(2)
    const warnings = lines.filter((l) => l.includes('WARN  rpc backoff'))
    expect(warnings).toEqual([
      expect.stringContaining(
        'rpc backoff reason=rate-limit retry=1/8 delayMs=0 request="eth_getBlockByNumber latest"',
      ),
    ])
    expect(calls.filter((c) => c.method === 'eth_getBlockByNumber').length).toBeGreaterThan(1)
  })
})

describe('volume on a 10-block eth_getLogs plan (Alchemy free tier)', () => {
  it('works with DEPTHWATCH_LOG_CHUNK=10 and needs a handful of headers', async () => {
    const { ctx, db, calls } = cli(
      { DEPTHWATCH_RPC_URL: MAIN, DEPTHWATCH_LOG_CHUNK: '10' },
      { getLogs: alchemyFreeTierGetLogs() },
      true,
    )
    // Two hours: 24 h of 200 ms blocks is 43 200 requests or more per event source at 10.
    const result = await volumeStep(ctx, { hours: 2 })
    const fromBlock = DENIM_HEAD - 36_005n
    expect(result).toMatchObject({ fromBlock, toBlock: DENIM_HEAD, swaps: 2, dropped: 0 })
    expect(calls.filter((c) => c.method === 'eth_getLogs')).toHaveLength(3_601) // ⌈36 006 / 10⌉
    // The head; the window's first block and its parent; the first swap's block (the schedule
    // holds there, and at the head, so every swap takes its scheduled time).
    expect(calls.filter((c) => c.method === 'eth_getBlockByNumber')).toHaveLength(4)
    expect(db.volume.swapCount(POOL.id, 0)).toBe(2)
    expect(db.volume.sumUsd(POOL.id, 0)).toBeNull() // no stored prices: USD unknown, not 0
  })

  it('fails fast at the default chunk with one request and both fixes', async () => {
    const { ctx, calls } = cli({ DEPTHWATCH_RPC_URL: MAIN }, { getLogs: alchemyFreeTierGetLogs() })
    const error = await volumeStep(ctx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LogRangeLimitError)
    expect(calls.filter((c) => c.method === 'eth_getLogs')).toHaveLength(1)
    const text = describeError(error)
    expect(text).toMatch(/^eth_getLogs: the logs endpoint accepts at most 10 blocks per request/)
    expect(text).toContain('Under the Free tier plan, you can make eth_getLogs requests with up to')
    expect(text).toMatch(
      /Either set DEPTHWATCH_LOGS_RPC_URL \(or --logs-rpc-url\) to an endpoint that accepts larger eth_getLogs ranges, .* or, for short scans \(24 h of volume is 432,000 blocks of Base's 200 ms blocks: 43,200 requests per event source at 10\), set DEPTHWATCH_LOG_CHUNK \(or --log-chunk\) to the provider's limit, 10\.$/,
    )
  })

  it('fails fast with one request per DEX when pools of two DEXes are tracked', async () => {
    const { ctx, db, calls } = cli(
      { DEPTHWATCH_RPC_URL: MAIN },
      { getLogs: alchemyFreeTierGetLogs() },
    )
    const v2: PoolMeta = {
      ...POOL,
      id: `aerodrome-v2:${addr(0x402)}`,
      dex: 'aerodrome-v2',
      kind: 'constant-product',
      address: addr(0x402),
      tickSpacing: null,
    }
    db.pools.upsertMany([v2])
    db.pools.setTracked([v2.id], true)
    expect(await volumeStep(ctx).catch((e: unknown) => e)).toBeInstanceOf(LogRangeLimitError)
    // Both DEX scans start together; each stops at its first answer.
    expect(calls.filter((c) => c.method === 'eth_getLogs')).toHaveLength(2)
  })

  it('words a limit the provider did not state', () => {
    const error = new LogRangeLimitError({
      reason: 'floor',
      maxRange: undefined,
      chunkSize: 2_000n,
      minRange: 100n,
      fromBlock: 1n,
      toBlock: 125n,
      providerMessage: 'block range too large',
    })
    expect(describeError(error)).toMatch(
      /rejected blocks 1-125 \(125 blocks\) \(provider: "block range too large"\), and halving again would go below 100 blocks\. Either .* to a span it accepts\.$/,
    )
  })
})

describe('depthwatch discover on Alchemy free tier at the default chunk', () => {
  it('exits 1 after one eth_getLogs with one stderr line naming the limit and both fixes', async () => {
    const rpc = createFakeRpcFetch(world(), { getLogs: alchemyFreeTierGetLogs() })
    vi.stubGlobal('fetch', rpc.fetch)
    const stderr: string[] = []
    const code = await main(
      ['discover', '--db', ':memory:', '--dex', 'uniswap-v3', '--from-block', '1'],
      {
        env: { DEPTHWATCH_RPC_URL: MAIN },
        log: createLogger({ level: 'silent' }),
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    )
    expect(code).toBe(EXIT_ERROR)
    expect(stderr).toHaveLength(1)
    expect(stderr[0]).toMatch(
      /^error: eth_getLogs: the logs endpoint accepts at most 10 blocks per request .* set DEPTHWATCH_LOG_CHUNK \(or --log-chunk\) to the provider's limit, 10\.$/,
    )
    expect(rpc.calls.filter((c) => c.method === 'eth_getLogs')).toHaveLength(1)
  })
})
