/**
 * `GET /api/pools?q=`: a pair written either way round ("AERO/USDC", "usdc aero"), every term
 * matching either token, the pool or the DEX (packages/db/src/repos/poolRow.ts).
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
    for (const q of ['AERO/USDC', 'AERO%20USDC', 'aero-usdc', 'usdc%20aero', 'USDC%3AAERO']) {
      const body = await list(app, `?q=${q}`)
      expect(ids(body).sort(), q).toEqual(pair)
      expect(body.total, q).toBe(2)
    }
  })

  it('needs every term, each in a token, the pool or the DEX', async () => {
    const p = seed.pools
    expect(ids(await list(app, '?q=usdc%20slipstream%20aero'))).toEqual([p.aeroUsdcSlip.id])
    expect(ids(await list(app, '?q=uniswap%20v3%20weth%20usdc'))).toEqual([p.wethUsdcV3.id])
    expect(await list(app, '?q=AERO%2FDOGE')).toEqual({ items: [], total: 0 })
  })

  it('treats a query of separators alone as no query', async () => {
    expect((await list(app, '?q=%2F')).total).toBe((await list(app)).total)
    expect((await list(app, '?q=%20-%20')).total).toBe((await list(app)).total)
  })
})
