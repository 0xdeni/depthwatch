/**
 * The agent documents (`GET /AGENTS.md`, `/llms.txt`, `/openapi.json`): served with the right
 * content types and never shadowed by the dashboard's SPA fallback; `openapi.json` describes
 * exactly the GET routes `createApp` registers, and real responses of those routes conform to
 * the schemas it documents.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeStock } from '@depthwatch/core'
import { type Database, fixturePoolReference, IN_MEMORY, openDatabase } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { seedAeroTokens } from '../testing/aero.js'
import { collectRefs, resolvePointer, type Schema, validate } from '../testing/schema.js'
import {
  createSeededDatabase,
  SEED_MM_BREACHED_ID,
  SEED_MM_OK_ID,
  type Seed,
} from '../testing/seed.js'
import { seedStocks } from '../testing/stocks.js'
import { AGENT_DOCS, AGENT_DOCS_DIR, readAgentDoc } from './agentDocs.js'

interface Operation {
  responses: Record<string, { $ref?: string; content?: Record<string, { schema: Schema }> }>
}
interface OpenApiDoc {
  openapi: string
  info: { description: string }
  paths: Record<string, Record<string, Operation>>
}

const openapi = JSON.parse(readAgentDoc('openapi.json')) as OpenApiDoc

/** `METHOD /path` of every handler `createApp` registers (middleware entries are `ALL`). */
function registeredRoutes(app: Hono): string[] {
  const routes = app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`)
  return [...new Set(routes)].sort()
}

/** `METHOD /path` of every operation in openapi.json, with `{param}` written as Hono's `:param`. */
function documentedRoutes(doc: OpenApiDoc): string[] {
  const out: string[] = []
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of Object.keys(item)) {
      out.push(`${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`)
    }
  }
  return out.sort()
}

/** The documented JSON schema of the response `path` answers with `status`. */
function responseSchema(path: string, status: number): Schema {
  const template = Object.keys(openapi.paths).find((candidate) => {
    const source = candidate.replace(/[.]/g, '\\.').replace(/\{\w+\}/g, '[^/]+')
    return new RegExp(`^${source}$`).test(path)
  })
  if (template === undefined) throw new Error(`no documented path matches ${path}`)
  let response = openapi.paths[template]?.get?.responses[String(status)]
  if (response?.$ref !== undefined) response = resolvePointer(openapi, response.$ref) as never
  const schema = response?.content?.['application/json']?.schema
  if (schema === undefined) throw new Error(`no JSON schema documented for ${status} on ${path}`)
  return schema
}

async function conforms(app: Hono, path: string, status: number): Promise<string[]> {
  const res = await app.request(path)
  expect(res.status, path).toBe(status)
  return validate(openapi, responseSchema(path.split('?')[0] ?? path, status), await res.json())
}

describe('agent documents', () => {
  let db: Database
  let app: Hono

  beforeAll(() => {
    db = openDatabase(IN_MEMORY)
    app = createApp(db)
  })
  afterAll(() => db.close())

  it('AGENT_DOCS names exactly the files in src/agentDocs', () => {
    const files = readdirSync(fileURLToPath(AGENT_DOCS_DIR)).sort()
    expect(AGENT_DOCS.map((doc) => doc.file).sort()).toEqual(files)
  })

  it.each([
    ['/AGENTS.md', 'text/markdown; charset=utf-8'],
    ['/llms.txt', 'text/plain; charset=utf-8'],
    ['/openapi.json', 'application/json'],
  ])('GET %s answers %s with the file from src/agentDocs', async (path, contentType) => {
    const doc = AGENT_DOCS.find((d) => d.path === path)
    if (!doc) throw new Error(`${path} is not in AGENT_DOCS`)
    const res = await app.request(path)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(contentType)
    expect(await res.text()).toBe(readFileSync(new URL(doc.file, AGENT_DOCS_DIR), 'utf8'))

    const head = await app.request(path, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe(contentType)
  })

  describe('with the built dashboard mounted', () => {
    let dir: string
    let withStatic: Hono

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'depthwatch-agent-docs-'))
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>dashboard</title>')
      for (const doc of AGENT_DOCS) writeFileSync(join(dir, doc.file), 'stale copy')
      withStatic = createApp(db, { staticDir: dir })
    })
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    it('serves the documents itself, never the SPA fallback or a copy in the dashboard', async () => {
      for (const doc of AGENT_DOCS) {
        const res = await withStatic.request(doc.path, { headers: { accept: 'text/html' } })
        expect(res.status, doc.path).toBe(200)
        expect(res.headers.get('content-type'), doc.path).toBe(doc.contentType)
        expect(await res.text(), doc.path).toBe(readAgentDoc(doc.file))
      }
      const root = await withStatic.request('/', { headers: { accept: 'text/html' } })
      expect(await root.text()).toContain('<title>dashboard</title>')
    })
  })

  describe('openapi.json', () => {
    it('is OpenAPI 3.1 and every $ref resolves', () => {
      expect(openapi.openapi).toMatch(/^3\.1\.\d+$/)
      for (const ref of collectRefs(openapi))
        expect(() => resolvePointer(openapi, ref)).not.toThrow()
    })

    it('lists exactly the GET routes createApp registers', () => {
      const registered = registeredRoutes(app)
      const gets = registered.filter((route) => route.startsWith('GET '))
      expect(gets).toEqual(expect.arrayContaining(['GET /api/health', 'GET /AGENTS.md']))
      expect(documentedRoutes(openapi)).toEqual(gets)
    })

    it('names the routes it leaves out: the operator-only write routes', () => {
      const writes = registeredRoutes(app).filter((route) => !route.startsWith('GET '))
      expect(writes).toEqual(['DELETE /api/mm/:id', 'POST /api/mm'])
      for (const route of writes) {
        expect(openapi.info.description).toContain(route.replace(/:(\w+)/g, '{$1}'))
      }
    })

    it('every required property is a documented property', () => {
      const schemas = resolvePointer(openapi, '#/components/schemas') as Record<string, Schema>
      const walk = (schema: Schema, at: string): void => {
        for (const key of schema.required ?? []) {
          expect(Object.keys(schema.properties ?? {}), `${at} requires ${key}`).toContain(key)
        }
        for (const [key, child] of Object.entries(schema.properties ?? {}))
          walk(child, `${at}.${key}`)
        if (schema.items) walk(schema.items, `${at}[]`)
      }
      for (const [name, schema] of Object.entries(schemas)) walk(schema, name)
    })
  })

  describe('responses conform to openapi.json', () => {
    let seeded: Database
    let seed: Seed
    let api: Hono

    beforeAll(() => {
      ;({ db: seeded, seed } = createSeededDatabase())
      api = createApp(seeded, { now: () => seed.now, source: 'demo' })
    })
    afterAll(() => seeded.close())

    it('observatory routes over the seed (scored, unpriced and unscored pools)', async () => {
      const { pools, tokens } = seed
      const paths = [
        '/api/health',
        '/api/stats',
        '/api/pools',
        '/api/pools?sort=gap&dir=asc&limit=3&offset=1',
        '/api/gaps',
        '/api/gaps?minVolume=0',
        `/api/tokens/${tokens.WETH.address}`,
        `/api/tokens/${tokens.BRETT.address}`,
        `/api/pools/${pools.wethUsdcV3.id}/history?window=7d`,
        ...Object.values(pools).map((pool) => `/api/pools/${pool.id}`),
      ]
      for (const path of paths) expect(await conforms(api, path, 200), path).toEqual([])
    })

    it('scorecard routes over the seed (ok and breached mandates)', async () => {
      const paths = ['/api/mm', '/api/mm?active=false']
      for (const id of [SEED_MM_OK_ID, SEED_MM_BREACHED_ID]) {
        paths.push(`/api/mm/${id}`, `/api/mm/${id}/samples?window=30d`)
      }
      for (const path of paths) expect(await conforms(api, path, 200), path).toEqual([])
    })

    it('the Aero venues beside the seed: both AEROs labelled, per-snapshot fees', async () => {
      const { db: both, seed: world } = createSeededDatabase()
      try {
        const aero = seedAeroTokens(both, world)
        const served = createApp(both, { now: () => world.now })
        const paths = [
          '/api/stats',
          '/api/pools?dex=aero-v2',
          '/api/pools?dex=aero-slipstream',
          '/api/gaps?minVolume=0',
          `/api/tokens/${aero.token.address}`,
          `/api/tokens/${world.tokens.AERO.address}`,
          `/api/pools/${aero.aeroUsdcAeroV2.id}`,
          `/api/pools/${aero.wethUsdcAeroSlip.id}`,
          `/api/pools/${aero.wethUsdcAeroSlip.id}/history`,
        ]
        for (const path of paths) expect(await conforms(served, path, 200), path).toEqual([])
      } finally {
        both.close()
      }
    })

    it('a newest snapshot stored before owner coverage was recorded', async () => {
      const { db: old, seed: world } = createSeededDatabase()
      try {
        const pool = world.pools.wethAeroSlip
        const latest = old.snapshots.latestForPool(pool.id)
        if (!latest) throw new Error('the seed has no snapshot for the Slipstream pool')
        const next = { ...latest, blockNumber: latest.blockNumber + 1n, timestamp: world.now }
        old.snapshots.insert(next)
        old.raw
          .prepare(
            `UPDATE snapshots SET concentration_json = json_remove(concentration_json, '$.owners.coverage')
              WHERE pool_id = ? AND block_number = ?`,
          )
          .run(pool.id, String(next.blockNumber))
        const served = createApp(old, { now: () => world.now })
        const path = `/api/pools/${pool.id}`
        expect(await conforms(served, path, 200), path).toEqual([])
        const body = (await (await served.request(path)).json()) as {
          latest: { concentration: { owners: { coverage: number | null } } }
        }
        expect(body.latest.concentration.owners.coverage).toBeNull()
      } finally {
        old.close()
      }
    })

    it("a stock pool's newest snapshot with its reference, live and held", async () => {
      const { db: stocked, seed: world } = createSeededDatabase()
      try {
        const live = fixturePoolReference()
        const held = fixturePoolReference({
          referenceStatus: 'held',
          feedAgeSeconds: 65_000,
          deviationBps: null,
          toleranceBps: null,
          deviationThresholdBps: null,
          feeBps: null,
          withinTolerance: null,
          deviationNull: 'held',
          transfersPaused: null,
        })
        const cases = [
          [world.pools.wethUsdcV3, live],
          [world.pools.wethAeroSlip, held],
        ] as const
        const served = createApp(stocked, { now: () => world.now })
        for (const [pool, reference] of cases) {
          const latest = stocked.snapshots.latestForPool(pool.id)
          if (!latest) throw new Error(`the seed has no snapshot for ${pool.id}`)
          const next = { ...latest, blockNumber: latest.blockNumber + 1n, reference }
          stocked.snapshots.insert({ ...next, timestamp: world.now })
          const path = `/api/pools/${pool.id}`
          expect(await conforms(served, path, 200), path).toEqual([])
          const body = (await (await served.request(path)).json()) as { latest: unknown }
          expect(body.latest).toMatchObject({ reference })
        }
      } finally {
        stocked.close()
      }
    })

    it('stock routes over the stock seed (live, held, paused, no pool, no feed, no reading)', async () => {
      const { db: stocked, seed: world } = createSeededDatabase()
      try {
        const { stocks, pools } = seedStocks(stocked, world)
        const unread = makeStock('MSFTc')
        stocked.stocks.replaceAll([...Object.values(stocks), unread], world.now)
        const served = createApp(stocked, { now: () => world.now })
        const paths = [
          '/api/stocks',
          ...[...Object.values(stocks), unread].map((s) => `/api/stocks/${s.token.address}`),
          ...Object.values(pools).map((pool) => `/api/pools/${pool.id}`),
          `/api/tokens/${stocks.nvda.token.address}`,
          `/api/pools?q=${stocks.tsla.token.address}`,
          '/api/stats',
        ]
        for (const path of paths) expect(await conforms(served, path, 200), path).toEqual([])
      } finally {
        stocked.close()
      }
    })

    it('an empty database (nulls everywhere)', async () => {
      const paths = [
        '/api/health',
        '/api/stats',
        '/api/pools',
        '/api/gaps',
        '/api/mm',
        '/api/stocks',
      ]
      for (const path of paths) {
        expect(await conforms(app, path, 200), path).toEqual([])
      }
    })

    it('error bodies', async () => {
      const cases: Array<[string, number]> = [
        ['/api/pools?limit=0', 400],
        ['/api/pools/uniswap-v3:0xmissing', 404],
        ['/api/pools/uniswap-v3:0xmissing/history?window=1y', 400],
        ['/api/tokens/0x12', 400],
        ['/api/tokens/0x00000000000000000000000000000000000000aa', 404],
        ['/api/stocks/0x12', 400],
        ['/api/stocks/0x00000000000000000000000000000000000000aa', 404],
        ['/api/mm/missing-mandate', 404],
        ['/api/mm/missing-mandate/badge.svg', 404],
      ]
      for (const [path, status] of cases)
        expect(await conforms(api, path, status), path).toEqual([])
    })
  })

  describe('AGENTS.md and llms.txt', () => {
    const agents = readAgentDoc('AGENTS.md')
    const llms = readAgentDoc('llms.txt')

    it('AGENTS.md documents every GET route', () => {
      const gets = registeredRoutes(app).filter((route) => route.startsWith('GET '))
      const missing = gets.filter((route) => !agents.includes(route))
      expect(missing).toEqual([])
    })

    it('llms.txt follows the convention: H1, blockquote summary, link sections', () => {
      const lines = llms.split('\n')
      expect(lines[0]).toBe('# Depthwatch')
      expect(lines[1]).toBe('')
      expect(lines[2]).toMatch(/^> \S/)
      expect(llms).toMatch(/\n## Docs\n/)
    })

    it('llms.txt links to the agent documents and only to routes the app serves', () => {
      const relative = [...llms.matchAll(/\]\((\.\/[^)\s]+)\)/g)].map((m) => (m[1] ?? '').slice(1))
      expect(relative).toEqual(expect.arrayContaining(['/AGENTS.md', '/openapi.json']))
      const gets = registeredRoutes(app).filter((route) => route.startsWith('GET '))
      for (const path of relative) expect(gets).toContain(`GET ${path}`)
    })
  })
})
