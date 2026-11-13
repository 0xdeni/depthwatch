import { describe, expect, it } from 'vitest'
import { createMockClient } from '../api/mock.js'
import type { PoolSummary } from '../api/types.js'
import { matchesQuery, sortSummaries } from './sort.js'

const V3_WETH_USDC = 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224'

async function summaries(): Promise<PoolSummary[]> {
  const { items } = await createMockClient({ now: 1_760_000_000 }).pools({ limit: 200 })
  return items
}

async function wethUsdc(): Promise<PoolSummary> {
  const item = (await summaries()).find((s) => s.pool.id === V3_WETH_USDC)
  if (!item) throw new Error('mock WETH/USDC v3 pool missing')
  return item
}

describe('matchesQuery', () => {
  it('matches the same fields as the API: token symbol, token address or pool address', async () => {
    const item = await wethUsdc()
    expect(matchesQuery(item, 'weth')).toBe(true)
    expect(matchesQuery(item, 'USDC')).toBe(true)
    expect(matchesQuery(item, 'WETH / USDC')).toBe(true)
    expect(matchesQuery(item, item.pool.token0.address.slice(0, 10))).toBe(true)
    expect(matchesQuery(item, item.pool.token1.address.toUpperCase())).toBe(true)
    expect(matchesQuery(item, item.pool.address ?? '')).toBe(true)
    expect(matchesQuery(item, '  ')).toBe(true)
    expect(matchesQuery(item, 'cbbtc')).toBe(false)
  })

  it('matches a pasted pool id: its DEX, then the start of its address', async () => {
    const item = await wethUsdc()
    for (const q of [
      V3_WETH_USDC,
      V3_WETH_USDC.toUpperCase(),
      'uniswap-v3 : 0xd0b53d',
      encodeURIComponent(V3_WETH_USDC),
      `https://depthwatch.pages.dev/#/pools/${encodeURIComponent(V3_WETH_USDC)}?window=7d`,
    ])
      expect(matchesQuery(item, q), q).toBe(true)
    expect(matchesQuery(item, V3_WETH_USDC.replace('uniswap-v3', 'aerodrome-slipstream'))).toBe(
      false,
    )
    expect(matchesQuery(item, 'uniswap-v3:0xd0b6')).toBe(false)
  })

  it('matches token names and a pair written either way round, like the API filter', async () => {
    const item = await wethUsdc()
    expect(item.pool.token0.name).toBe('Wrapped Ether')
    expect(item.pool.token1.name).toBe('USD Coin')
    expect(matchesQuery(item, 'Wrapped Ether')).toBe(true)
    expect(matchesQuery(item, 'USD Coin')).toBe(true)
    for (const q of ['WETH/USDC', 'usdc weth', 'weth-usdc', 'USDC:WETH'])
      expect(matchesQuery(item, q), q).toBe(true)
    expect(matchesQuery(item, 'weth/cbbtc')).toBe(false)
  })

  it('never matches the DEX by its words: the DEX has its own filter', async () => {
    const item = await wethUsdc()
    // "uniswap" and "v3" name the pool's DEX, which search terms never read
    for (const q of ['uniswap v3 weth', 'uniswap', 'aerodrome usdc'])
      expect(matchesQuery(item, q), q).toBe(false)
  })
})

describe('sortSummaries', () => {
  it('sorts nulls last in either direction and keeps ties stable', async () => {
    const all = await summaries()
    for (const dir of ['asc', 'desc'] as const) {
      const depths = sortSummaries(all, 'tvl', dir).map((s) => s.tvlUsd)
      const nulls = depths.filter((d) => d === null).length
      expect(nulls).toBeGreaterThan(0) // the unpriced pool has no TVL
      expect(depths.slice(depths.length - nulls).every((d) => d === null)).toBe(true)
      const known = depths.filter((d): d is number => d !== null)
      expect([...known].sort((a, b) => (dir === 'asc' ? a - b : b - a))).toEqual(known)
    }
  })

  it('puts the unrated pools after the rated ones when sorting by health, in both directions', async () => {
    const all = await summaries()
    const unrated = all.filter((s) => !s.health.rated)
    expect(unrated.length).toBe(3)
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = sortSummaries(all, 'health', dir)
      const ratedPart = sorted.slice(0, all.length - unrated.length)
      const unratedPart = sorted.slice(all.length - unrated.length)
      expect(ratedPart.every((s) => s.health.rated)).toBe(true)
      expect(unratedPart.every((s) => !s.health.rated)).toBe(true)
      // each group is ordered by its own totals
      for (const group of [ratedPart, unratedPart]) {
        const totals = group.map((s) => s.health.total)
        expect([...totals].sort((a, b) => (dir === 'asc' ? a - b : b - a))).toEqual(totals)
      }
    }
    // other keys do not care about the rating
    const byVolume = sortSummaries(all, 'volume', 'desc').map((s) => s.pool.id)
    expect(byVolume.slice(0, 3).some((id) => unrated.some((u) => u.pool.id === id))).toBe(false)
  })

  it('puts stale quotes after the other pools when sorting by depth, in both directions', async () => {
    const all = await summaries()
    const deepest = sortSummaries(all, 'depth', 'desc')[0]
    if (!deepest) throw new Error('no mock pools')
    const marked = all.map((s) => (s === deepest ? { ...s, staleQuote: true } : s))
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = sortSummaries(marked, 'depth', dir)
      expect(sorted.at(-1)?.pool.id).toBe(deepest.pool.id)
    }
    // other keys do not care about the flag
    expect(sortSummaries(marked, 'tvl', 'desc')[0]?.pool.id).toBe(
      sortSummaries(all, 'tvl', 'desc')[0]?.pool.id,
    )
  })
})
