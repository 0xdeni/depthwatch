/**
 * Seeding the tokenized stocks (docs/design/stocks.md §3, §4 "Seed"): the seed step hands the
 * reader's stock list (`chain.stocks`, by default the ten of base.org/stocks) to `seedPools` as
 * cross tokens, in `discover --seed`, `run --seed` and `start` alike, so every stock is asked
 * against every reference token and `--seed-token` address and against no other stock. The worlds
 * answer exactly the candidates of those pairs: a stock × stock call, or a pair with native ETH
 * off Uniswap v4, would find no answer and fail the seed. The stock pools found are stored and
 * dated like any pool; a reader with an empty stock list (the demo's) asks no stock.
 */
import {
  BASE_STOCKS,
  createChainReader,
  createFixture,
  createFixtureTransport,
  NATIVE_ETH_TOKEN,
  registerSeedWorld,
  resolveAddresses,
  type SeedWorldPool,
  STOCK_PROTOCOL,
  STOCK_TOKENS,
  type StockList,
  setClock,
  TOKENS,
} from '@depthwatch/chain'
import { type Address, makeStock, NATIVE_ETH, type TokenInfo } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { DEMO_STOCKS } from '../demo.js'
import { createLogger } from '../log.js'
import { pipelineSteps } from '../start/start.js'
import { createPipelineContext, syncKeys } from './context.js'
import { runIteration } from './run.js'
import { seedStep } from './seed.js'

const HEAD = 53_663_272n
const addr = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address
const { WETH, USDC, CBBTC } = TOKENS
const { NVDAC, AMZNC } = STOCK_TOKENS
/** Four reference tokens: native ETH and three ERC-20s, so three ERC-20 pairs among them. */
const addresses = resolveAddresses({ referenceTokens: [NATIVE_ETH_TOKEN, WETH, USDC, CBBTC] })
const V3_TIERS = 7
const V3 = addr(0x3001)
const CL = addr(0xc701)
const REFERENCE_POOL: SeedWorldPool = {
  dex: 'uniswap-v3',
  tokens: [WETH.address, USDC.address],
  fee: 500,
  address: addr(0x3002),
  createdAtBlock: 2_000_123n,
}
/** NVDAc/USDC on Uniswap v3 and Aero Slipstream, AMZNc/ETH on Uniswap v4, beside WETH/USDC. */
const STOCK_POOLS: SeedWorldPool[] = [
  {
    dex: 'uniswap-v3',
    tokens: [NVDAC.address, USDC.address],
    fee: 3_000,
    address: V3,
    createdAtBlock: 52_000_000n,
  },
  {
    dex: 'aero-slipstream',
    tokens: [USDC.address, NVDAC.address],
    tickSpacing: 10,
    address: CL,
    createdAtBlock: 53_000_000n,
  },
  {
    dex: 'uniswap-v4',
    tokens: [AMZNC.address, NATIVE_ETH],
    fee: 3_000,
    tickSpacing: 60,
    createdAtBlock: 53_100_000n,
  },
]

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

/**
 * A seed over a world that answers the pairs of the reference tokens and of `cross`, by a reader
 * whose stock list is `stocks` (default: the reader's own, `BASE_STOCKS`).
 */
function context(opts: {
  cross: readonly TokenInfo[]
  pools: readonly SeedWorldPool[]
  stocks?: StockList
  flags?: Parameters<typeof loadConfig>[1]
}) {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_793_923_030 })
  registerSeedWorld(fixture, { addresses, crossTokens: opts.cross, pools: opts.pools })
  const chain = createChainReader({
    transport: createFixtureTransport(fixture),
    addresses,
    ...(opts.stocks === undefined ? {} : { stocks: opts.stocks }),
  })
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  const lines: string[] = []
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const config = loadConfig({}, opts.flags ?? { seed: true })
  return { db, ctx: createPipelineContext({ db, chain, config, log }), lines, log }
}

const seededLine = (lines: readonly string[], dex: string) =>
  lines.find((l) => l.includes(`INFO  seeded dex=${dex} `))

describe('seedStep with the stock list', () => {
  it('asks every stock of the default list against the reference tokens and stores its pools', async () => {
    const { db, ctx, lines } = context({
      cross: BASE_STOCKS.tokens,
      pools: [REFERENCE_POOL, ...STOCK_POOLS],
    })
    expect(ctx.chain.stocks.tokens).toHaveLength(10)
    const result = await seedStep(ctx)
    expect(result).toMatchObject({ blockNumber: HEAD, found: 4, added: 4 })
    expect(
      lines.some(
        (l) => l.includes('seeding from factory views') && l.endsWith(' tokens=4 stocks=10'),
      ),
    ).toBe(true)
    // (3 ERC-20 pairs of the references + 10 stocks × 3 ERC-20 references) × 7 tiers; Uniswap v4
    // also asks every stock with native ETH: (6 + 10 × 4) currency pairs × 4 keys.
    expect(seededLine(lines, 'uniswap-v3')).toContain(
      `candidates=${(3 + 10 * 3) * V3_TIERS} found=2`,
    )
    expect(seededLine(lines, 'uniswap-v4')).toContain(`candidates=${(6 + 10 * 4) * 4} found=1`)

    expect(db.pools.get(`uniswap-v3:${V3}`)).toMatchObject({
      token0: USDC,
      token1: NVDAC,
      feePips: 3_000,
      createdAtBlock: 52_000_000n,
    })
    expect(db.pools.get(`aero-slipstream:${CL}`)).toMatchObject({
      token1: NVDAC,
      createdAtBlock: 53_000_000n,
    })
    const [v4] = db.pools.list({ dex: 'uniswap-v4' })
    expect(v4).toMatchObject({ token0: NATIVE_ETH_TOKEN, token1: AMZNC })
    expect(v4?.createdAtBlock).toBe(53_100_000n)
    for (const dex of ['uniswap-v3', 'uniswap-v4', 'aero-slipstream'] as const)
      expect(db.syncState.getBigInt(syncKeys.seed(dex))).toBe(HEAD)
  })

  it('seeds the stocks the reader carries, and no stock with the demo’s empty list', async () => {
    const stock = makeStock('TSTc').token
    const own: StockList = {
      tokens: [stock],
      feeds: {},
      oracleRegistry: STOCK_PROTOCOL.oracleRegistry,
    }
    const pool: SeedWorldPool = {
      dex: 'uniswap-v3',
      tokens: [stock.address, WETH.address],
      fee: 10_000,
      address: addr(0x3003),
      createdAtBlock: 53_200_000n,
    }
    const one = context({ cross: [stock], pools: [REFERENCE_POOL, pool], stocks: own })
    expect(await seedStep(one.ctx)).toMatchObject({ found: 2, added: 2 })
    expect(one.lines.some((l) => l.endsWith(' tokens=4 stocks=1'))).toBe(true)
    expect(seededLine(one.lines, 'uniswap-v3')).toContain(
      `candidates=${(3 + 3) * V3_TIERS} found=2`,
    )
    expect(one.db.pools.get(`uniswap-v3:${pool.address}`)?.token1).toEqual(stock)

    // The world answers the reference pairs only: a stock asked here would fail the seed.
    const none = context({ cross: [], pools: [REFERENCE_POOL], stocks: DEMO_STOCKS })
    expect(await seedStep(none.ctx)).toMatchObject({ found: 1, added: 1 })
    expect(none.lines.some((l) => l.endsWith(' tokens=4 stocks=0'))).toBe(true)
    expect(seededLine(none.lines, 'uniswap-v3')).toContain(`candidates=${3 * V3_TIERS} found=1`)
  })

  it('is the seed of run --seed and of start too', async () => {
    const run = context({
      cross: BASE_STOCKS.tokens,
      pools: STOCK_POOLS,
      flags: { seed: true, dex: ['uniswap-v3'] },
    })
    const pass = await runIteration(run.ctx, 1, false)
    expect(pass.failed.map((f) => f.step)).not.toContain('discover')
    expect(run.db.pools.list({ dex: 'uniswap-v3' }).map((p) => p.id)).toEqual([`uniswap-v3:${V3}`])

    const start = context({ cross: BASE_STOCKS.tokens, pools: STOCK_POOLS, flags: {} })
    const steps = pipelineSteps(start.ctx, () => 0)
    expect(steps.needsSeed()).toBe(true)
    await steps.seed(start.log)
    expect(start.db.pools.count({})).toBe(STOCK_POOLS.length)
    expect(steps.needsSeed()).toBe(false)
  })
})
