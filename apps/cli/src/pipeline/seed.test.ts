import {
  BASE_STOCKS,
  createChainReader,
  createFixture,
  createFixtureTransport,
  NATIVE_ETH_TOKEN,
  probesFor,
  registerSeedWorld,
  resolveAddresses,
  type SeedWorldPool,
  setClock,
  TOKENS,
} from '@depthwatch/chain'
import { type Address, NATIVE_ETH, type TokenInfo } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { custom, type Transport } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, parseCliArgs } from '../config.js'
import { createLogger } from '../log.js'
import { pipelineSteps } from '../start/start.js'
import { createPipelineContext, syncKeys } from './context.js'
import { runIteration } from './run.js'
import { seedStep } from './seed.js'

const HEAD = 45_000_000n
const addr = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address
const { WETH, USDC, CBBTC } = TOKENS
const addresses = resolveAddresses({ referenceTokens: [NATIVE_ETH_TOKEN, WETH, USDC, CBBTC] })
const V3 = addr(0x3001)
const V2 = addr(0x2001)
const POOLS: SeedWorldPool[] = [
  {
    dex: 'uniswap-v3',
    tokens: [WETH.address, USDC.address],
    fee: 500,
    address: V3,
    createdAtBlock: 2_000_123n,
  },
  {
    dex: 'aerodrome-v2',
    tokens: [CBBTC.address, WETH.address],
    stable: false,
    address: V2,
    createdAtBlock: 9_000_000n,
  },
  {
    dex: 'uniswap-v4',
    tokens: [NATIVE_ETH, USDC.address],
    fee: 500,
    tickSpacing: 10,
    createdAtBlock: 26_000_000n,
  },
]

type Fail = (method: string, n: number, params: unknown) => Error | undefined

/**
 * The reader's default stock list, which the seed asks as cross tokens (seed.stocks.test.ts tests
 * their pools); none of the stocks has a pool in these worlds.
 */
const STOCKS = BASE_STOCKS.tokens
/** Uniswap v3 candidates: (3 ERC-20 pairs of the references + 10 stocks × 3 ERC-20s) × 7 tiers. */
const V3_CANDIDATES = (3 + STOCKS.length * 3) * 7

/** A protocol's own token, not among the reference tokens, and its Uniswap v3 pool with WETH. */
const PROJECT: TokenInfo = { address: addr(0xbeef), symbol: 'PRJ', name: 'Project', decimals: 18 }
const PROJECT_POOL = addr(0x3002)
/** The seed world with PROJECT among its tokens; the reader's reference list stays without it. */
const PROJECT_WORLD = {
  addresses: resolveAddresses({ referenceTokens: [...addresses.referenceTokens, PROJECT] }),
  crossTokens: STOCKS,
  pools: [
    ...POOLS,
    {
      dex: 'uniswap-v3',
      tokens: [PROJECT.address, WETH.address],
      fee: 3_000,
      address: PROJECT_POOL,
      createdAtBlock: 30_000_000n,
    } as const,
  ],
}

/** The seed world behind a transport that counts requests by method; `fail` may refuse one. */
function counted(
  counts: Map<string, number>,
  fail: Fail = () => undefined,
  world: Parameters<typeof registerSeedWorld>[1] = { addresses, crossTokens: STOCKS, pools: POOLS },
): Transport {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
  registerSeedWorld(fixture, world)
  const inner = createFixtureTransport(fixture)
  return (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      const n = counts.get(method) ?? 0
      counts.set(method, n + 1)
      const error = fail(method, n, params)
      if (error) throw error
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'counting', name: 'Counting', retryCount: 0 })(config)
  }
}

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

function context(
  db: Database,
  flags: Parameters<typeof loadConfig>[1] = { seed: true },
  fail?: Fail,
  world?: Parameters<typeof registerSeedWorld>[1],
) {
  const counts = new Map<string, number>()
  const lines: string[] = []
  const chain = createChainReader({ transport: counted(counts, fail, world), addresses })
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const ctx = createPipelineContext({ db, chain, config: loadConfig({}, flags), log })
  return { ctx, counts, lines }
}

function freshDb(): Database {
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  return db
}

describe('seedStep', () => {
  it('upserts the seeded pools with exact creation blocks and records the seed block', async () => {
    const db = freshDb()
    const first = context(db)
    const result = await seedStep(first.ctx)
    expect(result).toMatchObject({ blockNumber: HEAD, found: 3, added: 3 })
    expect(db.pools.get(`uniswap-v3:${V3}`)?.createdAtBlock).toBe(2_000_123n)
    expect(db.pools.get(`aerodrome-v2:${V2}`)?.createdAtBlock).toBe(9_000_000n)
    expect(db.pools.list({ dex: 'uniswap-v4' }).map((p) => p.createdAtBlock)).toEqual([26_000_000n])
    for (const dex of [
      'uniswap-v3',
      'uniswap-v4',
      'aerodrome-v2',
      'aerodrome-slipstream',
    ] as const) {
      expect(db.syncState.getBigInt(syncKeys.seed(dex))).toBe(HEAD)
      expect(db.syncState.getBigInt(syncKeys.discover(dex))).toBeUndefined() // log cursors untouched
    }
    expect(first.counts.get('eth_getLogs')).toBeUndefined()
    expect(first.counts.get('eth_getCode')).toBe(
      probesFor(addresses.uniswapV3.startBlock, HEAD) +
        probesFor(addresses.aerodromeV2.startBlock, HEAD),
    )
    expect(
      first.lines.some((l) =>
        l.includes(
          `INFO  seeded dex=uniswap-v3 candidates=${V3_CANDIDATES} found=1 searched=1 total=1`,
        ),
      ),
    ).toBe(true)
    expect(first.lines.some((l) => l.includes('INFO  creation blocks found pools=3/3'))).toBe(true)

    const again = context(db)
    expect(await seedStep(again.ctx)).toMatchObject({ found: 3, added: 0, searchRequests: 0 })
    expect(again.counts.get('eth_getCode')).toBeUndefined()
    expect(db.pools.count({})).toBe(3)
    // The step leaves planner statistics for the pools it wrote.
    expect(
      db.raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_stat1 WHERE tbl = 'pools'`).get()?.n,
    ).toBeGreaterThan(0)
  })

  it('keeps the batches dated before a failure, so the next seed searches only the rest', async () => {
    const db = freshDb()
    // Batches of one pool, in seeder order: v3, then v4, then aerodrome-v2. The v4 probes are
    // multicalls, so the first eth_getCode after the v3 pool's search belongs to aerodrome-v2.
    const v3Probes = probesFor(addresses.uniswapV3.startBlock, HEAD)
    const broken = context(db, { seed: true }, (method, n) =>
      method === 'eth_getCode' && n >= v3Probes ? new Error('missing trie node') : undefined,
    )
    await expect(seedStep(broken.ctx, { batchSize: 1 })).rejects.toThrow(/missing trie node/)
    expect(
      db.pools
        .list({})
        .map((p) => p.dex)
        .sort(),
    ).toEqual(['uniswap-v3', 'uniswap-v4'])
    expect(db.syncState.getBigInt(syncKeys.seed('uniswap-v3'))).toBeUndefined() // not finished

    const resumed = context(db)
    expect(await seedStep(resumed.ctx)).toMatchObject({ found: 3, added: 1 })
    const searched = resumed.counts.get('eth_getCode') ?? 0
    expect(searched).toBeLessThanOrEqual(probesFor(addresses.aerodromeV2.startBlock, HEAD))
    expect(db.pools.get(`aerodrome-v2:${V2}`)?.createdAtBlock).toBe(9_000_000n)
  })

  it('marks only the seeded DEXes and fails naming the one whose factory views failed', async () => {
    const db = freshDb()
    const v2Factory = addresses.aerodromeV2.poolFactory.slice(2)
    const broken = context(db, { seed: true }, (method, _n, params) =>
      method === 'eth_call' && JSON.stringify(params).includes(v2Factory)
        ? new Error('execution reverted')
        : undefined,
    )
    await expect(seedStep(broken.ctx)).rejects.toThrow(
      /seeding failed for aerodrome-v2 \(2 pools of the other DEXes stored\)/,
    )
    expect(
      db.pools
        .list({})
        .map((p) => p.dex)
        .sort(),
    ).toEqual(['uniswap-v3', 'uniswap-v4'])
    for (const dex of ['uniswap-v3', 'uniswap-v4', 'aerodrome-slipstream'] as const)
      expect(db.syncState.getBigInt(syncKeys.seed(dex))).toBe(HEAD)
    expect(db.syncState.getBigInt(syncKeys.seed('aerodrome-v2'))).toBeUndefined()
    expect(broken.lines.some((l) => /WARN {2}seed failed dex=aerodrome-v2/.test(l))).toBe(true)
    // `start` seeds again while a DEX has no marker; the next seed adds only the missing pool.
    expect(pipelineSteps(broken.ctx, () => 0).needsSeed()).toBe(true)
    const again = context(db)
    expect(await seedStep(again.ctx)).toMatchObject({ found: 3, added: 1 })
    expect(db.syncState.getBigInt(syncKeys.seed('aerodrome-v2'))).toBe(HEAD)
    expect(pipelineSteps(again.ctx, () => 0).needsSeed()).toBe(false)
  })

  it('seeds the pairs of the --seed-token addresses too', async () => {
    const db = freshDb()
    const plain = context(db, { seed: true }, undefined, PROJECT_WORLD)
    expect(await seedStep(plain.ctx)).toMatchObject({ found: 3 })
    expect(db.pools.get(`uniswap-v3:${PROJECT_POOL}`)).toBeUndefined()

    const upper = `0x${PROJECT.address.slice(2).toUpperCase()}`
    const flags = parseCliArgs(['discover', '--seed', '--seed-token', upper]).flags
    const extra = context(db, flags, undefined, PROJECT_WORLD)
    expect(await seedStep(extra.ctx)).toMatchObject({ found: 4, added: 1 })
    const pool = db.pools.get(`uniswap-v3:${PROJECT_POOL}`)
    expect(pool?.createdAtBlock).toBe(30_000_000n)
    expect([pool?.token0.symbol, pool?.token1.symbol].sort()).toEqual(['PRJ', 'WETH'])
    expect(
      extra.lines.some((l) => l.includes(`seeding from factory views`) && l.includes('tokens=5')),
    ).toBe(true)
  })

  it('replaces the log scan in run --seed, so a logs-less endpoint still discovers', async () => {
    const db = freshDb()
    const { ctx, counts } = context(db, { seed: true, dex: ['uniswap-v3'] })
    const result = await runIteration(ctx, 1, false)
    expect(result.failed.map((f) => f.step)).not.toContain('discover')
    expect(db.pools.count({ dex: 'uniswap-v3' })).toBe(1)
    expect(db.syncState.getBigInt(syncKeys.seed('uniswap-v3'))).toBe(HEAD)
    expect(db.syncState.getBigInt(syncKeys.seed('aerodrome-v2'))).toBeUndefined()
    expect(counts.get('eth_getLogs') ?? 0).toBe(0)
  })
})

describe('--seed flag', () => {
  it('applies to discover and run only, and not with --from-block', () => {
    expect(parseCliArgs(['discover', '--seed']).flags.seed).toBe(true)
    expect(loadConfig({}, parseCliArgs(['run', '--seed', '--once']).flags).seed).toBe(true)
    expect(loadConfig({}).seed).toBe(false)
    expect(() => parseCliArgs(['snapshot', '--seed'])).toThrow(
      '--seed only applies to discover and run',
    )
    expect(() => parseCliArgs(['discover', '--seed', '--from-block', '5'])).toThrow(
      '--from-block only applies to the log scan, not to --seed',
    )
  })
})
