/**
 * The seeds of the mock's tokenized stocks (`mockStocks.ts` builds the world from them): seven
 * synthetic stocks at `0xb2…` (core's `makeStock`; no real stock or feed address is copied here:
 * `packages/chain/src/stocks.ts` stays the only place those live), how each one's reading is read
 * (judged by core's `evaluateStockReading`), and seven stock pools in the shape of
 * `mock/pools.json`. Numbers follow docs/METRICS.md's examples where they can.
 */
import {
  evaluateStockReading,
  makeStock,
  type StockInfo,
  type StockReading,
  stockRawRead,
} from '@depthwatch/core'
import { type PoolSeed, TOKENS, type TokenTable } from './mockPools.js'

const NVDA_MULTIPLIER = 1_000_538_000_000_000_000n

export interface StockSpec {
  info: StockInfo
  /** The price graph's USD price (the valuation convention); 0 for none. */
  usd: number
  read: (now: number, block: { blockNumber: bigint; timestamp: number }) => StockReading
}

function stock(symbol: string, name: string, feed = true): StockInfo {
  const info = makeStock(symbol, feed ? {} : { feed: null })
  return { ...info, token: { ...info.token, name } }
}

const NVDA = stock('NVDAc', 'NVIDIA Corporation')
const AMZN = stock('AMZNc', 'Amazon.com Inc.')
const TSLA = stock('TSLAc', 'Tesla Inc.')
const AAPL = stock('AAPLc', 'Apple Inc.')
const META = stock('METAc', 'Meta Platforms Inc.')
const MSFT = stock('MSFTc', 'Microsoft Corporation')
const COIN = stock('COINc', 'Coinbase Global Inc.', false)

export const SPECS: readonly StockSpec[] = [
  {
    info: NVDA,
    usd: 200,
    read: (now, block) =>
      evaluateStockReading(
        NVDA,
        stockRawRead(NVDA, 19_950_000_000n, now - 1_800, {
          oracleMultiplierWad: NVDA_MULTIPLIER,
          tokenMultiplierWad: NVDA_MULTIPLIER,
        }),
        block,
      ),
  },
  {
    info: AMZN,
    usd: 221,
    read: (now, block) =>
      evaluateStockReading(AMZN, stockRawRead(AMZN, 22_000_000_000n, now - 100_000), block),
  },
  {
    info: TSLA,
    usd: 250,
    read: (now, block) =>
      evaluateStockReading(
        TSLA,
        stockRawRead(TSLA, 24_900_000_000n, now - 600, { pausedOrdinals: [0] }),
        block,
      ),
  },
  {
    info: AAPL,
    usd: 270,
    read: (now, block) =>
      evaluateStockReading(
        AAPL,
        stockRawRead(AAPL, 27_000_000_000n, now - 3_600, { oraclePaused: true }),
        block,
      ),
  },
  {
    info: META,
    usd: 0,
    read: (now, block) =>
      evaluateStockReading(
        META,
        stockRawRead(META, 61_000_000_000n, now - 900, { description: 'Coinbase MSFT' }),
        block,
      ),
  },
  {
    info: MSFT,
    usd: 0,
    read: (now, block) =>
      evaluateStockReading(
        MSFT,
        stockRawRead(MSFT, 42_000_000_000n, now - 900, {
          oracleMultiplierWad: null,
          oraclePaused: null,
        }),
        block,
        'getOracleParams: reverted.',
      ),
  },
  { info: COIN, usd: 0, read: (_now, block) => evaluateStockReading(COIN, null, block) },
]

const id = (dex: string, n: number) => `${dex}:0x${n.toString(16).padStart(4, '0').padEnd(40, '7')}`
export const MOCK_STOCK_POOLS = {
  nvdaUsdcAero: id('aero-slipstream', 0x5a01),
  nvdaWethV3: id('uniswap-v3', 0x5a02),
  nvdaUsdcV4: `uniswap-v4:0x${'5a03'.padEnd(64, 'c')}`,
  amznUsdcSlip: id('aerodrome-slipstream', 0x5a04),
  amznCbbtcV3: id('uniswap-v3', 0x5a05),
  tslaUsdcSlip: id('aerodrome-slipstream', 0x5a06),
  aaplUsdcV3: id('uniswap-v3', 0x5a07),
} as const

/** A pool seed: the ±2 % sides `[up, down]` in USD scale the ±1 % and ±5 % levels. */
function pool(
  poolId: string,
  token0: string,
  token1: string,
  terms: { fee: number; tick: number | null; price: number; tvl: number; vol: number },
  d2: [number, number],
  spreads: Array<number | null>,
): PoolSeed {
  const [dex = '', key = ''] = poolId.split(':')
  const v4 = dex === 'uniswap-v4'
  const [up, down] = d2
  return {
    id: poolId,
    dex: dex as PoolSeed['dex'],
    kind: 'concentrated',
    address: v4 ? null : key,
    poolId: v4 ? key : null,
    token0,
    token1,
    feePips: terms.fee,
    tickSpacing: terms.tick,
    stable: false,
    hooks: null,
    createdAtBlock: '53100000',
    price: terms.price,
    tvlUsd: terms.tvl,
    activeLiquidity: '81234567890123',
    depthUsd: { '1': [up / 2, down / 2], '2': [up, down], '5': [up * 2.3, down * 2.3] },
    spreadBps: spreads,
    concentration: {
      rangeHhi: 0.22,
      activeRangeShare: 0.34,
      owners: { count: 14, top1Share: 0.38, top3Share: 0.71, hhi: 0.24, coverage: 0.96 },
    },
    persistence: { '24h': [0.88, 0.97], '7d': [0.8, 0.94] },
    volume24hUsd: terms.vol,
  }
}

const P = MOCK_STOCK_POOLS
export const POOL_SEEDS: readonly PoolSeed[] = [
  // poolUsd = 1 / 0.005 = $200.00 against $199.50: +25.06 bps, within 50 + 5.
  pool(
    P.nvdaUsdcAero,
    'USDC',
    'NVDAc',
    { fee: 500, tick: 50, price: 0.005, tvl: 1_500_000, vol: 400_000 },
    [260_000, 250_000],
    [12, 30, 96],
  ),
  // poolUsd = 3,842.15 / price = $197.00: −125.31 bps, outside 50 + 30.
  pool(
    P.nvdaWethV3,
    'WETH',
    'NVDAc',
    { fee: 3000, tick: 60, price: 3842.15 / 197, tvl: 200_000, vol: 100_000 },
    [40_000, 50_000],
    [40, 120, null],
  ),
  pool(
    P.nvdaUsdcV4,
    'USDC',
    'NVDAc',
    { fee: 3000, tick: 60, price: 0.00501, tvl: 9_000, vol: 2_000 },
    [3_000, 2_500],
    [90, null, null],
  ),
  pool(
    P.amznUsdcSlip,
    'USDC',
    'AMZNc',
    { fee: 500, tick: 50, price: 1 / 221.4, tvl: 300_000, vol: 60_000 },
    [30_000, 32_000],
    [16, 40, 180],
  ),
  // AMZNc (0xb2…) sorts before cbBTC (0xcb…): the stock is token0, its buy side is up.
  pool(
    P.amznCbbtcV3,
    'AMZNc',
    'cbBTC',
    { fee: 3000, tick: 60, price: 221 / 98_520, tvl: 120_000, vol: 15_000 },
    [12_000, 14_000],
    [45, 140, null],
  ),
  // poolUsd = 1 / 0.004 = $250.00 against $249.00: +40.16 bps, kept though no swap can use it.
  pool(
    P.tslaUsdcSlip,
    'USDC',
    'TSLAc',
    { fee: 500, tick: 50, price: 0.004, tvl: 400_000, vol: 20_000 },
    [45_000, 45_000],
    [14, 35, 150],
  ),
  pool(
    P.aaplUsdcV3,
    'USDC',
    'AAPLc',
    { fee: 500, tick: 10, price: 1 / 270.4, tvl: 260_000, vol: 30_000 },
    [20_000, 22_000],
    [18, 44, 210],
  ),
]

/** Every stock and quote token a stock pool seed names, by key. */
export const STOCK_TOKENS: TokenTable = {
  ...TOKENS,
  ...Object.fromEntries(
    SPECS.map(({ info, usd }) => {
      const via = POOL_SEEDS.find((s) => s.token0 === 'USDC' && s.token1 === info.token.symbol)
      return [
        info.token.symbol,
        { ...info.token, usd, via: usd > 0 && via ? [via.id] : [] },
      ] as const
    }),
  ),
}

/** The token-table key of a stock token's address; undefined for any other token. */
export function stockTokenKey(address: string): string | undefined {
  const a = address.toLowerCase()
  return SPECS.find((s) => s.info.token.address.toLowerCase() === a)?.info.token.symbol
}
