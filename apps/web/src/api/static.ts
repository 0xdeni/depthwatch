/**
 * The static dashboard's client (`VITE_STATIC=1`, docs/design/web-v2.md §4): every `ApiClient`
 * call is answered from one `StaticBundle` exported by `depthwatch export`, with the API's
 * semantics (apps/api/src/routes/*.ts): the same sorting (nulls last, ties by pool id), filters,
 * paging defaults and limits, and the same 400 / 404 bodies, so the pages cannot tell it from
 * the server.
 *
 * Answers are deep copies: nothing the UI does to a response can change the bundle. The bundle
 * holds scored pools only, so a pool the server knows but has not scored (its `/api/pools/:id`
 * and history) and a token outside every scored pool answer 404 here. A bundle exported before
 * the stock routes has no stock keys: it answers `{ items: [] }` and 404 `stock not found`.
 */
import { GAP_FEED_MIN_VOLUME_USD, isMeaningfulGap } from '@depthwatch/core'
import { matchesPoolQuery } from '../lib/poolQuery.js'
import { sortValue } from '../lib/sort.js'
import type { FetchLike } from './client.js'
import { ApiError } from './errors.js'
import {
  parseAddress,
  parseGapsQuery,
  parseHistoryWindow,
  parsePoolsQuery,
  parseSamplesQuery,
  parseScorecardsQuery,
  parseTokenQuery,
} from './staticQuery.js'
import type {
  ApiClient,
  GapItem,
  GapsQuery,
  HistoryWindow,
  PoolSort,
  PoolSummary,
  PoolsQuery,
  SamplesQuery,
  ScorecardsQuery,
  SortDir,
  StaticBundle,
  TokenQuery,
} from './types.js'

/** Where the static build serves the bundle, relative to its `index.html`. */
export const STATIC_BUNDLE_URL = './data/bundle.json'

const POOL_NOT_FOUND = 'pool not found'
const TOKEN_NOT_FOUND = 'token not found'
const MANDATE_NOT_FOUND = 'mandate not found'
const STOCK_NOT_FOUND = 'stock not found'
const BAD_ADDRESS = 'invalid token address: expected 0x + 40 hex chars'

/** Own-property lookup, so ids like `constructor` or `__proto__` are simply unknown. */
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

/**
 * The API's `q` filter, core's rule (lib/poolQuery.ts): every term of the query ("WETH/USDC",
 * "usdc weth") matches either token's symbol or address, the pool address or the v4 pool id, or a
 * word start in either token's name or the DEX.
 */
export { matchesPoolQuery }

function compareIds(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * `ORDER BY [unrated last,] <column> <dir> NULLS LAST, pool_id ASC`, as `ScoresRepo.topBy` sorts:
 * by health, the unrated pools follow the rated ones in both directions.
 */
export function sortPools(items: readonly PoolSummary[], sort: PoolSort, dir: SortDir) {
  return [...items].sort((a, b) => {
    if (sort === 'health' && a.health.rated !== b.health.rated) return a.health.rated ? -1 : 1
    const va = sortValue(a, sort)
    const vb = sortValue(b, sort)
    if (va !== vb) {
      if (va === null) return 1
      if (vb === null) return -1
      return dir === 'asc' ? va - vb : vb - va
    }
    return compareIds(a.pool.id, b.pool.id)
  })
}

function page<T>(items: readonly T[], limit: number, offset: number): T[] {
  return items.slice(offset, offset + limit)
}

/**
 * `ORDER BY gap_score DESC, turnover DESC NULLS LAST, pool_id ASC`, as `ScoresRepo.gaps` sorts:
 * every pool trading 100× its depth or more scores 100, so a tie goes to the larger turnover.
 */
function compareGaps(a: GapItem, b: GapItem): number {
  const score = (b.gap.gapScore ?? 0) - (a.gap.gapScore ?? 0)
  if (score !== 0) return score
  const ta = a.gap.turnoverRatio
  const tb = b.gap.turnoverRatio
  if (ta !== tb) {
    if (ta === null) return 1
    if (tb === null) return -1
    return tb - ta
  }
  return compareIds(a.pool.pool.id, b.pool.pool.id)
}

/**
 * Every gap-feed entry at `minVolumeUsd`: `gap_score IS NOT NULL AND volume_24h_usd >= floor`,
 * best gap score first, ties by turnover then pool id. The bundle holds the feed at its default
 * floor; a lower floor adds scored pools from `pools` with the gap metrics of their `poolDetails`.
 */
export function gapFeed(bundle: StaticBundle, minVolumeUsd: number): GapItem[] {
  const byId = new Map<string, GapItem>()
  const keep = (summary: PoolSummary) =>
    summary.gapScore !== null &&
    summary.volume24hUsd !== null &&
    summary.volume24hUsd >= minVolumeUsd
  for (const item of bundle.gaps) if (keep(item.pool)) byId.set(item.pool.pool.id, item)
  for (const summary of bundle.pools) {
    if (byId.has(summary.pool.id) || !keep(summary)) continue
    const gap = own(bundle.poolDetails, summary.pool.id)?.gap
    if (!gap) continue
    byId.set(summary.pool.id, {
      pool: summary,
      gap: {
        volume24hUsd: gap.volume24hUsd,
        depth2Usd: gap.depth2Usd,
        turnoverRatio: gap.turnoverRatio,
        gapScore: gap.gapScore,
      },
    })
  }
  return [...byId.values()].sort(compareGaps)
}

export function createStaticClient(bundle: StaticBundle): ApiClient {
  function requireMandate(id: string) {
    const detail = own(bundle.scorecardDetails, id)
    if (!detail) throw new ApiError(404, MANDATE_NOT_FOUND)
    return detail
  }

  return {
    async health() {
      // The bundle's own `source` is the authority (bundles exported before health carried it).
      return { ...copy(bundle.health), source: bundle.source }
    },
    async stats() {
      return copy(bundle.stats)
    },
    async pools(query: PoolsQuery = {}) {
      const q = parsePoolsQuery(query)
      const minVolume = q.minVolume
      const matching = bundle.pools.filter(
        (item) =>
          (q.dex === undefined || item.pool.dex === q.dex) &&
          (q.q === undefined || matchesPoolQuery(item, q.q)) &&
          (q.rated === undefined || item.health.rated === q.rated) &&
          (minVolume === undefined ||
            (item.volume24hUsd !== null && item.volume24hUsd >= minVolume)),
      )
      const sorted = sortPools(matching, q.sort, q.dir)
      return copy({ items: page(sorted, q.limit, q.offset), total: matching.length })
    },
    async pool(id: string) {
      const detail = own(bundle.poolDetails, id)
      if (!detail) throw new ApiError(404, POOL_NOT_FOUND)
      return copy(detail)
    },
    async history(id: string, window: HistoryWindow = '24h') {
      const parsed = parseHistoryWindow(window)
      const series = own(bundle.history, id)
      if (!series) throw new ApiError(404, POOL_NOT_FOUND)
      return copy(series[parsed])
    },
    async gaps(query: GapsQuery = {}) {
      const q = parseGapsQuery(query)
      const minVolumeUsd = q.minVolume ?? GAP_FEED_MIN_VOLUME_USD
      const feed = gapFeed(bundle, minVolumeUsd)
      return copy({
        items: page(feed, q.limit, q.offset),
        total: feed.length,
        meaningful: feed.filter((item) => isMeaningfulGap(item.gap)).length,
        minVolumeUsd,
      })
    },
    async token(address: string, query: TokenQuery = {}) {
      const normalized = parseAddress(address)
      if (normalized === undefined) throw new ApiError(400, BAD_ADDRESS)
      const q = parseTokenQuery(query)
      const detail = own(bundle.tokens, normalized)
      if (!detail) throw new ApiError(404, TOKEN_NOT_FOUND)
      const pools = page(sortPools(detail.pools, q.sort, q.dir), q.limit, q.offset)
      return copy({ ...detail, pools })
    },
    async scorecards(query: ScorecardsQuery = {}) {
      const q = parseScorecardsQuery(query)
      // The bundle keeps the API's order (active first, then by name); filtering preserves it.
      const items = bundle.scorecards.filter(
        (item) =>
          (q.pool === undefined || item.mandate.poolId === q.pool) &&
          (q.active === undefined || item.mandate.active === q.active),
      )
      return copy({ items })
    },
    async scorecard(id: string) {
      return copy(requireMandate(id))
    },
    async scorecardSamples(id: string, query: SamplesQuery = {}) {
      const { window, limit } = parseSamplesQuery(query)
      requireMandate(id)
      const series = own(bundle.samples, id)?.[window]
      if (!series) throw new ApiError(404, MANDATE_NOT_FOUND)
      // Ascending series; when it overflows the limit the newest samples are the ones that matter.
      const points =
        series.points.length > limit
          ? series.points.slice(series.points.length - limit)
          : series.points
      return copy({ ...series, points })
    },
    async badge(id: string) {
      requireMandate(id)
      const svg = own(bundle.badges, id)
      if (svg === undefined) throw new ApiError(404, MANDATE_NOT_FOUND)
      return svg
    },
    async stocks() {
      // The bundle keeps the API's order (deepest first, then ticker).
      return copy({ items: bundle.stocks ?? [] })
    },
    async stock(address: string) {
      const normalized = parseAddress(address)
      if (normalized === undefined) throw new ApiError(400, BAD_ADDRESS)
      const detail = own(bundle.stockDetails ?? {}, normalized)
      if (!detail) throw new ApiError(404, STOCK_NOT_FOUND)
      return copy(detail)
    },
  }
}

const RECORD_KEYS = [
  'poolDetails',
  'history',
  'tokens',
  'scorecardDetails',
  'samples',
  'badges',
] as const
const ARRAY_KEYS = ['pools', 'gaps', 'scorecards'] as const
/** Absent from a bundle exported before the stock routes; checked when present. */
const OPTIONAL_KEYS = { stocks: 'array', stockDetails: 'object' } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Checks the bundle's envelope (version, source and every section) before the app trusts it. */
export function assertStaticBundle(value: unknown): StaticBundle {
  const fail = (why: string): never => {
    throw new Error(`not a Depthwatch static bundle (v1): ${why}`)
  }
  if (!isRecord(value)) return fail('not a JSON object')
  if (value.v !== 1) return fail(`unsupported version ${JSON.stringify(value.v)}`)
  if (value.source !== 'demo' && value.source !== 'live') return fail('source is not demo|live')
  if (typeof value.generatedAt !== 'number') return fail('generatedAt is not a number')
  if (value.note !== undefined && typeof value.note !== 'string')
    return fail('note is not a string')
  if (typeof value.gapsMinVolumeUsd !== 'number') return fail('gapsMinVolumeUsd is not a number')
  if (!isRecord(value.health) || !isRecord(value.stats)) return fail('health or stats missing')
  for (const key of ARRAY_KEYS) if (!Array.isArray(value[key])) fail(`${key} is not an array`)
  for (const key of RECORD_KEYS) if (!isRecord(value[key])) fail(`${key} is not an object`)
  for (const [key, kind] of Object.entries(OPTIONAL_KEYS)) {
    const v = value[key]
    if (v === undefined) continue
    if (kind === 'array' ? !Array.isArray(v) : !isRecord(v)) fail(`${key} is not an ${kind}`)
  }
  return value as unknown as StaticBundle
}

/** What the static site says about a published live snapshot (docs/design/web-v2.md §4). */
export interface StaticSnapshot {
  /** Unix seconds: when the data was read from Base (the newest snapshot; else the export). */
  at: number
  /** Unix seconds: when the bundle was exported (`generatedAt`). */
  exportedAt: number
  /** The newest snapshot's block as a decimal string; null before any snapshot. */
  block: string | null
  /** The exporter's note (`depthwatch export --note`), trimmed; null when there is none. */
  note: string | null
}

/**
 * A `live` bundle on the static site is a snapshot of Base mainnet that never updates: when it
 * was read, at which block, when it was exported and the exporter's note. A demo bundle is not a
 * snapshot (its clock is frozen instead, staticBoot.tsx), so it has none.
 */
export function snapshotOf(bundle: StaticBundle): StaticSnapshot | undefined {
  if (bundle.source !== 'live') return undefined
  const note = bundle.note?.trim() ?? ''
  return {
    at: bundle.health.latestSnapshotAt ?? bundle.generatedAt,
    exportedAt: bundle.generatedAt,
    block: bundle.health.latestBlock,
    note: note === '' ? null : note,
  }
}

/** Fetches and checks the bundle (default `./data/bundle.json`, next to the static site). */
export async function loadStaticBundle(
  url: string = STATIC_BUNDLE_URL,
  fetchFn: FetchLike = (input, init) => fetch(input, init),
): Promise<StaticBundle> {
  const res = await fetchFn(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`could not load ${url}: ${`${res.status} ${res.statusText}`.trim()}`)
  return assertStaticBundle(await res.json())
}
