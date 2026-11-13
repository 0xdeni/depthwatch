/**
 * `export` (docs/design/web-v2.md §4): the bundle is the API's own answers, route by route, with
 * every section filled; pages are walked to the end; the command writes the file for the demo
 * (in memory) and for a live database file, and never creates a database that is not there.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createApp,
  createSeededDatabase,
  SEED_NOW,
  type StaticBundle,
  seedDatabase,
  seedStocks,
} from '@depthwatch/api'
import { SYNTHETIC_DEFAULTS } from '@depthwatch/chain'
import { tradeOff } from '@depthwatch/core'
import {
  type Database,
  FIXTURE_USDC,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
  fixtureScore,
  IN_MEMORY,
  openDatabase,
} from '@depthwatch/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, parseCliArgs } from './config.js'
import { runDemoPipeline } from './demo.js'
import { buildStaticBundle, ExportError, exportCommand } from './export.js'
import { silentLogger } from './log.js'

const NOW = SYNTHETIC_DEFAULTS.latestTimestamp

async function api(
  db: Database,
  now: number,
  path: string,
  source: StaticBundle['source'] = 'live',
): Promise<unknown> {
  const res = await createApp(db, { now: () => now, source }).request(path)
  expect(res.status).toBe(200)
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text()
}

describe('buildStaticBundle over the demo (short history)', () => {
  let db: Database
  let bundle: StaticBundle
  const get = (path: string) => api(db, NOW, path, 'demo')

  beforeAll(async () => {
    db = openDatabase(IN_MEMORY)
    await runDemoPipeline({ db, config: loadConfig({}), historyPoints: 4 })
    bundle = await buildStaticBundle(db, { now: NOW, source: 'demo' })
  }, 30_000)
  afterAll(() => db.close())

  it('fills every section', () => {
    expect(bundle).toMatchObject({
      v: 1,
      generatedAt: NOW,
      source: 'demo',
      gapsMinVolumeUsd: 10_000,
    })
    expect(bundle.health.ok).toBe(true)
    // The health section names the data source too, so the dashboard can tell demo from live.
    expect(bundle.health.source).toBe('demo')
    expect(bundle.stats.totals.scored).toBe(8)
    expect(bundle.pools).toHaveLength(8)
    const ids = bundle.pools.map((p) => p.pool.id)
    expect(Object.keys(bundle.poolDetails)).toEqual(ids)
    expect(Object.keys(bundle.history)).toEqual(ids)
    for (const id of ids) {
      expect(bundle.history[id]?.['24h'].points).toHaveLength(4)
      expect(bundle.history[id]?.['7d'].points).toHaveLength(4)
    }
    expect(bundle.gaps.length).toBeGreaterThan(0)
    const tokens = new Set(
      bundle.pools.flatMap((p) => [p.pool.token0.address, p.pool.token1.address]),
    )
    expect(Object.keys(bundle.tokens).sort()).toEqual([...tokens].sort())
    for (const detail of Object.values(bundle.tokens))
      expect(detail.pools).toHaveLength(detail.total)
    const mandates = bundle.scorecards.map((s) => s.mandate.id).sort()
    expect(mandates).toEqual(['demo-aero-usdc-aero', 'demo-slipstream-weth-usdc'])
    for (const id of mandates) {
      expect(bundle.scorecardDetails[id]?.pool).not.toBeNull()
      expect(bundle.samples[id]?.['24h'].points).toHaveLength(4)
      expect(bundle.samples[id]?.['30d'].points).toHaveLength(4)
      expect(bundle.badges[id]).toMatch(/<svg[^>]*>[\s\S]*<\/svg>\s*$/)
    }
    // The demo world tracks no stock: both keys are there, empty.
    expect(bundle.stocks).toEqual([])
    expect(bundle.stockDetails).toEqual({})
  })

  it('equals the API response of every route', async () => {
    expect(bundle.health).toEqual(await get('/api/health'))
    expect(bundle.stats).toEqual(await get('/api/stats'))
    expect(bundle.pools).toEqual(((await get('/api/pools?limit=200')) as { items: unknown }).items)
    expect(bundle.gaps).toEqual(((await get('/api/gaps?limit=200')) as { items: unknown }).items)
    for (const { pool } of bundle.pools) {
      const path = `/api/pools/${encodeURIComponent(pool.id)}`
      expect(bundle.poolDetails[pool.id]).toEqual(await get(path))
      expect(bundle.history[pool.id]?.['7d']).toEqual(await get(`${path}/history?window=7d`))
      expect(bundle.history[pool.id]?.['24h']).toEqual(await get(`${path}/history?window=24h`))
    }
    for (const [address, detail] of Object.entries(bundle.tokens))
      expect(detail).toEqual(await get(`/api/tokens/${address}?limit=200`))
    expect(bundle.scorecards).toEqual(((await get('/api/mm')) as { items: unknown }).items)
    for (const id of Object.keys(bundle.scorecardDetails)) {
      const path = `/api/mm/${id}`
      expect(bundle.scorecardDetails[id]).toEqual(await get(path))
      for (const window of ['24h', '7d', '30d'] as const)
        expect(bundle.samples[id]?.[window]).toEqual(await get(`${path}/samples?window=${window}`))
      expect(bundle.badges[id]).toBe(await get(`${path}/badge.svg`))
    }
    expect(bundle.stocks).toEqual(((await get('/api/stocks')) as { items: unknown }).items)
  })

  it('includes inactive mandates', async () => {
    db.mandates.setActive('demo-aero-usdc-aero', false)
    try {
      const again = await buildStaticBundle(db, { now: NOW, source: 'demo' })
      const aero = again.scorecards.find((s) => s.mandate.id === 'demo-aero-usdc-aero')
      expect(aero?.status).toBe('inactive')
      expect(again.badges['demo-aero-usdc-aero']).toMatch(/<svg[^>]*>[\s\S]*<\/svg>\s*$/)
    } finally {
      db.mandates.setActive('demo-aero-usdc-aero', true)
    }
  })
})

describe('buildStaticBundle with stocks', () => {
  it('exports /api/stocks and /api/stocks/:token of every stock, keyed by lowercase address', async () => {
    const { db, seed } = createSeededDatabase()
    try {
      const { stocks } = seedStocks(db, seed)
      const bundle = await buildStaticBundle(db, { now: seed.now, source: 'live' })
      const get = (path: string) => api(db, seed.now, path)
      expect(bundle.stocks).toEqual(((await get('/api/stocks')) as { items: unknown }).items)
      const addresses = Object.values(stocks).map((s) => s.token.address.toLowerCase())
      expect(Object.keys(bundle.stockDetails ?? {}).sort()).toEqual(addresses.sort())
      for (const address of addresses)
        expect(bundle.stockDetails?.[address]).toEqual(await get(`/api/stocks/${address}`))
      expect(bundle.stockDetails?.[stocks.nvda.token.address]?.pools).toHaveLength(4)
      // A stock's token page is exported like any token's.
      expect(bundle.tokens[stocks.nvda.token.address]?.total).toBe(4)
    } finally {
      db.close()
    }
  })
})

describe('buildStaticBundle paging', () => {
  it('walks every page of pools, gaps and token pools past the 200 limit', async () => {
    const db = openDatabase(IN_MEMORY)
    try {
      db.tokens.upsertMany([FIXTURE_WETH, FIXTURE_USDC])
      const pools = Array.from({ length: 205 }, (_, i) =>
        fixturePool({ address: fixtureAddress(i + 1) }),
      )
      db.pools.upsertMany(pools)
      db.pools.setTracked(
        pools.map((p) => p.id),
        true,
      )
      db.scores.upsertMany(
        pools.map((p, i) =>
          fixtureScore({ poolId: p.id, healthTotal: i % 100, gapScore: 60, volume24hUsd: 100_000 }),
        ),
      )
      const bundle = await buildStaticBundle(db, { now: 1_700_000_000, source: 'live' })
      expect(bundle.pools).toHaveLength(205)
      expect(new Set(bundle.pools.map((p) => p.pool.id)).size).toBe(205)
      expect(bundle.gaps).toHaveLength(205)
      expect(bundle.tokens[FIXTURE_WETH.address]?.pools).toHaveLength(205)
      expect(bundle.tokens[FIXTURE_USDC.address]?.total).toBe(205)
      expect(bundle.scorecards).toEqual([])
    } finally {
      db.close()
    }
  }, 30_000)
})

describe('exportCommand', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-export-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('--demo writes the demo bundle without touching DEPTHWATCH_DB', async () => {
    const out = join(dir, 'nested', 'bundle.json')
    const live = join(dir, 'live.db')
    const lines: string[] = []
    const result = await exportCommand({
      config: loadConfig({ DEPTHWATCH_DB: live }, { out, demo: true }),
      log: silentLogger,
      stdout: (line) => lines.push(line),
      historyPoints: 3,
    })
    expect(existsSync(live)).toBe(false)
    const written = JSON.parse(readFileSync(out, 'utf8')) as StaticBundle
    expect(written).toEqual(result.bundle)
    expect(written).toMatchObject({ source: 'demo', generatedAt: NOW })
    // No --note, no `note` key: a demo export is unchanged by the field; nor --updates.
    expect(Object.hasOwn(written, 'note')).toBe(false)
    expect(Object.hasOwn(written, 'updates')).toBe(false)
    expect(written.pools).toHaveLength(8)
    expect(lines).toEqual([
      `exported demo bundle to ${result.path}: 8 pools, 2 scorecards, ${result.bytes} bytes; ` +
        'trade off',
    ])
    // DEPTHWATCH_TRADE unset: the switch is off in the bundle and in flags.json next to it.
    expect(written.features).toEqual({ trade: tradeOff() })
    expect(readFileSync(join(dir, 'nested', 'flags.json'), 'utf8')).toBe(
      JSON.stringify({ trade: tradeOff() }),
    )
  }, 30_000)

  it('exports a live database file at the wall clock, with the --note text', async () => {
    const file = join(dir, 'live.db')
    const seeded = openDatabase(file)
    try {
      seedDatabase(seeded)
    } finally {
      seeded.close()
    }
    const out = join(dir, 'bundle.json')
    const { flags } = parseCliArgs([
      'export',
      '--out',
      out,
      '--note',
      '  Top 492 pools by TVL. ',
      '--updates',
      'several-times-a-day',
    ])
    const result = await exportCommand({
      config: loadConfig({ DEPTHWATCH_DB: file }, flags),
      log: silentLogger,
      stdout: () => {},
      now: () => SEED_NOW,
    })
    expect(result.bundle).toMatchObject({
      source: 'live',
      generatedAt: SEED_NOW,
      note: 'Top 492 pools by TVL.',
      updates: 'several-times-a-day',
    })
    expect((JSON.parse(readFileSync(out, 'utf8')) as StaticBundle).note).toBe(
      'Top 492 pools by TVL.',
    )
    const db = openDatabase(file)
    try {
      expect(result.bundle.pools).toEqual(
        ((await api(db, SEED_NOW, '/api/pools?limit=200')) as { items: unknown }).items,
      )
      expect(result.bundle.scorecards.length).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('takes --note on export only, and never empty', () => {
    expect(parseCliArgs(['export', '--note', 'Read at block 53,063,332.']).flags.note).toBe(
      'Read at block 53,063,332.',
    )
    expect(loadConfig({}, {}).exportNote).toBeUndefined()
    expect(() => parseCliArgs(['snapshot', '--note', 'x'])).toThrow(
      new ConfigError('--note only applies to export'),
    )
    expect(() => parseCliArgs(['export', '--out', 'b.json', '--note', '  '])).toThrow(
      new ConfigError('--note needs text'),
    )
  })

  it('takes --updates on export only, as several-times-a-day, and not with --bundle', () => {
    expect(
      loadConfig({}, parseCliArgs(['export', '--updates', 'several-times-a-day']).flags)
        .exportUpdates,
    ).toBe('several-times-a-day')
    expect(loadConfig({}, {}).exportUpdates).toBeUndefined()
    expect(() => parseCliArgs(['export', '--updates', 'hourly'])).toThrow(
      new ConfigError('--updates takes several-times-a-day'),
    )
    expect(() => parseCliArgs(['snapshot', '--updates', 'several-times-a-day'])).toThrow(
      new ConfigError('--updates only applies to export'),
    )
    expect(() =>
      parseCliArgs(['export', '--bundle', 'a.json', '--updates', 'several-times-a-day']),
    ).toThrow(/no --demo, --note, --updates/)
  })

  it('is passed by the Refresh site workflow, which publishes several times a day', () => {
    const workflow = readFileSync(
      new URL('../../../.github/workflows/refresh-site.yml', import.meta.url),
      'utf8',
    )
    // An hourly check that refreshes once the last copy is 2.5 hours old makes several copies a
    // day; the snapshot line says so only because of this flag.
    expect(workflow).toContain('- cron: "23 * * * *"')
    expect(workflow).toMatch(
      /pnpm depthwatch export --out [^\n]*\\\n(?:\s+--note "[^"]*" \\\n)?\s+--updates several-times-a-day \\\n/,
    )
  })

  it('--bundle keeps a bundle exported before the stock routes without their keys', async () => {
    const db = openDatabase(IN_MEMORY)
    let old: StaticBundle
    try {
      await runDemoPipeline({ db, config: loadConfig({}), historyPoints: 2 })
      const {
        stocks: _stocks,
        stockDetails: _details,
        ...rest
      } = await buildStaticBundle(db, {
        now: NOW,
        source: 'demo',
      })
      old = rest
    } finally {
      db.close()
    }
    const from = join(dir, 'old.json')
    const out = join(dir, 'again.json')
    writeFileSync(from, JSON.stringify(old))
    const result = await exportCommand({
      config: loadConfig({}, parseCliArgs(['export', '--bundle', from, '--out', out]).flags),
      log: silentLogger,
      stdout: () => {},
    })
    const written = JSON.parse(readFileSync(out, 'utf8')) as StaticBundle
    expect(written).toEqual(result.bundle)
    expect(Object.hasOwn(written, 'stocks')).toBe(false)
    expect(Object.hasOwn(written, 'stockDetails')).toBe(false)
    expect(written.pools).toEqual(old.pools)
  }, 30_000)

  it('refuses a database file that does not exist, creating nothing', async () => {
    const file = join(dir, 'missing.db')
    const out = join(dir, 'bundle.json')
    await expect(
      exportCommand({ config: loadConfig({}, { db: file, out }), log: silentLogger }),
    ).rejects.toThrow(ExportError)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(out)).toBe(false)
  })
})
