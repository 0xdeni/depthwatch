/**
 * Seeding the stocks as cross tokens (`SeedPoolsOptions.crossTokens`, docs/design/stocks.md §3):
 * each stock is asked against every reference token and against no other stock, pairs with native
 * ETH on Uniswap v4 only, so the candidates grow linearly with the stock list. The keys sent are
 * decoded from the multicalls and compared with the expected set; the pools found are the ones the
 * world holds on cross pairs.
 */
import { type Address, NATIVE_ETH, type TokenInfo } from '@depthwatch/core'
import { type Abi, custom, decodeFunctionData, type Hex, type Transport } from 'viem'
import { describe, expect, it } from 'vitest'
import { multicall3Abi } from './abi/multicall3.js'
import { uniswapV3FactoryAbi } from './abi/uniswapV3Factory.js'
import { v4StateViewAbi } from './abi/v4StateView.js'
import { computePoolId } from './adapters/uniswapV4Pools.js'
import {
  BASE_ADDRESSES as A,
  NATIVE_ETH_TOKEN,
  REFERENCE_TOKENS,
  resolveAddresses,
  TOKENS,
} from './addresses.js'
import { setClock } from './fixtures/builders.js'
import {
  registerSeedWorld,
  SEED_WORLD_AERO_TICK_SPACINGS,
  type SeedWorldPool,
} from './fixtures/seedWorld.js'
import { createChainReader } from './reader.js'
import {
  crossPairs,
  type SeedPair,
  seedPairs,
  sortedPairs,
  UNISWAP_V3_CANDIDATE_FEES,
  UNISWAP_V4_STANDARD_KEYS,
} from './seed/index.js'
import { BASE_STOCKS, STOCK_TOKENS } from './stocks.js'
import { addr, TOKEN_A } from './test/helpers.js'
import { createFixture, createFixtureTransport, type Fixture } from './transport/fixture.js'

const HEAD = 53_663_272n
const { WETH, USDC } = TOKENS
const REFERENCE: TokenInfo[] = [NATIVE_ETH_TOKEN, WETH, USDC, TOKEN_A]
const addresses = resolveAddresses({ referenceTokens: REFERENCE })
const NVDAC = STOCK_TOKENS.NVDAC
const AMZNC = STOCK_TOKENS.AMZNC
const STOCKS: TokenInfo[] = [NVDAC, AMZNC]
const V3 = addr(0x3001)
const CL = addr(0xc701)
const POOLS: SeedWorldPool[] = [
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

/** Every call inside the multicalls sent, as `<target>|<calldata>`. */
function recorder(inner: Transport): { transport: Transport; calls: string[] } {
  const calls: string[] = []
  const transport: Transport = (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      const [call] = (params ?? []) as [{ to?: Address; data?: Hex }]
      if (method === 'eth_call' && call?.data?.startsWith('0x82ad56cb')) {
        const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data })
        if (decoded.functionName === 'aggregate3')
          for (const c of decoded.args[0]) calls.push(`${c.target.toLowerCase()}|${c.callData}`)
      }
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'recorder', name: 'Recorder', retryCount: 0 })(config)
  }
  return { transport, calls }
}

function seedWorld(): Fixture {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_793_923_030 })
  registerSeedWorld(fixture, { addresses, pools: POOLS, crossTokens: STOCKS })
  return fixture
}

/** The args of every `functionName` call sent to `to`. */
function argsOf(calls: readonly string[], to: Address, abi: Abi, fn: string) {
  return calls.flatMap((entry) => {
    const [target, data] = entry.split('|') as [string, Hex]
    if (target !== to) return []
    const decoded = decodeFunctionData({ abi, data })
    return decoded.functionName === fn ? [decoded.args as readonly unknown[]] : []
  })
}

/** viem decodes addresses checksummed; the seed's are lowercase. */
const lower = (value: unknown) => String(value).toLowerCase()
const key = ([a, b]: readonly unknown[]) => `${lower(a)}|${lower(b)}`
const pairKeys = (pairs: readonly SeedPair[]) => pairs.map(key).sort()
const isStock = (a: unknown) => STOCKS.some((s) => s.address === lower(a))

describe('seedPools with cross tokens', () => {
  const references = REFERENCE.map((t) => t.address)
  const stocks = STOCKS.map((t) => t.address)
  const all = seedPairs(references, stocks)
  const erc20 = all.filter(([a, b]) => a !== NATIVE_ETH && b !== NATIVE_ETH)

  it('asks every stock × reference pair and no stock × stock pair, ETH on v4 only', async () => {
    const { transport, calls } = recorder(createFixtureTransport(seedWorld()))
    const r = createChainReader({ transport, addresses })
    const seeded = await r.seedPools({ crossTokens: stocks })
    expect(seeded.failed).toEqual([])
    // 3 ERC-20 pairs of the references plus 2 stocks × 3 ERC-20 references; currencies 6 + 2 × 4.
    expect([erc20.length, all.length]).toEqual([3 + 2 * 3, 6 + 2 * 4])
    const slipstreamSpacings = 5 * addresses.aerodromeSlipstream.length
    const aeroSpacings = SEED_WORLD_AERO_TICK_SPACINGS.length * addresses.aeroSlipstream.length
    expect(seeded.dexes.map((d) => [d.dex, d.candidates])).toEqual([
      ['uniswap-v3', erc20.length * UNISWAP_V3_CANDIDATE_FEES.length],
      ['uniswap-v4', all.length * UNISWAP_V4_STANDARD_KEYS.length],
      ['aerodrome-v2', erc20.length * 2],
      ['aerodrome-slipstream', erc20.length * slipstreamSpacings],
      ['aero-v2', erc20.length * 2],
      ['aero-slipstream', erc20.length * aeroSpacings],
    ])
    // Uniswap v3: exactly the ERC-20 pairs, once per tier; no ETH, no stock × stock.
    const v3 = argsOf(calls, A.uniswapV3.factory, uniswapV3FactoryAbi, 'getPool')
    expect(v3).toHaveLength(erc20.length * UNISWAP_V3_CANDIDATE_FEES.length)
    expect([...new Set(v3.map(key))].sort()).toEqual(pairKeys(erc20))
    expect(v3.some(([a, b]) => isStock(a) && isStock(b))).toBe(false)
    // Uniswap v4: the PoolKey ids of every currency pair, ETH × stock included.
    const ids = argsOf(calls, A.uniswapV4.stateView, v4StateViewAbi, 'getSlot0')
    const expected = all.flatMap(([currency0, currency1]) =>
      UNISWAP_V4_STANDARD_KEYS.map((k) =>
        computePoolId({ currency0, currency1, ...k, hooks: NATIVE_ETH }),
      ),
    )
    expect(ids.map(([id]) => String(id)).sort()).toEqual(expected.sort())
    expect(all.some(([a, b]) => a === NATIVE_ETH && b === AMZNC.address)).toBe(true)
    // No call of any DEX carries both stocks.
    const both = (data: string) => stocks.every((s) => data.includes(s.slice(2)))
    expect(calls.filter(both)).toEqual([])
  })

  it('finds the stock pools and builds them with the stocks as tokens', async () => {
    const r = createChainReader({ transport: createFixtureTransport(seedWorld()), addresses })
    const seeded = await r.seedPools({ crossTokens: stocks })
    const found = new Map(seeded.pools.map((p) => [p.dex, p]))
    expect([...found.keys()].sort()).toEqual(['aero-slipstream', 'uniswap-v3', 'uniswap-v4'])
    expect(found.get('uniswap-v3')).toMatchObject({
      address: V3,
      token0: USDC,
      token1: NVDAC,
      feePips: 3_000,
      createdAtBlock: 52_000_000n,
    })
    expect(found.get('aero-slipstream')).toMatchObject({ address: CL, token1: NVDAC })
    expect(found.get('aero-slipstream')?.createdAtBlock).toBe(53_000_000n)
    expect(found.get('uniswap-v4')).toMatchObject({
      token0: NATIVE_ETH_TOKEN,
      token1: AMZNC,
      createdAtBlock: 53_100_000n,
    })
  })

  it('asks the stocks nothing without crossTokens', async () => {
    const { transport, calls } = recorder(createFixtureTransport(seedWorld()))
    const seeded = await createChainReader({ transport, addresses }).seedPools()
    expect(seeded.pools).toEqual([])
    expect(seeded.dexes.find((d) => d.dex === 'uniswap-v3')?.candidates).toBe(3 * 7)
    expect(calls.some((data) => stocks.some((s) => data.includes(s.slice(2))))).toBe(false)
  })
})

describe('seed pairs', () => {
  const upper = (a: Address) => a.toUpperCase().replace('0X', '0x') as Address

  it('crossPairs pairs each cross token with each token, never with itself or another', () => {
    const tokens = [USDC.address, NATIVE_ETH, NVDAC.address]
    expect(crossPairs([upper(NVDAC.address), AMZNC.address, NVDAC.address], tokens)).toEqual([
      [USDC.address, NVDAC.address],
      [NATIVE_ETH, NVDAC.address],
      [USDC.address, AMZNC.address],
      [NATIVE_ETH, AMZNC.address],
      [NVDAC.address, AMZNC.address],
    ])
  })

  it('seedPairs is sortedPairs plus the cross pairs, each once, in factory order', () => {
    const tokens = [WETH.address, USDC.address, NATIVE_ETH]
    expect(seedPairs(tokens)).toEqual(sortedPairs(tokens))
    expect(seedPairs(tokens, [])).toEqual(sortedPairs(tokens))
    // A cross token that is also a token adds no pair twice and no self pair.
    const pairs = seedPairs(tokens, [NVDAC.address, USDC.address])
    expect(pairs).toEqual([
      [NATIVE_ETH, WETH.address],
      [NATIVE_ETH, USDC.address],
      [NATIVE_ETH, NVDAC.address],
      [WETH.address, USDC.address],
      [WETH.address, NVDAC.address],
      [USDC.address, NVDAC.address],
    ])
    expect(new Set(pairs.map(key)).size).toBe(pairs.length)
  })

  it('sizes the seed of the ten stocks as stocks.md §3 does: linear in the list', () => {
    const references = REFERENCE_TOKENS.map((t) => t.address)
    const stockList = BASE_STOCKS.tokens.map((t) => t.address)
    const erc20 = (pairs: readonly SeedPair[]) =>
      pairs.filter(([a, b]) => a !== NATIVE_ETH && b !== NATIVE_ETH).length
    const base = seedPairs(references)
    const cross = seedPairs(references, stockList)
    // Per stock: 14 ERC-20 pairs and 15 currency pairs.
    expect([erc20(cross) - erc20(base), cross.length - base.length]).toEqual([140, 150])
    // At 40 calls per ERC-20 pair (7 v3 tiers, 2 Aerodrome v2, 2 Aero v2, 22 + 7 Slipstream
    // spacings) and 4 v4 keys per currency pair: 620 calls a stock, 6,200 for the ten.
    expect((erc20(cross) - erc20(base)) * 40 + (cross.length - base.length) * 4).toBe(6_200)
    // As seed tokens the ten would add their 45 stock × stock pairs too: 8,180 calls.
    const asTokens = seedPairs([...references, ...stockList])
    expect(asTokens.length - cross.length).toBe(45)
    expect((erc20(asTokens) - erc20(base)) * 40 + (asTokens.length - base.length) * 4).toBe(8_180)
  })
})
