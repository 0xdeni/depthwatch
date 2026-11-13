/**
 * The static client's pool search and gap order, as the API answers them: a pair written either
 * way round ("WETH/USDC", "usdc weth"), every term matching a token or the pool, never the DEX,
 * and a pasted pool id finding the pools on its DEX whose address or v4 pool id starts with its
 * hex (core's rule, packages/core/src/poolQuery.ts); and a tie of gap scores (100 from 100× up)
 * going to the larger turnover. `gapFeed` and `matchesPoolQuery` are exported for other clients
 * over the same bundle.
 */
import { describe, expect, it } from 'vitest'
import { poolQueryTerms } from '../lib/poolQuery.js'
import { tableFilter } from '../pages/lists/PoolsField.js'
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
    for (const q of [
      'WETH/USDC',
      'WETH USDC',
      'weth-usdc',
      'usdc weth',
      'USDC:WETH',
      'WETH, USDC',
    ]) {
      const items = await search(q)
      expect(items.map((p) => p.pool.id).sort(), q).toEqual(expected)
      expect((await client.pools({ q })).total, q).toBe(pair.length)
    }
  })

  it('needs every term, each in either token or the pool, never the DEX', async () => {
    const weth = BASE.pools.filter((p) => pairOf(p).split('/').includes('WETH'))
    expect((await search('weth')).length).toBe(weth.length)
    expect(await search('weth/nothere')).toEqual([])
    // "aero" finds the pools holding AERO, not every pool of the Aero and Aerodrome DEXes.
    const aero = BASE.pools.filter((p) => pairOf(p).split('/').includes('AERO'))
    expect(BASE.pools.some((p) => p.pool.dex.startsWith('aero') && !aero.includes(p))).toBe(true)
    expect((await search('aero')).map((p) => p.pool.id).sort()).toEqual(
      aero.map((p) => p.pool.id).sort(),
    )
    expect(await search('usdc uniswap v3')).toEqual([])
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

  it('lists what the mock client and the Pools field list for the same query', async () => {
    const mock = createMockClient({ now: NOW })
    const ids = BASE.pools.map((p) => p.pool.id)
    const pasted = ids.flatMap((id) => [
      id,
      id.toUpperCase(),
      id.slice(0, 16),
      id.replace(':', '%3A'),
    ])
    const sorted = (items: readonly PoolSummary[]) => items.map((p) => p.pool.id).sort()
    let found = 0
    for (const q of [
      'WETH/USDC',
      'usdc weth',
      'aero',
      'slipstream usdc',
      'nothere',
      '',
      ...pasted,
    ]) {
      const expected = sorted((await client.pools({ q, limit: 200 })).items)
      expect(sorted((await mock.pools({ q, limit: 200 })).items), q).toEqual(expected)
      const inField = tableFilter({ dex: '', q, ratedOnly: false })
      expect(sorted(BASE.pools.filter((p) => inField?.(p) ?? true)), q).toEqual(expected)
      found += expected.length
    }
    expect(found).toBeGreaterThan(pasted.length)
  })
})

describe('static client: a pasted pool id', () => {
  const client = createStaticClient(BASE)
  const search = async (q: string) =>
    (await client.pools({ q, limit: 200 })).items.map((p) => p.pool.id).sort()
  const V3 = 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224'
  const ADDRESS = V3.slice('uniswap-v3:'.length)
  const v4 = BASE.pools.find((p) => p.pool.dex === 'uniswap-v4')?.pool
  const otherV3 = BASE.pools.find((p) => p.pool.dex === 'uniswap-v3' && p.pool.id !== V3)?.pool

  it('finds the pool from its full id, with the hex in any case', async () => {
    expect(BASE.pools.some((p) => p.pool.id === V3)).toBe(true)
    for (const q of [V3, `uniswap-v3:${ADDRESS.toUpperCase()}`, `uniswap-v3 : ${ADDRESS}`])
      expect(await search(q), q).toEqual([V3])
    expect((await client.pools({ q: V3 })).total).toBe(1)
  })

  it('finds the pools on the DEX whose address starts with a hex prefix', async () => {
    expect(await search('uniswap-v3:0xD0B5')).toEqual([V3])
    const prefix = '0x'
    for (const digit of '0123456789abcdef') {
      const onDex = BASE.pools
        .filter((p) => p.pool.dex === 'uniswap-v3' && p.pool.address?.startsWith(prefix + digit))
        .map((p) => p.pool.id)
        .sort()
      expect(await search(`uniswap-v3:${prefix}${digit}`), digit).toEqual(onDex)
    }
  })

  it('finds a Uniswap v4 pool from its pool id or a prefix of it', async () => {
    if (!v4?.poolId) throw new Error('no v4 pool in the bundle')
    for (const q of [v4.id, `uniswap-v4:${v4.poolId.toUpperCase()}`, v4.id.slice(0, 20)])
      expect(await search(q), q).toEqual([v4.id])
  })

  it('reads the id as a pool link carries it: "%3A" for ":", or the whole link', async () => {
    if (!v4) throw new Error('no v4 pool in the bundle')
    const encoded = encodeURIComponent(V3)
    expect(await search(encoded)).toEqual([V3])
    expect(await search(`https://depthwatch.pages.dev/#/pools/${encoded}?window=7d`)).toEqual([V3])
    const v4Link = `https://depthwatch.pages.dev/#/pools/${encodeURIComponent(v4.id)}`
    expect(v4Link.length).toBeGreaterThan(100)
    expect(await search(v4Link)).toEqual([v4.id])
  })

  it("leaves the pool out for another pool's hex on its DEX, and its hex on another DEX", async () => {
    if (!v4?.poolId || !otherV3?.address) throw new Error('bundle too small')
    expect(await search(`uniswap-v3:${otherV3.address}`)).toEqual([otherV3.id])
    expect(await search(`uniswap-v3:${v4.poolId}`)).toEqual([])
    for (const dex of ['uniswap-v4', 'aerodrome-v2', 'aerodrome-slipstream', 'aero-slipstream'])
      expect(await search(`${dex}:${ADDRESS}`), dex).toEqual([])
    expect((await client.pools({ q: V3, dex: 'aerodrome-v2' })).total).toBe(0)
  })

  it('keeps the term rule for an unknown DEX prefix, which never reads the DEX', async () => {
    expect(await search(`sushiswap:${ADDRESS}`)).toEqual([])
    expect(await search(`uniswap-v5:${ADDRESS}`)).toEqual([])
    // "weth" is a token of the pool and the hex is its address: every term matches
    expect(await search(`weth:${ADDRESS}`)).toEqual([V3])
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
