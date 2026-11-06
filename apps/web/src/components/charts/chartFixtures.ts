/**
 * Test fixtures for the chart tests: the demo world's six pools, one snapshot and a scorecard
 * series ($11.8M and $14.3M totals, the $31.5K gap pool, $5.10M and $6.08M at ±2 %). Imported
 * by tests only; nothing here reaches the bundle.
 */
import type { Dex } from '@depthwatch/core'
import type { MmSampleDto, PoolSnapshotDto, PoolSummary } from '../../api/types.js'

const token = (symbol: string, decimals: number) => ({
  address: `0x${symbol.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
  symbol,
  name: symbol,
  decimals,
})
export const WETH = token('WETH', 18)
export const USDC = token('USDC', 6)

export function summary(
  id: string,
  pair: [string, string],
  dex: Dex,
  down: number | null,
  up: number | null,
): PoolSummary {
  return {
    pool: {
      id,
      dex,
      kind: dex === 'aerodrome-v2' ? 'constant-product' : 'concentrated',
      address: id.split(':')[1] ?? null,
      poolId: null,
      token0: token(pair[0], 18),
      token1: token(pair[1], 6),
      feePips: 500,
      tickSpacing: 10,
      stable: false,
      hooks: null,
      createdAtBlock: '1',
    } as PoolSummary['pool'],
    price: 1,
    tvlUsd: null,
    depth2Usd: down === null && up === null ? null : (down ?? 0) + (up ?? 0),
    depth2UpUsd: up,
    depth2DownUsd: down,
    spread10kBps: 10,
    priceDeviationBps: 0,
    staleQuote: false,
    health: {
      total: 80,
      grade: 'A',
      rated: true,
      unratedReason: null,
      concentrationBasis: 'owners',
    },
    gapScore: 0,
    volume24hUsd: null,
    ownerTop1Share: null,
    updatedAt: 1_792_713_600,
  }
}

/** The demo world's six scored pools, deepest first ($11.8M sell, $14.3M buy in all). */
export const DEMO_POOLS: PoolSummary[] = [
  summary(
    'aerodrome-slipstream:0xdf54',
    ['WETH', 'USDC'],
    'aerodrome-slipstream',
    5_102_004,
    6_079_641,
  ),
  summary('uniswap-v3:0x77eb', ['WETH', 'USDC'], 'uniswap-v3', 2_311_913, 2_964_808),
  summary('uniswap-v4:0x96d4', ['ETH', 'USDC'], 'uniswap-v4', 1_818_378, 2_377_497),
  summary('uniswap-v3:0xa528', ['USDC', 'cbBTC'], 'uniswap-v3', 1_882_421, 2_186_184),
  summary('aerodrome-v2:0x03ce', ['USDC', 'USDbC'], 'aerodrome-v2', 634_844, 681_577),
  summary('aerodrome-v2:0xd59e', ['USDC', 'AERO'], 'aerodrome-v2', 15_908, 15_592),
]
export const GAP_POOL_ID = 'aerodrome-v2:0xd59e'

const side = (amountIn: string, reached = true) => ({ amountIn, amountOut: '1', reached })

/** WETH / USDC at ±1/2/5 %: $5.10M of selling and $6.08M of buying at ±2 %. */
export const SNAPSHOT: PoolSnapshotDto = {
  poolId: 'aerodrome-slipstream:0xdf54',
  blockNumber: '52950000',
  timestamp: 1_792_713_600,
  price: 2460.32,
  token0Usd: 2460.32,
  token1Usd: 1,
  tvlUsd: 85_300_000,
  activeLiquidity: '1',
  depth: [
    { pct: 1, up: side('2938646565148'), down: side('1071119926973001033620') },
    { pct: 2, up: side('6079641564088'), down: side('2073717584387248377084') },
    { pct: 5, up: side('14335396962879'), down: side('4283799219306164824487') },
  ],
  depthUsd: [
    { pct: 1, upUsd: 2_938_646.57, downUsd: 2_635_295.54, totalUsd: 5_573_942.11 },
    { pct: 2, upUsd: 6_079_641.56, downUsd: 5_102_004.52, totalUsd: 11_181_646.08 },
    { pct: 5, upUsd: 14_335_396.96, downUsd: 10_539_507.95, totalUsd: 24_874_904.91 },
  ],
  spreads: [
    {
      notionalUsd: 1000,
      spreadBps: 10.04,
      feasible: true,
      buyAvgPrice: 2461.55,
      sellAvgPrice: 2459.08,
    },
    {
      notionalUsd: 10000,
      spreadBps: 10.38,
      feasible: true,
      buyAvgPrice: 2461.6,
      sellAvgPrice: 2459.04,
    },
    {
      notionalUsd: 100000,
      spreadBps: 13.83,
      feasible: true,
      buyAvgPrice: 2462.02,
      sellAvgPrice: 2458.62,
    },
  ],
  concentration: null,
  priceDeviationBps: 0,
  feePips: null,
  reference: null,
}

/**
 * A scorecard series sampled every 2 h from `start`: `pattern` holds one character per sample,
 * `b` breached on both sides, `s` breached on the sell side only, `o` within KPI, `u` unpriced.
 * Samples are 3,600 blocks apart: 2 h of 2 s blocks, Base's spacing before Denim (the default
 * `start`, 2026-10-16, is before it; 2 h are 36,000 blocks of 200 ms since).
 */
export function samples(pattern: string, start = 1_792_108_800, kpi = 50_000): MmSampleDto[] {
  return [...pattern].map((c, i) => {
    const low = c === 'b' || c === 's'
    return {
      mandateId: 'demo',
      poolId: GAP_POOL_ID,
      blockNumber: String(52_000_000 + i * 3600),
      timestamp: start + i * 7200,
      attribution: {
        method: 'lp-share',
        holdings: 1,
        shareOfPool: 0.49,
        depthUpUsd: c === 'u' ? null : c === 'b' ? 7_400 + i : kpi * 1.2,
        depthDownUsd: c === 'u' ? null : low ? 7_600 + i : kpi * 1.2,
        poolDepthUpUsd: 15_600,
        poolDepthDownUsd: 15_900,
        spreadBps: 30,
        poolSpreadBps: 30,
      },
      withinKpi: c === 'u' ? null : !low,
      breaches: c === 'b' ? ['depthUp', 'depthDown'] : c === 's' ? ['depthDown'] : [],
    }
  })
}
