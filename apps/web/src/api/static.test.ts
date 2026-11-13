/**
 * Static client semantics (docs/design/web-v2.md §4, §5): sorting, filters and paging answered
 * from a small bundle (read through the mock client) exactly as the API's routes answer them.
 */
import { describe, expect, it } from 'vitest'
import { bundleFromClient } from '../testing/staticBundle.js'
import { createMockClient } from './mock.js'
import { createStaticClient } from './static.js'
import type { PoolSummary, StaticBundle } from './types.js'

const NOW = 1_760_000_000
const BASE = await bundleFromClient(createMockClient({ now: NOW }), {
  generatedAt: NOW,
  source: 'demo',
})

function fresh(): StaticBundle {
  return structuredClone(BASE)
}

const ids = (items: readonly PoolSummary[]) => items.map((item) => item.pool.id)

/** Binary string order, like SQLite's `ORDER BY pool_id`. */
function byId(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * The API's order, written out independently: value per dir, nulls last, then id ascending; by
 * health (`unratedLast`) the unrated pools follow every rated one in both directions.
 */
function expectedOrder(
  items: readonly PoolSummary[],
  value: (item: PoolSummary) => number | null,
  dir: 'asc' | 'desc',
  unratedLast = false,
): string[] {
  return [...items]
    .sort((a, b) => {
      if (unratedLast && a.health.rated !== b.health.rated) return a.health.rated ? -1 : 1
      const va = value(a)
      const vb = value(b)
      if (va === null && vb !== null) return 1
      if (vb === null && va !== null) return -1
      if (va !== null && vb !== null && va !== vb) return dir === 'asc' ? va - vb : vb - va
      return byId(a.pool.id, b.pool.id)
    })
    .map((item) => item.pool.id)
}

/** A bundle with `count` scored pools (copies of the first with fresh ids). */
function inflated(count: number): StaticBundle {
  const bundle = fresh()
  const template = bundle.pools[0]
  if (!template) throw new Error('empty bundle')
  bundle.pools = Array.from({ length: count }, (_, i) => ({
    ...structuredClone(template),
    pool: { ...template.pool, id: `uniswap-v3:0x${i.toString(16).padStart(40, '0')}` },
    health: {
      total: i % 100,
      grade: 'C',
      rated: true,
      unratedReason: null,
      concentrationBasis: 'owners',
    },
  }))
  return bundle
}

describe('static client: pools', () => {
  it('defaults to health desc with ties broken by pool id, limit 50, total of all matches', async () => {
    const res = await createStaticClient(BASE).pools()
    expect(res.total).toBe(BASE.pools.length)
    expect(ids(res.items)).toEqual(expectedOrder(BASE.pools, (p) => p.health.total, 'desc', true))
    // The mock lists its two 93.0 pools by seed order; the API breaks the tie by id.
    const tied = res.items.filter((item) => item.health.total === 93).map((item) => item.pool.id)
    expect(tied).toHaveLength(2)
    expect([...tied].sort(byId)).toEqual(tied)
  })

  it('sorts by every key in both directions with nulls last either way', async () => {
    const bundle = fresh()
    const [first, second] = bundle.pools
    if (!first || !second) throw new Error('bundle too small')
    first.tvlUsd = null
    second.tvlUsd = null
    first.gapScore = null
    const client = createStaticClient(bundle)
    const keys = {
      health: (p: PoolSummary) => p.health.total,
      depth: (p: PoolSummary) => p.depth2Usd,
      volume: (p: PoolSummary) => p.volume24hUsd,
      gap: (p: PoolSummary) => p.gapScore,
      tvl: (p: PoolSummary) => p.tvlUsd,
      spread: (p: PoolSummary) => p.spread10kBps,
      top: (p: PoolSummary) => p.ownerTop1Share,
    } as const
    for (const [sort, value] of Object.entries(keys)) {
      for (const dir of ['asc', 'desc'] as const) {
        const res = await client.pools({ sort: sort as keyof typeof keys, dir, limit: 200 })
        expect(ids(res.items), `${sort} ${dir}`).toEqual(
          expectedOrder(bundle.pools, value, dir, sort === 'health'),
        )
      }
    }
    const asc = await client.pools({ sort: 'tvl', dir: 'asc', limit: 200 })
    expect(ids(asc.items).slice(-2)).toEqual([first.pool.id, second.pool.id].sort(byId))
  })

  it('filters by dex, by minimum known volume and by q, counting matches before paging', async () => {
    const bundle = fresh()
    const quiet = bundle.pools.find((p) => p.pool.dex === 'uniswap-v3')
    if (!quiet) throw new Error('no uniswap-v3 pool')
    quiet.volume24hUsd = null
    const client = createStaticClient(bundle)

    const v3 = await client.pools({ dex: 'uniswap-v3', limit: 2 })
    const allV3 = bundle.pools.filter((p) => p.pool.dex === 'uniswap-v3')
    expect(v3.total).toBe(allV3.length)
    expect(v3.items).toHaveLength(2)
    expect(v3.items.every((p) => p.pool.dex === 'uniswap-v3')).toBe(true)

    const busy = await client.pools({ minVolume: 10_000_000, limit: 200 })
    const expected = bundle.pools.filter((p) => p.volume24hUsd !== null && p.volume24hUsd >= 1e7)
    expect(new Set(ids(busy.items))).toEqual(new Set(ids(expected)))
    expect(ids((await client.pools({ minVolume: 0, limit: 200 })).items)).not.toContain(
      quiet.pool.id,
    )
    expect((await client.pools({ dex: '' })).total).toBe(bundle.pools.length)
  })

  it('filters by rating like the API and sorts the unrated pools after the rated ones', async () => {
    const client = createStaticClient(BASE)
    const rated = await client.pools({ rated: true, limit: 200 })
    const unrated = await client.pools({ rated: false, limit: 200 })
    expect(rated.total + unrated.total).toBe(BASE.pools.length)
    expect(unrated.total).toBe(3)
    expect(rated.items.every((p) => p.health.rated)).toBe(true)
    expect(unrated.items.every((p) => !p.health.rated && p.health.grade === null)).toBe(true)
    const both = await client.pools({ limit: 200 })
    expect(ids(both.items.slice(rated.total))).toEqual(ids(unrated.items))
    const asc = await client.pools({ dir: 'asc', limit: 200 })
    expect(ids(asc.items.slice(rated.total)).sort()).toEqual(ids(unrated.items).sort())
    // true and false in any case; anything else is the API's 400
    expect((await client.pools({ rated: ' TRUE ' as never })).total).toBe(rated.total)
    await expect(client.pools({ rated: 'maybe' as never })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('rated'),
    })
  })

  it('matches q against symbols, names and addresses, pool addresses and v4 pool ids', async () => {
    const client = createStaticClient(BASE)
    const symbol = async (q: string) => (await client.pools({ q, limit: 200 })).items
    const weth = await symbol('  wEtH ')
    expect(weth.length).toBeGreaterThan(0)
    expect(weth.every((p) => [p.pool.token0.symbol, p.pool.token1.symbol].includes('WETH'))).toBe(
      true,
    )

    const usdc = BASE.pools[0]?.pool.token1
    if (usdc?.symbol !== 'USDC') throw new Error('expected WETH/USDC first')
    const byAddress = await symbol(usdc.address.slice(0, 12).toUpperCase())
    expect(byAddress.length).toBe(
      BASE.pools.filter((p) => p.pool.token0.symbol === 'USDC' || p.pool.token1.symbol === 'USDC')
        .length,
    )

    const v4 = BASE.pools.find((p) => p.pool.poolId !== null)
    const v3 = BASE.pools.find((p) => p.pool.address !== null)
    if (!v4?.pool.poolId || !v3?.pool.address) throw new Error('fixture lacks v3/v4 pools')
    expect(ids(await symbol(v4.pool.poolId.slice(2, 14)))).toEqual([v4.pool.id])
    expect(ids(await symbol(v3.pool.address.slice(-10)))).toEqual([v3.pool.id])

    // A token's name and the pair as written ("WETH / USDC") match too; the dex does not.
    const name = BASE.pools[0]?.pool.token0.name ?? ''
    expect(name.length).toBeGreaterThan(4)
    expect(ids(await symbol(name))).toContain(BASE.pools[0]?.pool.id)
    expect(ids(await symbol('WETH / USDC'))).toContain(BASE.pools[0]?.pool.id)
    expect(await symbol('uniswap')).toHaveLength(0)
    expect(await symbol('WETH / nothere')).toHaveLength(0)
  })

  it('pages with limit and offset, default 50, at most 200', async () => {
    const client = createStaticClient(fresh())
    const all = await client.pools({ limit: 200 })
    const window = await client.pools({ limit: 3, offset: 2 })
    expect(ids(window.items)).toEqual(ids(all.items).slice(2, 5))
    expect(window.total).toBe(all.total)
    expect((await client.pools({ offset: 1000 })).items).toEqual([])

    const big = createStaticClient(inflated(260))
    expect((await big.pools()).items).toHaveLength(50)
    expect((await big.pools({ limit: 200 })).items).toHaveLength(200)
    expect((await big.pools({ limit: 200, offset: 200 })).items).toHaveLength(60)
    expect((await big.pools()).total).toBe(260)
  })
})

describe('static client: gaps', () => {
  it('serves the default feed: best gap score first, ties by turnover then id, the floor echoed', async () => {
    const client = createStaticClient(BASE)
    const res = await client.gaps()
    expect(res.minVolumeUsd).toBe(10_000)
    expect(res.items.map((g) => g.pool.pool.id)).toEqual(
      [...BASE.gaps]
        .sort(
          (a, b) =>
            (b.gap.gapScore ?? 0) - (a.gap.gapScore ?? 0) ||
            (b.gap.turnoverRatio ?? -1) - (a.gap.turnoverRatio ?? -1) ||
            byId(a.pool.pool.id, b.pool.pool.id),
        )
        .map((g) => g.pool.pool.id),
    )
    const paged = await client.gaps({ limit: 2, offset: 1 })
    expect(paged.items.map((g) => g.pool.pool.id)).toEqual(
      res.items.slice(1, 3).map((g) => g.pool.pool.id),
    )
    // Both counts cover the whole feed on every page, like the API's.
    const meaningful = BASE.gaps.filter((g) => (g.gap.turnoverRatio ?? 0) >= 3).length
    expect(meaningful).toBeGreaterThan(1)
    for (const page of [res, paged, await client.gaps({ limit: 1, offset: 50 })]) {
      expect(page.total).toBe(BASE.gaps.length)
      expect(page.meaningful).toBe(meaningful)
    }
  })

  it('applies a higher floor to the feed and a lower one from the scored pools', async () => {
    const bundle = fresh()
    const template = bundle.pools[0]
    if (!template) throw new Error('empty bundle')
    const id = 'aerodrome-v2:0x00000000000000000000000000000000000000aa'
    const small: PoolSummary = {
      ...structuredClone(template),
      pool: { ...template.pool, id },
      volume24hUsd: 5_000,
      gapScore: 99,
    }
    bundle.pools.push(small)
    const detail = structuredClone(bundle.poolDetails[template.pool.id])
    if (!detail?.gap) throw new Error('template has no gap metrics')
    bundle.poolDetails[id] = {
      ...detail,
      pool: small.pool,
      gap: { volume24hUsd: 5_000, depth2Usd: 50, turnoverRatio: 100, gapScore: 99 },
    }
    const client = createStaticClient(bundle)

    const high = await client.gaps({ minVolume: 20_000_000, limit: 200 })
    expect(high.minVolumeUsd).toBe(20_000_000)
    expect(high.items.length).toBeGreaterThan(0)
    expect(high.items.every((g) => (g.pool.volume24hUsd ?? 0) >= 20_000_000)).toBe(true)

    expect((await client.gaps({ limit: 200 })).items.map((g) => g.pool.pool.id)).not.toContain(id)
    const low = await client.gaps({ minVolume: 1_000, limit: 200 })
    expect(low.items[0]?.pool.pool.id).toBe(id)
    expect(low.items[0]?.gap).toEqual({
      volume24hUsd: 5_000,
      depth2Usd: 50,
      turnoverRatio: 100,
      gapScore: 99,
    })
    // the feed's pools plus the scored pools with a gap score between $1K and $10K of volume
    const eligible = BASE.pools.filter((p) => p.gapScore !== null && (p.volume24hUsd ?? 0) >= 1_000)
    expect(low.items).toHaveLength(eligible.length + 1)
  })
})

describe('static client: tokens', () => {
  const usdc = BASE.pools[0]?.pool.token1.address ?? ''

  it('normalises the address and sorts the token pools like the API (default depth desc)', async () => {
    const client = createStaticClient(BASE)
    const res = await client.token(`  ${usdc.toUpperCase().replace('0X', '0x')} `)
    const detail = BASE.tokens[usdc]
    if (!detail) throw new Error('USDC missing from the bundle')
    expect(res.token).toEqual(detail.token)
    expect(res.total).toBe(detail.total)
    expect(res.poolCount).toBe(detail.poolCount)
    expect(ids(res.pools)).toEqual(expectedOrder(detail.pools, (p) => p.depth2Usd, 'desc'))

    const byVolume = await client.token(usdc, { sort: 'volume', dir: 'asc', limit: 2, offset: 1 })
    expect(ids(byVolume.pools)).toEqual(
      expectedOrder(detail.pools, (p) => p.volume24hUsd, 'asc').slice(1, 3),
    )
    expect(byVolume.total).toBe(detail.total)
    // The token's depth is the exported total over all its pools, whatever the page.
    expect(detail.depth2UsdTotal).toBeGreaterThan(0)
    expect(byVolume.depth2UsdTotal).toBe(detail.depth2UsdTotal)
    expect(byVolume.depthKnownPools).toBe(detail.depthKnownPools)
    const bySpread = await client.token(usdc, { sort: 'spread', dir: 'asc', limit: 200 })
    expect(ids(bySpread.pools)).toEqual(expectedOrder(detail.pools, (p) => p.spread10kBps, 'asc'))
  })
})

describe('static client: scorecards', () => {
  it('filters by exact pool id and by active, keeping the API order', async () => {
    const bundle = fresh()
    const [first, second] = bundle.scorecards
    if (!first || !second) throw new Error('expected two scorecards')
    second.mandate.active = false
    const client = createStaticClient(bundle)
    const all = await client.scorecards()
    expect(all.items.map((s) => s.mandate.id)).toEqual([first.mandate.id, second.mandate.id])
    expect((await client.scorecards({ active: true })).items.map((s) => s.mandate.id)).toEqual([
      first.mandate.id,
    ])
    expect((await client.scorecards({ active: false })).items.map((s) => s.mandate.id)).toEqual([
      second.mandate.id,
    ])
    const byPool = await client.scorecards({ pool: first.mandate.poolId })
    expect(byPool.items.map((s) => s.mandate.id)).toEqual([first.mandate.id])
    expect((await client.scorecards({ pool: first.mandate.poolId.slice(0, -1) })).items).toEqual([])
  })

  it('serves details, the newest samples within the limit and the badge text', async () => {
    const client = createStaticClient(BASE)
    const id = BASE.scorecards[0]?.mandate.id ?? ''
    expect(await client.scorecard(id)).toEqual(BASE.scorecardDetails[id])
    const week = BASE.samples[id]?.['7d']
    if (!week) throw new Error('no 7d samples')
    expect(await client.scorecardSamples(id)).toEqual(week)
    const newest = await client.scorecardSamples(id, { window: '7d', limit: 3 })
    expect(newest.points).toEqual(week.points.slice(-3))
    expect([newest.from, newest.to]).toEqual([week.from, week.to])
    expect(await client.scorecardSamples(id, { window: '30d' })).toEqual(BASE.samples[id]?.['30d'])
    expect(await client.badge(id)).toBe(BASE.badges[id])
  })
})

describe('static client: ±2 % depth per side', () => {
  /** Every PoolSummary the client serves: pools, the gaps feed, token pools and scorecards. */
  async function served(bundle: StaticBundle): Promise<PoolSummary[]> {
    const client = createStaticClient(bundle)
    const out = [...(await client.pools({ limit: 200 })).items]
    out.push(...(await client.gaps({ limit: 200 })).items.map((gap) => gap.pool))
    for (const address of Object.keys(bundle.tokens)) {
      out.push(...(await client.token(address, { limit: 200 })).pools)
    }
    for (const { mandate } of bundle.scorecards) {
      const { pool } = await client.scorecard(mandate.id)
      if (pool) out.push(pool)
    }
    return out
  }

  it('serves the exported depth2UpUsd and depth2DownUsd on every PoolSummary', async () => {
    const listed = new Map(BASE.pools.map((item) => [item.pool.id, item]))
    const items = await served(BASE)
    expect(items.length).toBeGreaterThan(BASE.pools.length)
    for (const item of items) {
      const row = listed.get(item.pool.id)
      // the buy side of a pool whose token1 has no USD price is null
      expect(typeof item.depth2UpUsd, item.pool.id).toBe(
        row?.health.unratedReason === 'unpriced' ? 'object' : 'number',
      )
      expect(typeof item.depth2DownUsd, item.pool.id).toBe('number')
      expect([item.depth2UpUsd, item.depth2DownUsd]).toEqual([row?.depth2UpUsd, row?.depth2DownUsd])
    }
  })

  it('keeps an unknown side null, never 0, on every route', async () => {
    const bundle = fresh()
    const unpriced = (item: PoolSummary) => {
      item.depth2DownUsd = null
    }
    bundle.pools.forEach(unpriced)
    for (const gap of bundle.gaps) unpriced(gap.pool)
    for (const token of Object.values(bundle.tokens)) token.pools.forEach(unpriced)
    for (const detail of Object.values(bundle.scorecardDetails))
      if (detail.pool) unpriced(detail.pool)
    const items = await served(bundle)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.depth2DownUsd, item.pool.id).toBeNull()
      if (item.health.unratedReason !== 'unpriced') {
        expect(item.depth2UpUsd, item.pool.id).toBeGreaterThan(0)
      }
    }
  })
})
