/**
 * `GET /api/pools?q=`: a pair written either way round ("AERO/USDC", "usdc aero"), every term
 * matching either token or the pool, never the DEX; and a pasted pool id ("uniswap-v3:0x…", also
 * with "%3A" or as the pool's link) finding the pools on its DEX whose address or v4 pool id starts
 * with its hex (packages/db/src/repos/poolRow.ts).
 */
import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { PoolsResponse } from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'

async function list(app: Hono, query = ''): Promise<PoolsResponse> {
  const res = await app.request(`/api/pools${query}`)
  expect(res.status).toBe(200)
  return (await res.json()) as PoolsResponse
}

const ids = (body: PoolsResponse) => body.items.map((item) => item.pool.id)

describe('GET /api/pools?q=', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  it('finds a pair in either order, with any separator', async () => {
    const p = seed.pools
    const pair = [p.aeroUsdcV2.id, p.aeroUsdcSlip.id].sort()
    for (const q of [
      'AERO/USDC',
      'AERO%20USDC',
      'aero-usdc',
      'usdc%20aero',
      'USDC%3AAERO',
      'AERO%2C%20USDC',
    ]) {
      const body = await list(app, `?q=${q}`)
      expect(ids(body).sort(), q).toEqual(pair)
      expect(body.total, q).toBe(2)
    }
  })

  it('needs every term, each in a token or the pool; the DEX is its own filter', async () => {
    const p = seed.pools
    const slip = '?q=usdc%20aero&dex=aerodrome-slipstream'
    expect(ids(await list(app, slip))).toEqual([p.aeroUsdcSlip.id])
    // The DEX is not searched: "aero" is the AERO token, not the Aero or Aerodrome DEXes.
    expect(await list(app, '?q=usdc%20slipstream')).toEqual({ items: [], total: 0 })
    expect(await list(app, '?q=uniswap%20v3%20weth%20usdc')).toEqual({ items: [], total: 0 })
    expect(await list(app, '?q=AERO%2FDOGE')).toEqual({ items: [], total: 0 })
  })

  it('treats a query of separators alone as no query', async () => {
    expect((await list(app, '?q=%2F')).total).toBe((await list(app)).total)
    expect((await list(app, '?q=%20-%20')).total).toBe((await list(app)).total)
  })
})

describe('GET /api/pools?q=<pool id>', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  /** The pools `q` lists, sent as the client sends it (the query string encodes it). */
  const search = async (q: string) => list(app, `?q=${encodeURIComponent(q)}`)

  it('finds a pool from its full id, with the hex in any case', async () => {
    const { wethUsdcV3 } = seed.pools
    const address = wethUsdcV3.address ?? ''
    for (const q of [
      wethUsdcV3.id,
      `uniswap-v3:${address.toUpperCase()}`,
      `uniswap-v3 : ${address}`,
    ]) {
      const body = await search(q)
      expect(ids(body), q).toEqual([wethUsdcV3.id])
      expect(body.total, q).toBe(1)
    }
  })

  it('finds the pools on the DEX whose address starts with a hex prefix', async () => {
    const { wethUsdcV3, brettToshiV3 } = seed.pools
    // Every seed address starts with 0x00…10; only the scored Uniswap v3 pools are listed.
    const prefix = (wethUsdcV3.address ?? '').slice(0, 39)
    expect(ids(await search(`uniswap-v3:${prefix}`)).sort()).toEqual(
      [wethUsdcV3.id, brettToshiV3.id].sort(),
    )
  })

  it('finds a Uniswap v4 pool from its pool id or a prefix of it', async () => {
    const { wethDegenV4 } = seed.pools
    for (const q of [
      wethDegenV4.id,
      `uniswap-v4:${(wethDegenV4.poolId ?? '').toUpperCase()}`,
      'uniswap-v4:0x7A7A',
    ])
      expect(ids(await search(q)), q).toEqual([wethDegenV4.id])
  })

  it('reads the id as a pool link carries it: "%3A" for ":", or the whole link', async () => {
    const { wethUsdcV3, wethDegenV4 } = seed.pools
    const encoded = encodeURIComponent(wethUsdcV3.id)
    expect(encoded).toContain('%3A')
    expect(ids(await search(encoded))).toEqual([wethUsdcV3.id])
    const v4Link = `https://depthwatch.pages.dev/#/pools/${encodeURIComponent(wethDegenV4.id)}?window=7d`
    expect(v4Link.length).toBeGreaterThan(100)
    expect(ids(await search(v4Link))).toEqual([wethDegenV4.id])
    expect(ids(await search(`http://localhost:8787/pools/${encoded}`))).toEqual([wethUsdcV3.id])
  })

  it("finds nothing for the right DEX with another pool's hex, or the hex on another DEX", async () => {
    const { wethUsdcV3, aeroUsdcV2, wethDegenV4 } = seed.pools
    const empty = { items: [], total: 0 }
    expect(await search(`uniswap-v3:${aeroUsdcV2.address}`)).toEqual(empty)
    expect(await search(`uniswap-v3:${wethDegenV4.poolId}`)).toEqual(empty)
    expect(await search(`aerodrome-v2:${wethUsdcV3.address}`)).toEqual(empty)
    expect(await search(`aerodrome-slipstream:${wethUsdcV3.address}`)).toEqual(empty)
    const both = `?q=${encodeURIComponent(wethUsdcV3.id)}&dex=aerodrome-v2`
    expect(await list(app, both)).toEqual(empty)
  })

  it('keeps the term rule for an unknown DEX prefix, which never reads the DEX', async () => {
    const { wethUsdcV3 } = seed.pools
    const empty = { items: [], total: 0 }
    expect(await search(`sushiswap:${wethUsdcV3.address}`)).toEqual(empty)
    expect(await search(`uniswap-v5:${wethUsdcV3.address}`)).toEqual(empty)
    // "weth" is a token of the pool, and its address holds the hex
    expect(ids(await search(`weth:${wethUsdcV3.address}`))).toEqual([wethUsdcV3.id])
  })
})
