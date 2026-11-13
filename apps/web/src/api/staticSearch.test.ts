/**
 * The static client's pool search and gap order, as the API answers them: a pair written either
 * way round ("WETH/USDC", "usdc weth"), every term matching a token, the pool or the DEX (core's
 * rule, packages/core/src/poolQuery.ts); and a tie of gap scores (100 from 100× up) going to the
 * larger turnover. `gapFeed` and `matchesPoolQuery` are exported for other clients over the same
 * bundle.
 */
import { describe, expect, it } from 'vitest'
import { poolQueryTerms } from '../lib/poolQuery.js'
import { matchesQuery } from '../lib/sort.js'
import { bundleFromClient } from '../testing/staticBundle.js'
import { createMockClient } from './mock.js'
import { createStaticClient, gapFeed, matchesPoolQuery } from './static.js'
import type { GapItem, PoolSummary, StaticBundle } from './types.js'

const NOW = 1_760_000_000
const BASE = await bundleFromClient(createMockClient({ now: NOW }), {
  generatedAt: NOW,
  source: 'demo',
})

const pairOf = (p: PoolSummary) => [p.pool.token0.symbol, p.pool.token1.symbol].sort().join('/')

describe('poolQueryTerms', () => {
  it('splits on whitespace, "/", "-" and ":", folds ASCII case and drops repeats', () => {
    for (const q of ['WETH/USDC', 'WETH USDC', 'weth-usdc', 'weth : usdc', ' WETH\t/ USDC '])
      expect(poolQueryTerms(q), q).toEqual(['weth', 'usdc'])
    expect(poolQueryTerms('usdc weth')).toEqual(['usdc', 'weth'])
    expect(poolQueryTerms('WETH weth')).toEqual(['weth'])
    for (const q of ['', '  ', '/', ' - : ']) expect(poolQueryTerms(q), q).toEqual([])
  })
})

describe('static client: pair search', () => {
  const client = createStaticClient(BASE)
  const search = async (q: string) => (await client.pools({ q, limit: 200 })).items

  it('lists the pools of a pair whichever way the pair is written', async () => {
    const pair = BASE.pools.filter((p) => pairOf(p) === 'USDC/WETH')
    expect(pair.length).toBeGreaterThan(1)
    const expected = pair.map((p) => p.pool.id).sort()
    for (const q of ['WETH/USDC', 'WETH USDC', 'weth-usdc', 'usdc weth', 'USDC:WETH']) {
      const items = await search(q)
      expect(items.map((p) => p.pool.id).sort(), q).toEqual(expected)
      expect((await client.pools({ q })).total, q).toBe(pair.length)
    }
  })

  it('needs every term, each in either token, the pool or the DEX', async () => {
    const weth = BASE.pools.filter((p) => pairOf(p).split('/').includes('WETH'))
    expect((await search('weth')).length).toBe(weth.length)
    expect(await search('weth/nothere')).toEqual([])
    const v3 = await search('usdc uniswap v3')
    expect(v3.length).toBeGreaterThan(0)
    for (const p of v3) {
      expect(p.pool.dex).toBe('uniswap-v3')
      expect(pairOf(p).split('/')).toContain('USDC')
    }
    const first = BASE.pools[0]
    if (!first) throw new Error('empty bundle')
    const byName = await search(first.pool.token0.name)
    expect(byName.map((p) => p.pool.id)).toContain(first.pool.id)
    const byAddresses = await search(`${first.pool.token1.address} ${first.pool.token0.address}`)
    expect(byAddresses.map((p) => p.pool.id)).toContain(first.pool.id)
    expect((await client.pools({ q: ' / ' })).total).toBe(BASE.pools.length)
  })

  it('matches names at a word start: "eth" finds no USDC / USDT pool through "Tether USD"', () => {
    const first = BASE.pools[0]
    if (!first) throw new Error('empty bundle')
    const usdcUsdt = structuredClone(first)
    usdcUsdt.pool.token0 = { ...usdcUsdt.pool.token0, symbol: 'USDC', name: 'USD Coin' }
    usdcUsdt.pool.token1 = { ...usdcUsdt.pool.token1, symbol: 'USDT', name: 'Tether USD' }
    usdcUsdt.pool.dex = 'uniswap-v3'
    expect(matchesPoolQuery(usdcUsdt, 'ETH/USDC')).toBe(false)
    expect(matchesPoolQuery(usdcUsdt, 'tether usdc')).toBe(true)
    expect(matchesPoolQuery(usdcUsdt, 'coin')).toBe(true)
    expect(matchesPoolQuery(usdcUsdt, 'swap')).toBe(false)
  })

  it('is the one rule of the mock client and the Pools field', () => {
    for (const q of ['WETH/USDC', 'usdc weth', 'aero', 'slipstream usdc', 'nothere', ''])
      for (const p of BASE.pools) expect(matchesQuery(p, q), q).toBe(matchesPoolQuery(p, q))
  })
})

describe('static client: equal gap scores', () => {
  /** The feed with its first four entries scored 100 at 101×, 195×, 174× and 195×. */
  function tied(): { bundle: StaticBundle; heads: GapItem[] } {
    const bundle = structuredClone(BASE)
    const heads = bundle.gaps.slice(0, 4)
    if (heads.length < 4) throw new Error('feed too small')
    heads.forEach((item, i) => {
      const turnover = [101, 195, 174, 195][i] ?? 0
      item.gap = { ...item.gap, gapScore: 100, turnoverRatio: turnover }
      item.pool.gapScore = 100
    })
    return { bundle, heads }
  }

  it('orders a tie by turnover, highest first, then by pool id', async () => {
    const { bundle, heads } = tied()
    const [h101, h195a, h174, h195b] = heads as [GapItem, GapItem, GapItem, GapItem]
    const twins = [h195a.pool.pool.id, h195b.pool.pool.id].sort()
    const expected = [...twins, h174.pool.pool.id, h101.pool.pool.id]
    const res = await createStaticClient(bundle).gaps({ limit: 4 })
    expect(res.items.map((g) => g.pool.pool.id)).toEqual(expected)
    expect(res.items[0]?.gap.turnoverRatio).toBe(195)
    expect(
      gapFeed(bundle, 10_000)
        .slice(0, 4)
        .map((g) => g.pool.pool.id),
    ).toEqual(expected)
  })

  it('puts an unknown turnover after a known one at the same score', () => {
    const { bundle, heads } = tied()
    const first = heads[1]
    if (!first) throw new Error('feed too small')
    first.gap = { ...first.gap, turnoverRatio: null }
    const order = gapFeed(bundle, 10_000).map((g) => g.pool.pool.id)
    expect(order.indexOf(first.pool.pool.id)).toBe(3)
  })
})
