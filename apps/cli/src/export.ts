/**
 * `export`: the static dashboard bundle (`StaticBundle`, docs/design/web-v2.md §4) as one JSON
 * file. Every section comes from the real API, `createApp(db, { now }).request(...)` route by
 * route, so the static site shows exactly what the server would answer at `now`.
 *
 * - `depthwatch export --out <file>`: the configured database (`source: 'live'`, wall clock).
 *   The file must exist: exporting never creates an empty database.
 * - `depthwatch export --demo --out <file>`: the demo pipeline (seven days of history) into an
 *   in-memory database, then its bundle (`source: 'demo'`, the synthetic world's clock).
 * - `--note <text>` adds the bundle's `note`, which the static site shows as "About this snapshot"
 *   for a live bundle. Without it the bundle has no `note` key at all.
 * - `depthwatch export --bundle <file> --out <file>`: an exported bundle written again with only
 *   its `features` replaced, no database read (the Trade switch and Trade preview workflows).
 *
 * Every export writes the trade switch (DEPTHWATCH_TRADE, tradeSwitch.ts) twice: as the bundle's
 * `features.trade` and as `flags.json` next to the bundle. An invalid value writes the switch off,
 * then fails the export with TradeSwitchRefusedError (exit code 3): off is published, loudly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  createApp,
  type GapsResponse,
  type HealthResponse,
  type HistoryResponse,
  MAX_LIMIT,
  type PoolDetail,
  type PoolSummary,
  type PoolsResponse,
  type SamplesResponse,
  type ScorecardDetail,
  type ScorecardsResponse,
  type StaticBundle,
  type StatsResponse,
  type TokenDetail,
} from '@depthwatch/api'
import { type TradeFlags, tradeOff } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import type { Config } from './config.js'
import { runDemoPipeline } from './demo.js'
import { errorMessage, type Logger } from './log.js'
import {
  checkBundlePath,
  describeTrade,
  exportedTradeSwitch,
  TradeSwitchRefusedError,
  writeFlagsFile,
} from './tradeSwitch.js'

export interface BuildStaticBundleOptions {
  /** Unix seconds: the API's clock, and the bundle's `generatedAt`. */
  now: number
  source: StaticBundle['source']
  /** The bundle's `note`; undefined leaves the key out. */
  note?: string
  /** The bundle's `features.trade`; undefined writes the switch off (`tradeOff()`). */
  trade?: TradeFlags
}

type App = ReturnType<typeof createApp>

/** Thrown when a route answers something other than 200 while exporting. */
export class ExportError extends Error {
  override readonly name = 'ExportError'
}

async function get(app: App, path: string): Promise<Response> {
  const res = await app.request(path)
  if (res.status !== 200) {
    const body = await res.text()
    throw new ExportError(`export: GET ${path} answered ${res.status}: ${body.slice(0, 200)}`)
  }
  return res
}

async function getJson<T>(app: App, path: string): Promise<T> {
  return (await (await get(app, path)).json()) as T
}

const segment = encodeURIComponent

/** Every page of `/api/pools` (default sort), `MAX_LIMIT` at a time. */
async function allPools(app: App): Promise<PoolSummary[]> {
  const items: PoolSummary[] = []
  for (let offset = 0; ; offset += MAX_LIMIT) {
    const page = await getJson<PoolsResponse>(app, `/api/pools?limit=${MAX_LIMIT}&offset=${offset}`)
    items.push(...page.items)
    if (page.items.length < MAX_LIMIT || items.length >= page.total) return items
  }
}

/** The whole gaps feed at the default floor: every page up to the feed's `total`. */
async function allGaps(app: App): Promise<GapsResponse> {
  const items: GapsResponse['items'] = []
  for (let offset = 0; ; offset += MAX_LIMIT) {
    const page = await getJson<GapsResponse>(app, `/api/gaps?limit=${MAX_LIMIT}&offset=${offset}`)
    items.push(...page.items)
    if (page.items.length < MAX_LIMIT || items.length >= page.total) return { ...page, items }
  }
}

/** `/api/tokens/:address` with every scored pool of the token; undefined when the API says 404. */
async function fullToken(app: App, address: string): Promise<TokenDetail | undefined> {
  const base = `/api/tokens/${segment(address)}`
  const first = await app.request(`${base}?limit=${MAX_LIMIT}`)
  if (first.status === 404) return undefined
  if (first.status !== 200)
    throw new ExportError(`export: GET ${base} answered ${first.status}: ${await first.text()}`)
  const detail = (await first.json()) as TokenDetail
  const pools = [...detail.pools]
  while (pools.length < detail.total) {
    const page = await getJson<TokenDetail>(
      app,
      `${base}?limit=${MAX_LIMIT}&offset=${pools.length}`,
    )
    if (page.pools.length === 0) break
    pools.push(...page.pools)
  }
  return { ...detail, pools }
}

/** Lowercase addresses of every token in `pools`, in first-seen order. */
function tokenAddresses(pools: readonly PoolSummary[]): string[] {
  const seen = new Set<string>()
  for (const { pool } of pools)
    for (const token of [pool.token0, pool.token1]) seen.add(token.address.toLowerCase())
  return [...seen]
}

/** The static bundle of `db`, read through the API at `opts.now`. */
export async function buildStaticBundle(
  db: Database,
  opts: BuildStaticBundleOptions,
): Promise<StaticBundle> {
  let failure: unknown
  const app = createApp(db, {
    now: () => opts.now,
    source: opts.source,
    onError: (error) => {
      failure = error
    },
  })
  try {
    const pools = await allPools(app)
    const poolDetails: StaticBundle['poolDetails'] = {}
    const history: StaticBundle['history'] = {}
    for (const { pool } of pools) {
      const base = `/api/pools/${segment(pool.id)}`
      poolDetails[pool.id] = await getJson<PoolDetail>(app, base)
      history[pool.id] = {
        '24h': await getJson<HistoryResponse>(app, `${base}/history?window=24h`),
        '7d': await getJson<HistoryResponse>(app, `${base}/history?window=7d`),
      }
    }
    const tokens: StaticBundle['tokens'] = {}
    for (const address of tokenAddresses(pools)) {
      const detail = await fullToken(app, address)
      if (detail !== undefined) tokens[address] = detail
    }
    const gaps = await allGaps(app)
    const { items: scorecards } = await getJson<ScorecardsResponse>(app, '/api/mm')
    const scorecardDetails: StaticBundle['scorecardDetails'] = {}
    const samples: StaticBundle['samples'] = {}
    const badges: StaticBundle['badges'] = {}
    for (const { mandate } of scorecards) {
      const base = `/api/mm/${segment(mandate.id)}`
      scorecardDetails[mandate.id] = await getJson<ScorecardDetail>(app, base)
      samples[mandate.id] = {
        '24h': await getJson<SamplesResponse>(app, `${base}/samples?window=24h`),
        '7d': await getJson<SamplesResponse>(app, `${base}/samples?window=7d`),
        '30d': await getJson<SamplesResponse>(app, `${base}/samples?window=30d`),
      }
      badges[mandate.id] = await (await get(app, `${base}/badge.svg`)).text()
    }
    return {
      v: 1,
      generatedAt: opts.now,
      source: opts.source,
      ...(opts.note === undefined ? {} : { note: opts.note }),
      features: { trade: opts.trade ?? tradeOff() },
      health: await getJson<HealthResponse>(app, '/api/health'),
      stats: await getJson<StatsResponse>(app, '/api/stats'),
      pools,
      poolDetails,
      history,
      gaps: gaps.items,
      gapsMinVolumeUsd: gaps.minVolumeUsd,
      tokens,
      scorecards,
      scorecardDetails,
      samples,
      badges,
    }
  } catch (error) {
    if (failure !== undefined) throw new ExportError(errorMessage(failure), { cause: failure })
    throw error
  }
}

export interface ExportOptions {
  config: Config
  log: Logger
  /** Receives the one-line summary; defaults to stdout. */
  stdout?: (line: string) => void
  /** Wall clock for a live export (unix seconds); tests pin it. */
  now?: () => number
  /** Demo history points (default: seven days); tests run a short history. */
  historyPoints?: number
}

export interface ExportResult {
  path: string
  bytes: number
  bundle: StaticBundle
}

/** The database `export` reads (live) or fills (demo); live files must already exist. */
function openExportDatabase(config: Config): Database {
  if (config.exportDemo) return openDatabase(IN_MEMORY)
  if (config.dbPath !== IN_MEMORY && !existsSync(config.dbPath))
    throw new ExportError(
      `export: database "${config.dbPath}" does not exist (set DEPTHWATCH_DB or --db, or use --demo)`,
    )
  return openDatabase(config.dbPath)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `export --bundle`: a bundle file, after a check of its v1 envelope. */
function readBundleFile(file: string): StaticBundle {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ExportError(`export: cannot read the bundle ${file}: ${errorMessage(error)}`)
  }
  if (
    !isRecord(parsed) ||
    parsed.v !== 1 ||
    (parsed.source !== 'demo' && parsed.source !== 'live') ||
    typeof parsed.generatedAt !== 'number' ||
    !Array.isArray(parsed.pools)
  )
    throw new ExportError(`export: ${file} is not a v1 Depthwatch static bundle`)
  return parsed as unknown as StaticBundle
}

/** Writes the bundle, then `flags.json` next to it; returns the bundle's size in bytes. */
function writeExport(path: string, bundle: StaticBundle, trade: TradeFlags): number {
  const text = JSON.stringify(bundle)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  writeFlagsFile(path, trade)
  return Buffer.byteLength(text)
}

export async function exportCommand(opts: ExportOptions): Promise<ExportResult> {
  const { config, log } = opts
  if (config.outFile === undefined) throw new ExportError('export needs --out <file>')
  const path = resolve(config.outFile)
  checkBundlePath(path)
  const { trade, refused } = exportedTradeSwitch(config.tradeSwitch)
  const stdout = opts.stdout ?? ((line: string) => process.stdout.write(`${line}\n`))
  const switchText = `${describeTrade(trade)}${refused === null ? '' : ' (DEPTHWATCH_TRADE refused)'}`
  /** Returns the result, or throws the switch's refusal once everything is written. */
  const done = (result: ExportResult): ExportResult => {
    if (refused !== null)
      throw new TradeSwitchRefusedError(`${refused}; wrote the trade switch off instead`)
    return result
  }
  if (config.exportBundle !== undefined) {
    const from = resolve(config.exportBundle)
    const bundle: StaticBundle = { ...readBundleFile(from), features: { trade } }
    const bytes = writeExport(path, bundle, trade)
    stdout(
      `exported ${bundle.source} bundle to ${path} from ${from}, features only: ` +
        `${bundle.pools.length} pools, ${bytes} bytes; ${switchText}`,
    )
    return done({ path, bytes, bundle })
  }
  const db = openExportDatabase(config)
  try {
    let now: number
    if (config.exportDemo) {
      log.info('export: running the demo pipeline in memory', { db: db.path })
      const result = await runDemoPipeline({
        db,
        config,
        log,
        historyPoints: opts.historyPoints,
      })
      now = result.now
    } else {
      now = opts.now?.() ?? Math.floor(Date.now() / 1000)
    }
    const source: StaticBundle['source'] = config.exportDemo ? 'demo' : 'live'
    const bundle = await log.timed(
      'export',
      () => buildStaticBundle(db, { now, source, note: config.exportNote, trade }),
      (b) => ({ pools: b.pools.length, scorecards: b.scorecards.length, gaps: b.gaps.length }),
    )
    const bytes = writeExport(path, bundle, trade)
    stdout(
      `exported ${source} bundle to ${path}: ${bundle.pools.length} pools, ` +
        `${bundle.scorecards.length} scorecards, ${bytes} bytes; ${switchText}`,
    )
    return done({ path, bytes, bundle })
  } finally {
    db.close()
  }
}
