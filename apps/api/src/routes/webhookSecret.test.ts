/**
 * A mandate's alert webhook URL is a bearer secret (a Slack or Discord style URL lets anyone post
 * as its owner). It is stored and used by alert delivery, and nothing else may carry it: this test
 * registers a mandate whose URL holds a unique canary through the real registration route, then
 * reads every GET route `createApp` registers (and the answers of `POST /api/mm` itself) and
 * fails when any part of the URL appears in a body or a header.
 */

import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { ScorecardsResponse } from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'
import { seedStocks } from '../testing/stocks.js'

const ADMIN_TOKEN = 'test-admin-token'
const CANARY = 'canary-9f3a7c1e5d42b8'
const HOST = 'leak-canary.example.net'
const PATH = '/services/T0CANARY/B0CANARY'
const WEBHOOK_URL = `https://${HOST}${PATH}/${CANARY}?token=${CANARY}`
/** Every piece of the URL that must stay out of a response. */
const PIECES = [WEBHOOK_URL, CANARY, HOST, PATH, encodeURIComponent(WEBHOOK_URL)]

const NEW_ID = 'canary-weth-usdc'

function leaks(text: string): string[] {
  return PIECES.filter((piece) => text.includes(piece))
}

/** Everything a response sends: status line, every header and the body. */
async function everything(res: Response): Promise<string> {
  const headers = [...res.headers].map(([name, value]) => `${name}: ${value}`).join('\n')
  return `${res.status}\n${headers}\n${await res.text()}`
}

async function post(app: Hono, body: unknown): Promise<Response> {
  return await app.request('/api/mm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify(body),
  })
}

/** The values of the parameter of `path`, by the resource its prefix names. */
function parameterValues(path: string, db: Database, seed: Seed): string[] | undefined {
  if (path.startsWith('/api/pools/')) return Object.values(seed.pools).map((pool) => pool.id)
  if (path.startsWith('/api/tokens/'))
    return Object.values(seed.tokens).map((token) => token.address)
  if (path.startsWith('/api/mm/')) return db.mandates.list().map((mandate) => mandate.id)
  if (path.startsWith('/api/stocks/')) return db.stocks.list().map((stock) => stock.token.address)
  return undefined
}

/** Query strings worth reading in addition to the bare route. */
function queryVariants(path: string, seed: Seed): string[] {
  if (path === '/api/mm')
    return [
      '',
      '?active=true',
      '?active=false',
      `?pool=${encodeURIComponent(seed.pools.wethUsdcV3.id)}`,
    ]
  if (path === '/api/mm/:id/samples')
    return ['', '?window=24h', '?window=7d', '?window=30d&limit=5']
  return ['']
}

/** The concrete URLs of one registered GET route; throws for a parameter with no known values. */
function expand(path: string, db: Database, seed: Seed): string[] {
  const parameter = /:(\w+)/.exec(path)?.[1]
  let urls = [path]
  if (parameter !== undefined) {
    const values = parameterValues(path, db, seed)
    if (!values) throw new Error(`no test values for the parameter of GET ${path}`)
    urls = values.map((value) => path.replace(`:${parameter}`, encodeURIComponent(value)))
  }
  return urls.flatMap((url) => queryVariants(path, seed).map((query) => `${url}${query}`))
}

describe('the alert webhook URL never leaves the database', () => {
  let db: Database
  let seed: Seed
  let app: Hono

  beforeEach(async () => {
    ;({ db, seed } = createSeededDatabase())
    // Stocks too, so that the stock routes are read with stocks to answer about.
    seedStocks(db, seed)
    app = createApp(db, { now: () => seed.now, adminToken: ADMIN_TOKEN })
  })
  afterEach(() => db.close())

  /** Registers two mandates with the canary URL: a new one, and the seeded one that has samples. */
  async function registerWithCanary(): Promise<Response[]> {
    const breached = seed.mandates.aeroBreached
    return [
      await post(app, {
        id: NEW_ID,
        name: 'Canary / WETH-USDC',
        poolId: seed.pools.wethUsdcV3.id,
        marketMaker: 'Canary Markets',
        addresses: ['0xAbCdEf0000000000000000000000000000000001'],
        kpis: { minDepthUsd: 50_000 },
        alertWebhookUrl: WEBHOOK_URL,
        alertAfterSamples: 2,
      }),
      await post(app, {
        id: breached.id,
        name: breached.name,
        poolId: breached.poolId,
        marketMaker: breached.marketMaker,
        addresses: breached.addresses,
        kpis: breached.kpis,
        alertWebhookUrl: WEBHOOK_URL,
        notes: breached.notes,
      }),
    ]
  }

  it('is stored by the real registration route (the control: the canary is in the database)', async () => {
    const responses = await registerWithCanary()
    expect(responses.map((res) => res.status)).toEqual([201, 201])
    expect(db.mandates.get(NEW_ID)?.alertWebhookUrl).toBe(WEBHOOK_URL)
    expect(db.mandates.get(seed.mandates.aeroBreached.id)?.alertWebhookUrl).toBe(WEBHOOK_URL)
    // The detector is not vacuous: it does see the URL in the stored row.
    expect(leaks(JSON.stringify(db.mandates.get(NEW_ID)))).toContain(CANARY)
  })

  it('is absent from the POST /api/mm answers, which say only that a webhook is set', async () => {
    const responses = await registerWithCanary()
    for (const res of responses) {
      const text = await everything(res.clone())
      expect(leaks(text), 'POST /api/mm').toEqual([])
      const body = (await res.json()) as { mandate: Record<string, unknown> }
      expect(body.mandate.alertWebhookConfigured).toBe(true)
      expect('alertWebhookUrl' in body.mandate).toBe(false)
    }
  })

  it('is absent from the answers to rejected registrations', async () => {
    const valid = {
      id: NEW_ID,
      name: 'Canary',
      poolId: seed.pools.wethUsdcV3.id,
      marketMaker: 'Canary Markets',
      addresses: ['0xAbCdEf0000000000000000000000000000000001'],
    }
    const badKpis = await post(app, {
      ...valid,
      kpis: { minDepthUsd: -1 },
      alertWebhookUrl: WEBHOOK_URL,
    })
    expect(badKpis.status).toBe(400)
    expect(leaks(await everything(badKpis))).toEqual([])
    const badScheme = await post(app, {
      ...valid,
      kpis: { minDepthUsd: 1 },
      alertWebhookUrl: WEBHOOK_URL.replace('https:', 'ftp:'),
    })
    expect(badScheme.status).toBe(400)
    expect(leaks(await everything(badScheme))).toEqual([])
  })

  it('is absent from every GET route createApp registers, bodies and headers', async () => {
    for (const res of await registerWithCanary()) expect(res.status).toBe(201)
    const getRoutes = [
      ...new Set(app.routes.filter((route) => route.method === 'GET').map((route) => route.path)),
    ]
    // The routes this test must reach, so that a renamed or dropped route fails here.
    expect(getRoutes).toEqual(
      expect.arrayContaining([
        '/api/mm',
        '/api/mm/:id',
        '/api/mm/:id/samples',
        '/api/mm/:id/badge.svg',
        '/api/pools/:id',
        '/api/pools/:id/history',
        '/api/tokens/:address',
        '/api/stocks',
        '/api/stocks/:token',
      ]),
    )
    let reads = 0
    for (const path of getRoutes) {
      for (const url of expand(path, db, seed)) {
        const res = await app.request(url)
        expect(res.status, `GET ${url}`).toBe(200)
        expect(leaks(await everything(res)), `GET ${url}`).toEqual([])
        reads++
      }
    }
    // Every mandate (the seeded two and the new one) was read through each /api/mm/:id route.
    expect(reads).toBeGreaterThan(getRoutes.length * 3)
  })

  it('reports the webhook as configured on the list and detail routes', async () => {
    for (const res of await registerWithCanary()) expect(res.status).toBe(201)
    const list = (await (await app.request('/api/mm')).json()) as ScorecardsResponse
    const flags = Object.fromEntries(
      list.items.map((item) => [item.mandate.id, item.mandate.alertWebhookConfigured]),
    )
    expect(flags).toEqual({
      [NEW_ID]: true,
      [seed.mandates.aeroBreached.id]: true,
      [seed.mandates.slipstreamOk.id]: false,
    })
    for (const item of list.items) expect('alertWebhookUrl' in item.mandate).toBe(false)
  })

  it('is absent from the GET answers for mandates of the pool they are registered on', async () => {
    for (const res of await registerWithCanary()) expect(res.status).toBe(201)
    const pool = encodeURIComponent(seed.pools.wethUsdcV3.id)
    for (const url of [
      `/api/pools/${pool}`,
      `/api/mm?pool=${pool}`,
      '/api/gaps',
      '/api/stats',
      '/api/health',
    ]) {
      const res = await app.request(url)
      expect(res.status, url).toBe(200)
      expect(leaks(await everything(res)), url).toEqual([])
    }
  })
})
