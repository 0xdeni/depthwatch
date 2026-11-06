/**
 * `discover --seed` over stored Aero Slipstream pools outside the seeded pairs (found by log
 * discovery, or tracked with `--pool` or a mandate): their swap hook is read again, so a pool whose
 * hook changed is stored as hooked instead of failing every snapshot with "swap hook changed". A
 * pool with a snapshot keeps its stored fee; a failed re-read fails `aero-slipstream`.
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
  setClock,
  TOKENS,
} from '@depthwatch/chain'
import type { Address, PoolMeta, TokenInfo } from '@depthwatch/core'
import { type Database, fixtureSnapshot, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { custom, type Transport } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createLogger } from '../log.js'
import { createPipelineContext, syncKeys } from './context.js'
import { seedStep } from './seed.js'

const HEAD = 53_213_030n
const addr = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address
const { WETH, USDC } = TOKENS
/** A project's token: its pools exist on chain but are not among the seeded pairs. */
const PROJECT: TokenInfo = { address: addr(0xbeef), symbol: 'PRJ', name: 'Project', decimals: 18 }
const addresses = resolveAddresses({ referenceTokens: [NATIVE_ETH_TOKEN, WETH, USDC] })
const SEEDED = addr(0xc701)
const OUTSIDE = addr(0xc702)
const OUTSIDE_ID = `aero-slipstream:${OUTSIDE}`
const OTHER_HOOK = addr(0x4004)
const WORLD = {
  addresses: resolveAddresses({ referenceTokens: [...addresses.referenceTokens, PROJECT] }),
  // The reader's default stock list is seeded as cross tokens; none of them has a pool here.
  crossTokens: BASE_STOCKS.tokens,
  pools: [
    {
      dex: 'aero-slipstream',
      tokens: [WETH.address, USDC.address],
      tickSpacing: 50,
      address: SEEDED,
      createdAtBlock: 52_885_483n,
    },
    {
      dex: 'aero-slipstream',
      tokens: [PROJECT.address, WETH.address],
      tickSpacing: 200,
      address: OUTSIDE,
      createdAtBlock: 53_000_000n,
      liveFee: 465,
      swapHook: OTHER_HOOK,
    },
  ] satisfies SeedWorldPool[],
}

/** The outside pool as log discovery stored it, before Aero gave it a hook of its own. */
const STORED: PoolMeta = {
  id: OUTSIDE_ID,
  dex: 'aero-slipstream',
  kind: 'concentrated',
  address: OUTSIDE,
  poolId: null,
  token0: WETH.address < PROJECT.address ? WETH : PROJECT,
  token1: WETH.address < PROJECT.address ? PROJECT : WETH,
  feePips: 2_055,
  tickSpacing: 200,
  stable: false,
  hooks: null,
  createdAtBlock: 53_000_000n,
}

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

/** A seed of `aero-slipstream` over the world; `fail` refuses the calls it matches. */
function seed(db: Database, fail: (params: string) => boolean = () => false) {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
  registerSeedWorld(fixture, WORLD)
  const inner = createFixtureTransport(fixture)
  const transport: Transport = (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_call' && fail(JSON.stringify(params)))
        throw new Error('execution reverted')
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'refusing', name: 'Refusing', retryCount: 0 })(config)
  }
  const lines: string[] = []
  const chain = createChainReader({ transport, addresses })
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const config = loadConfig({}, { seed: true, dex: ['aero-slipstream'] })
  return { ctx: createPipelineContext({ db, chain, config, log }), lines }
}

function storedDb(): Database {
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  db.pools.upsertMany([STORED])
  return db
}

describe('seedStep: stored Aero Slipstream pools outside the seeded pairs', () => {
  it('reads their swap hook again and stores the pool as hooked', async () => {
    const db = storedDb()
    const { ctx, lines } = seed(db)
    expect(await seedStep(ctx)).toMatchObject({ found: 1, added: 1, refreshed: 1 })
    expect(db.pools.get(OUTSIDE_ID)).toEqual({ ...STORED, feePips: 465, hooks: OTHER_HOOK })
    expect(db.pools.get(`aero-slipstream:${SEEDED}`)?.hooks).toBeNull()
    expect(db.syncState.getBigInt(syncKeys.seed('aero-slipstream'))).toBe(HEAD)
    const reread = `INFO  pool configuration read again pool=${OUTSIDE_ID} hooked=true`
    expect(lines.some((l) => l.endsWith(reread))).toBe(true)
    expect(
      lines.some((l) => l.includes('stored pools read again dex=aero-slipstream stored=1')),
    ).toBe(true)
  })

  it('keeps the stored fee of a pool with a snapshot, the latest snapshot’s reading', async () => {
    const db = storedDb()
    db.snapshots.insertMany([fixtureSnapshot({ poolId: OUTSIDE_ID, feePips: 2_055 })])
    await seedStep(seed(db).ctx)
    expect(db.pools.get(OUTSIDE_ID)).toEqual({ ...STORED, hooks: OTHER_HOOK })
  })

  it('fails aero-slipstream, unmarked, when the re-read fails', async () => {
    const db = storedDb()
    const project = PROJECT.address.slice(2)
    const { ctx, lines } = seed(db, (params) => params.includes(project))
    await expect(seedStep(ctx)).rejects.toThrow(/seeding failed for aero-slipstream/)
    expect(db.pools.get(OUTSIDE_ID)).toEqual(STORED)
    expect(db.pools.get(`aero-slipstream:${SEEDED}`)).toBeDefined()
    expect(db.syncState.getBigInt(syncKeys.seed('aero-slipstream'))).toBeUndefined()
    expect(lines.some((l) => /WARN {2}seed failed dex=aero-slipstream/.test(l))).toBe(true)
  })
})
