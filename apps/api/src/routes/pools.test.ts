import { computeHealthScore, computePersistence } from '@depthwatch/core'
import { type Database, snapshotSummaryFields } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { HISTORY_CACHE_CONTROL } from '../caching.js'
import type {
  ErrorResponse,
  HistoryResponse,
  PoolDetail,
  PoolSummary,
  PoolsResponse,
} from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'

async function list(app: Hono, query = ''): Promise<PoolsResponse> {
  const res = await app.request(`/api/pools${query}`)
  expect(res.status).toBe(200)
  return (await res.json()) as PoolsResponse
}

const ids = (body: PoolsResponse) => body.items.map((item) => item.pool.id)

describe('GET /api/pools', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  it('lists scored pools by health desc with the total', async () => {
    const body = await list(app)
    const p = seed.pools
    // rated pools by health, then the unrated ones (48 and 22), which never rank among them
    expect(ids(body)).toEqual([
      p.wethUsdcV3.id,
      p.wethAeroSlip.id,
      p.aeroUsdcV2.id,
      p.wethDegenV4.id,
      p.aeroUsdcSlip.id,
      p.brettToshiV3.id,
    ])
    expect(body.total).toBe(6)
    expect(ids(body)).not.toContain(p.usdcDegenV3.id)
  })

  it('shapes PoolSummary per DESIGN.md', async () => {
    const body = await list(app, '?limit=1')
    const item = body.items[0] as PoolSummary
    expect(item).toEqual({
      pool: expect.objectContaining({
        id: seed.pools.wethUsdcV3.id,
        dex: 'uniswap-v3',
        createdAtBlock: '2000000',
        token0: expect.objectContaining({ symbol: 'WETH', decimals: 18 }),
        token1: expect.objectContaining({ symbol: 'USDC', decimals: 6 }),
      }),
      price: 3000.25,
      tvlUsd: 12_500_000,
      depth2Usd: 1_000_000,
      depth2UpUsd: 500_000,
      depth2DownUsd: 500_000,
      spread10kBps: 8,
      priceDeviationBps: 0,
      staleQuote: false,
      health: {
        total: 85,
        grade: 'A',
        rated: true,
        unratedReason: null,
        concentrationBasis: 'owners',
      },
      gapScore: expect.closeTo(15.05, 2),
      volume24hUsd: 2_000_000,
      ownerTop1Share: 0.32,
      updatedAt: seed.now,
    })
  })

  it('returns nulls for unmeasured metrics', async () => {
    const body = await list(app, '?sort=health&dir=asc&rated=false&limit=1')
    const item = body.items[0] as PoolSummary
    expect(item.pool.id).toBe(seed.pools.brettToshiV3.id)
    expect(item.health).toEqual({
      total: 22,
      grade: null,
      rated: false,
      unratedReason: 'unpriced',
      concentrationBasis: 'owners',
    })
    expect(item.depth2Usd).toBeNull()
    expect(item.depth2UpUsd).toBeNull()
    expect(item.depth2DownUsd).toBeNull()
    expect(item.spread10kBps).toBeNull()
    expect(item.gapScore).toBeNull()
    expect(item.volume24hUsd).toBeNull()
    expect(item.tvlUsd).toBeNull()
    expect(item.price).toBe(1.5)
  })

  it.each([
    ['depth', 'desc', ['wethUsdcV3', 'wethAeroSlip', 'aeroUsdcV2', 'wethDegenV4', 'aeroUsdcSlip']],
    ['depth', 'asc', ['aeroUsdcSlip', 'wethDegenV4', 'aeroUsdcV2', 'wethAeroSlip', 'wethUsdcV3']],
    ['volume', 'desc', ['wethUsdcV3', 'aeroUsdcV2', 'wethDegenV4', 'aeroUsdcSlip', 'wethAeroSlip']],
    ['gap', 'desc', ['wethDegenV4', 'aeroUsdcV2', 'aeroUsdcSlip', 'wethUsdcV3', 'wethAeroSlip']],
    ['tvl', 'desc', ['wethUsdcV3', 'aeroUsdcV2', 'wethAeroSlip', 'wethDegenV4', 'aeroUsdcSlip']],
    // unrated pools (brett 22, aeroUsdcSlip 48) follow the rated ones in both directions
    [
      'health',
      'asc',
      ['wethDegenV4', 'aeroUsdcV2', 'wethAeroSlip', 'wethUsdcV3', 'brettToshiV3', 'aeroUsdcSlip'],
    ],
  ] as const)('sorts by %s %s with nulls last', async (sort, dir, expected) => {
    const body = await list(app, `?sort=${sort}&dir=${dir}`)
    const expectedIds = expected.map((key) => seed.pools[key].id)
    expect(ids(body).slice(0, expectedIds.length)).toEqual(expectedIds)
    if (sort !== 'health') expect(ids(body).at(-1)).toBe(seed.pools.brettToshiV3.id)
    expect(body.total).toBe(6)
  })

  it('filters by rating: rated=true keeps the graded pools, rated=false the others', async () => {
    const p = seed.pools
    const rated = await list(app, '?rated=true')
    expect(ids(rated)).toEqual([
      p.wethUsdcV3.id,
      p.wethAeroSlip.id,
      p.aeroUsdcV2.id,
      p.wethDegenV4.id,
    ])
    expect(rated.total).toBe(4)
    for (const item of rated.items) {
      expect(item.health.rated).toBe(true)
      expect(item.health.grade).not.toBeNull()
      expect(item.health.unratedReason).toBeNull()
    }
    const unrated = await list(app, '?rated=false')
    expect(ids(unrated)).toEqual([p.aeroUsdcSlip.id, p.brettToshiV3.id])
    expect(unrated.total).toBe(2)
    expect(unrated.items.map((item) => item.health)).toEqual([
      { total: 48, grade: null, rated: false, unratedReason: 'thin', concentrationBasis: 'owners' },
      {
        total: 22,
        grade: null,
        rated: false,
        unratedReason: 'unpriced',
        concentrationBasis: 'owners',
      },
    ])
    // the basis says what the concentration points stand on: owners, the range HHI, or neutral
    const basis = new Map((await list(app, '')).items.map((i) => [i.pool.id, i.health]))
    expect(basis.get(p.wethDegenV4.id)?.concentrationBasis).toBe('ranges')
    expect(basis.get(p.aeroUsdcV2.id)?.concentrationBasis).toBe('neutral')
    // unrated pools keep ranking in every other sort and stay in the other lists
    const byDepth = await list(app, '?sort=depth&rated=false')
    expect(ids(byDepth)).toEqual([p.aeroUsdcSlip.id, p.brettToshiV3.id])
    expect((await list(app, '?rated=')).total).toBe(6)
    const bad = await app.request('/api/pools?rated=maybe')
    expect(bad.status).toBe(400)
  })

  it('filters by dex', async () => {
    const body = await list(app, '?dex=aerodrome-slipstream')
    expect(ids(body)).toEqual([seed.pools.wethAeroSlip.id, seed.pools.aeroUsdcSlip.id])
    expect(body.total).toBe(2)
  })

  it('filters by a case-insensitive token symbol or address', async () => {
    const bySymbol = await list(app, '?q=AeRo')
    expect(ids(bySymbol).sort()).toEqual(
      [seed.pools.aeroUsdcV2.id, seed.pools.wethAeroSlip.id, seed.pools.aeroUsdcSlip.id].sort(),
    )
    const byAddress = await list(app, `?q=${seed.tokens.DEGEN.address.slice(2, 12)}`)
    expect(ids(byAddress)).toEqual([seed.pools.wethDegenV4.id])
    const none = await list(app, '?q=DOGE')
    expect(none).toEqual({ items: [], total: 0 })
  })

  it('filters by minimum volume (unknown volume excluded)', async () => {
    const body = await list(app, '?minVolume=10000&sort=volume')
    expect(ids(body)).toEqual([
      seed.pools.wethUsdcV3.id,
      seed.pools.aeroUsdcV2.id,
      seed.pools.wethDegenV4.id,
      seed.pools.aeroUsdcSlip.id,
    ])
    expect(body.total).toBe(4)
  })

  it('pages with limit and offset while total stays the same', async () => {
    const all = await list(app)
    const page1 = await list(app, '?limit=2')
    const page2 = await list(app, '?limit=2&offset=2')
    const page3 = await list(app, '?limit=2&offset=4')
    const tail = await list(app, '?limit=2&offset=6')
    expect([...ids(page1), ...ids(page2), ...ids(page3)]).toEqual(ids(all))
    expect(page2.total).toBe(6)
    expect(tail).toEqual({ items: [], total: 6 })
  })

  it('treats empty parameters as defaults', async () => {
    const body = await list(app, '?sort=&dir=&dex=&q=&minVolume=&limit=&offset=')
    expect(body).toEqual(await list(app))
  })

  it.each([
    '?sort=liquidity',
    '?dir=sideways',
    '?dex=sushiswap',
    '?limit=0',
    '?limit=201',
    '?limit=ten',
    '?offset=-1',
    '?minVolume=-1',
    `?q=${'a'.repeat(201)}`,
  ])('rejects %s with a 400 message', async (query) => {
    const res = await app.request(`/api/pools${query}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ErrorResponse
    expect(body.error).toMatch(/^invalid query: /)
    expect(body.issues?.length).toBeGreaterThan(0)
  })

  it('caps limit at 200', async () => {
    expect((await app.request('/api/pools?limit=200')).status).toBe(200)
    expect((await app.request('/api/pools?limit=201')).status).toBe(400)
  })
})

describe('GET /api/pools/:id', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  it('returns the pool, latest snapshot and score', async () => {
    const id = seed.pools.wethUsdcV3.id
    const res = await app.request(`/api/pools/${id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as PoolDetail
    const score = seed.scores.get(id)
    const latest = seed.snapshots.get(id)?.at(-1)
    expect(body.pool.id).toBe(id)
    expect(body.tracked).toBe(true)
    expect(body.score).toEqual(score?.health)
    expect(body.gap).toEqual(score?.gap)
    expect(body.persistence24h).toEqual(score?.persistence24h)
    expect(body.persistence7d).toEqual(score?.persistence7d)
    expect(body.volume24hUsd).toBe(2_000_000)
    expect(body.scoredAt).toBe(seed.now)
    expect(body.latest?.timestamp).toBe(latest?.timestamp)
    expect(body.latest?.price).toBe(3000.25)
    expect(body.latest?.depthUsd.find((l) => l.pct === 2)?.totalUsd).toBe(1_000_000)
    expect(body.latest?.spreads.find((s) => s.notionalUsd === 10_000)?.spreadBps).toBe(8)
    expect(body.latest?.concentration?.owners?.top1Share).toBe(0.32)
  })

  it('serves a spread stored before the price impact cap as infeasible, not as 1e24 bps', async () => {
    const id = seed.pools.wethUsdcV3.id
    // The pool as the first live run stored it: the dust-pool spread, uncapped, in the JSON and
    // in the denormalised column that the pools list used to read.
    const legacy = [
      {
        notionalUsd: 1_000,
        spreadBps: 4,
        feasible: true,
        buyAvgPrice: 3000.5,
        sellAvgPrice: 2999.5,
      },
      {
        notionalUsd: 10_000,
        spreadBps: 1.449e24,
        feasible: true,
        buyAvgPrice: 4.3e27,
        sellAvgPrice: 1.2e-21,
      },
    ]
    db.raw
      .prepare('UPDATE snapshots SET spreads_json = ?, spread10k_bps = ? WHERE pool_id = ?')
      .run(JSON.stringify(legacy), 1.449e24, id)

    const detail = (await (await app.request(`/api/pools/${id}`)).json()) as PoolDetail
    expect(detail.latest?.spreads).toEqual([
      legacy[0],
      {
        notionalUsd: 10_000,
        spreadBps: null,
        feasible: false,
        buyAvgPrice: null,
        sellAvgPrice: null,
      },
    ])
    const item = (await list(app)).items.find((entry) => entry.pool.id === id)
    expect(item?.spread10kBps).toBeNull()
    const history = (await (
      await app.request(`/api/pools/${id}/history`)
    ).json()) as HistoryResponse
    expect(history.points.length).toBeGreaterThan(0)
    expect(history.points.every((point) => point.spread10kBps === null)).toBe(true)
    // the other pools keep their spread
    expect(
      (await list(app)).items.find((entry) => entry.pool.id === seed.pools.aeroUsdcV2.id)
        ?.spread10kBps,
    ).not.toBeNull()
  })

  it('accepts ids with a colon, raw or percent-encoded', async () => {
    const id = seed.pools.wethDegenV4.id
    for (const path of [`/api/pools/${id}`, `/api/pools/${encodeURIComponent(id)}`]) {
      const res = await app.request(path)
      expect(res.status, path).toBe(200)
      expect(((await res.json()) as PoolDetail).pool.id).toBe(id)
    }
  })

  it('returns nulls, volume included, for a discovered-only pool', async () => {
    const res = await app.request(`/api/pools/${seed.pools.usdcDegenV3.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as PoolDetail
    expect(body.tracked).toBe(false)
    expect(body.latest).toBeNull()
    expect(body.score).toBeNull()
    expect(body.gap).toBeNull()
    expect(body.persistence24h).toBeNull()
    expect(body.persistence7d).toBeNull()
    expect(body.scoredAt).toBeNull()
    // The pool has stored hourly buckets, but 24 h volume comes from the score (core) only: an
    // unscored pool's buckets may be stale or cut short, so the route does not sum them itself.
    expect(db.volume.series(seed.pools.usdcDegenV3.id, 0).length).toBeGreaterThan(0)
    expect(body.volume24hUsd).toBeNull()
  })

  it('404s for unknown pools', async () => {
    for (const id of ['uniswap-v3:0xdead', 'nope', '0x1']) {
      const res = await app.request(`/api/pools/${id}`)
      expect(res.status, id).toBe(404)
      expect(await res.json()).toEqual({ error: 'pool not found' })
    }
  })
})

describe('GET /api/pools/:id/history', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  async function history(id: string, query = ''): Promise<HistoryResponse> {
    const res = await app.request(`/api/pools/${id}/history${query}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(HISTORY_CACHE_CONTROL)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    return (await res.json()) as HistoryResponse
  }

  it('defaults to the 24 h window ending at the newest snapshot', async () => {
    const id = seed.pools.wethUsdcV3.id
    const body = await history(id)
    expect(body.window).toBe('24h')
    expect(body.to).toBe(seed.now)
    expect(body.from).toBe(seed.now - 86_400)
    expect(body.points).toHaveLength(13) // every 2 h, both ends inclusive
    expect(body.points.map((p) => p.timestamp)).toEqual(
      seed.snapshots
        .get(id)
        ?.map((s) => s.timestamp)
        .filter((ts) => ts >= seed.now - 86_400),
    )
  })

  it('serves 7 d and keeps points ascending', async () => {
    const body = await history(seed.pools.wethUsdcV3.id, '?window=7d')
    expect(body.window).toBe('7d')
    expect(body.from).toBe(seed.now - 7 * 86_400)
    expect(body.points).toHaveLength(85)
    for (let i = 1; i < body.points.length; i++) {
      expect(body.points[i]!.timestamp).toBeGreaterThan(body.points[i - 1]!.timestamp)
    }
  })

  it('shapes points from the snapshot summary fields plus a recomputed health', async () => {
    const id = seed.pools.wethUsdcV3.id
    const body = await history(id)
    const last = body.points.at(-1)
    const samples = (seed.snapshots.get(id) ?? []).map((snapshot) => ({
      timestamp: snapshot.timestamp,
      depthUsd: snapshotSummaryFields(snapshot).depth2Usd,
    }))
    const expectedHealth = computeHealthScore({
      depth2UpUsd: 500_000,
      depth2DownUsd: 500_000,
      spread10kBps: 8,
      ownerTop1Share: 0.32,
      ownerCoverage: 0.96,
      rangeHhi: 0.28,
      poolKind: 'concentrated',
      persistence: computePersistence(samples, 24, seed.now),
    }).total
    expect(expectedHealth).toBeGreaterThan(80)
    expect(last).toEqual({
      timestamp: seed.now,
      price: 3000.25,
      depth2Usd: 1_000_000,
      spread10kBps: 8,
      tvlUsd: 12_500_000,
      health: expectedHealth,
      // The fee the snapshot's depth and spread used, as stored with it.
      feePips: 500,
    })
    expect(Object.keys(last ?? {}).sort()).toEqual(
      ['depth2Usd', 'feePips', 'health', 'price', 'spread10kBps', 'timestamp', 'tvlUsd'].sort(),
    )
    // The first point of the window has a full trailing 24 h of snapshots behind it (lead-in),
    // so its persistence is not neutral either.
    for (const point of body.points) expect(point.health).toBeGreaterThan(80)
  })

  it('reports nulls for unpriced pools and scores them from what is known', async () => {
    const body = await history(seed.pools.brettToshiV3.id)
    expect(body.points).toHaveLength(3)
    expect(body.points[0]).toMatchObject({ depth2Usd: null, spread10kBps: null, tvlUsd: null })
    expect(body.points[0]?.price).toBeGreaterThan(0)
    // depth 0 + spread 0 + concentration 20·(1−0.8) + neutral persistence 10
    expect(body.points[0]?.health).toBe(14)
  })

  it('accepts a percent-encoded id', async () => {
    const id = seed.pools.wethDegenV4.id
    const res = await app.request(`/api/pools/${encodeURIComponent(id)}/history?window=7d`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as HistoryResponse
    expect(body.window).toBe('7d')
    expect(body.points).toHaveLength(3)
  })

  it('is empty for a pool without snapshots', async () => {
    const body = await history(seed.pools.usdcDegenV3.id)
    expect(body.points).toEqual([])
    expect(body.to).toBe(seed.now)
  })

  it('validates the window and 404s unknown pools', async () => {
    const bad = await app.request(`/api/pools/${seed.pools.wethUsdcV3.id}/history?window=30d`)
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as ErrorResponse).error).toContain('window: ')
    const missing = await app.request('/api/pools/uniswap-v3:0xnope/history')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'pool not found' })
  })
})
