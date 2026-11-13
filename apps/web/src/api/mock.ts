/**
 * In-repo mock API. Used when `VITE_MOCK=1`, or by the Vite dev server when `/api/health` is
 * unreachable at startup; a production build neither contains nor loads it.
 *
 * Every method answers with the same DTOs, defaults, limits and error bodies as the real routes
 * in `apps/api` (`pool not found` 404, `invalid token address` 400, limit 1..200, `mandate not
 * found` 404, …) so the UI cannot tell the two apart. Histories are deterministic per pool id;
 * the two scorecards mirror the API seed (`mockScorecards.ts`); the tokenized stocks and their
 * pools are `mockStocks.ts`.
 */
import {
  DEXES,
  type Dex,
  GAP_FEED_MIN_VOLUME_USD,
  isMeaningfulGap,
  isStaleQuote,
  toJsonSafe,
} from '@depthwatch/core'
import { renderBadge } from '../lib/badge.js'
import { countsInDepthSums } from '../lib/depthSums.js'
import { compareScorecards, SAMPLE_WINDOW_HOURS } from '../lib/scorecard.js'
import { matchesQuery, sortSummaries } from '../lib/sort.js'
import { ApiError } from './errors.js'
import { buildHistory, type HistorySeed } from './mockHistory.js'
import {
  buildPool,
  LATEST_BLOCK,
  type MockPool,
  SEEDS,
  summarize,
  TOKENS,
  tokenInfo,
} from './mockPools.js'
import { mockMandates, mockMmSamples, mockScorecard } from './mockScorecards.js'
import { createStockWorld, STOCK_TOKENS, stockTokenKey } from './mockStocks.js'
import type {
  ApiClient,
  DexStatsDto,
  GapItem,
  GapsQuery,
  HistoryWindow,
  PoolDetail,
  PoolSummary,
  PoolsQuery,
  SamplesQuery,
  SamplesResponse,
  ScorecardDetail,
  ScorecardSummaryDto,
  ScorecardsQuery,
  StatsResponse,
  TokenDetail,
  TokenQuery,
} from './types.js'
import { MAX_SAMPLES_LIMIT, SAMPLE_WINDOWS } from './types.js'

export { toRawAmount } from './mockPools.js'
export {
  MOCK_MM_BREACHED_ID,
  MOCK_MM_BREACHED_POOL,
  MOCK_MM_OK_ID,
  MOCK_MM_OK_POOL,
} from './mockScorecards.js'
export { MOCK_STOCK_POOLS } from './mockStocks.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const ADDRESS_RE = /^0x[0-9a-f]{40}$/

/** Total discovered pools per DEX (tracked pools are the seeds). */
const DISCOVERED: Readonly<Record<Dex, number>> = {
  'uniswap-v3': 1842,
  'uniswap-v4': 627,
  'aerodrome-v2': 2311,
  'aerodrome-slipstream': 418,
  'aero-v2': 300,
  'aero-slipstream': 489,
}

/** The median health total over the rated pools only; null when none is rated. */
/** The sum of the known values; null when every value is unknown (unknown is not 0). */
function sumKnown(values: readonly (number | null)[]): number | null {
  let sum: number | null = null
  for (const v of values) if (v !== null) sum = (sum ?? 0) + v
  return sum
}

function ratedMedian(rows: readonly MockPool[]): number | null {
  return median(rows.filter((p) => p.score.rated).map((p) => p.score.total))
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const hi = sorted[mid] ?? 0
  const lo = sorted[mid - 1] ?? hi
  return sorted.length % 2 === 0 ? (lo + hi) / 2 : hi
}

/** Same defaults and clamping as the API's query schemas (limit 1..200 default 50, offset ≥ 0). */
function page<T>(items: readonly T[], limit?: number, offset?: number): T[] {
  const start = Math.max(0, Math.floor(offset ?? 0))
  const size = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)))
  return items.slice(start, start + size)
}

function historySeed(p: MockPool): HistorySeed {
  return {
    id: p.meta.id,
    depth2Usd: p.depth2Usd,
    spread10kBps: p.spread10kBps,
    health: p.score.total,
    price: p.snapshot.price,
    tvlUsd: p.snapshot.tvlUsd,
    feePips: p.meta.feePips,
    sparse: p.persistence24h.stability === null,
  }
}

function dexStats(dex: Dex, rows: MockPool[]): DexStatsDto {
  const counted = rows.filter(
    (p) =>
      countsInDepthSums({
        staleQuote: isStaleQuote(p.snapshot.priceDeviationBps),
        health: p.score,
      }) && p.depth2Usd !== null,
  )
  return {
    dex,
    pools: DISCOVERED[dex],
    tracked: rows.length,
    scored: rows.length,
    rated: rows.filter((p) => p.score.rated).length,
    // As the API: the depth of a stale quote or a paused stock's pool stays out of the sum and the
    // count of pools it covers.
    depth2Usd: counted.reduce((sum, p) => sum + (p.depth2Usd ?? 0), 0),
    depthKnownPools: counted.length,
    volume24hUsd: sumKnown(rows.map((p) => p.volume24hUsd)),
    medianHealth: ratedMedian(rows),
  }
}

export interface MockOptions {
  /** Unix seconds used as "now"; defaults to the wall clock rounded down to 5 minutes. */
  now?: number
}

export function createMockClient(opts: MockOptions = {}): ApiClient {
  const now = opts.now ?? Math.floor(Date.now() / 1000 / 300) * 300
  const pools = SEEDS.map((seed) => buildPool(seed, now))
  const byId = new Map(pools.map((p) => [p.meta.id, p]))
  const summaries = pools.map(summarize)
  const mandates = mockMandates(now)
  const mmSamples = new Map(mandates.map((m) => [m.id, mockMmSamples(now, m)]))
  // The stock pools answer by id and on their stocks' pages, never in the generic lists.
  const stockWorld = createStockWorld(now)

  function find(id: string): MockPool {
    const pool = byId.get(id) ?? stockWorld.pools.get(id)
    if (!pool) throw new ApiError(404, 'pool not found')
    return pool
  }

  function findMandate(id: string) {
    const mandate = mandates.find((m) => m.id === id)
    if (!mandate) throw new ApiError(404, 'mandate not found')
    return mandate
  }

  function scorecardOf(id: string): ScorecardSummaryDto {
    const mandate = findMandate(id)
    return mockScorecard(mandate, mmSamples.get(id) ?? [], now)
  }

  function containing(address: string): PoolSummary[] {
    return summaries.filter(
      (s) => s.pool.token0.address === address || s.pool.token1.address === address,
    )
  }

  return {
    async health() {
      const poolCount = Object.values(DISCOVERED).reduce((a, b) => a + b, 0)
      return {
        ok: true,
        poolCount,
        trackedCount: pools.length,
        latestSnapshotAt: now,
        latestScoredAt: now,
        snapshotAgeSeconds: 0,
        latestBlock: LATEST_BLOCK,
        // The mock stands in for a live server; the mock badge and footer say it is mock data.
        source: 'live',
      }
    },
    async stats(): Promise<StatsResponse> {
      const byDex = DEXES.map((dex) =>
        dexStats(
          dex,
          pools.filter((p) => p.meta.dex === dex),
        ),
      )
      const totals = {
        pools: byDex.reduce((sum, row) => sum + row.pools, 0),
        tracked: byDex.reduce((sum, row) => sum + row.tracked, 0),
        scored: byDex.reduce((sum, row) => sum + row.scored, 0),
        rated: byDex.reduce((sum, row) => sum + row.rated, 0),
        depth2Usd: byDex.reduce((sum, row) => sum + row.depth2Usd, 0),
        depthKnownPools: byDex.reduce((sum, row) => sum + row.depthKnownPools, 0),
        volume24hUsd: sumKnown(byDex.map((row) => row.volume24hUsd)),
        medianHealth: ratedMedian(pools),
      }
      return { byDex, totals }
    },
    async pools(query: PoolsQuery = {}) {
      let items = summaries
      if (query.dex) items = items.filter((s) => s.pool.dex === query.dex)
      if (query.q) items = items.filter((s) => matchesQuery(s, query.q ?? ''))
      if (query.rated !== undefined) items = items.filter((s) => s.health.rated === query.rated)
      if (query.minVolume !== undefined) {
        const min = query.minVolume
        items = items.filter((s) => s.volume24hUsd !== null && s.volume24hUsd >= min)
      }
      items = sortSummaries(items, query.sort ?? 'health', query.dir ?? 'desc')
      return { items: page(items, query.limit, query.offset), total: items.length }
    },
    async pool(id: string): Promise<PoolDetail> {
      const p = find(id)
      return {
        pool: p.meta,
        tracked: true,
        latest: p.snapshot,
        score: p.score,
        gap: p.gap,
        persistence24h: p.persistence24h,
        persistence7d: p.persistence7d,
        volume24hUsd: p.volume24hUsd,
        scoredAt: now,
      }
    },
    async history(id: string, window: HistoryWindow = '24h') {
      const p = find(id)
      return buildHistory(historySeed(p), window, p.snapshot.timestamp)
    },
    async gaps(query: GapsQuery = {}) {
      const minVolumeUsd = query.minVolume ?? GAP_FEED_MIN_VOLUME_USD
      const ranked: GapItem[] = pools
        .filter((p) => (p.volume24hUsd ?? 0) >= minVolumeUsd && p.gap.gapScore !== null)
        // As the API: equal scores (100 from 100× up) go by turnover, highest first.
        .sort(
          (a, b) =>
            (b.gap.gapScore ?? 0) - (a.gap.gapScore ?? 0) ||
            (b.gap.turnoverRatio ?? 0) - (a.gap.turnoverRatio ?? 0),
        )
        .map((p) => ({ pool: summarize(p), gap: p.gap }))
      return {
        items: page(ranked, query.limit, query.offset),
        total: ranked.length,
        meaningful: ranked.filter((item) => isMeaningfulGap(item.gap)).length,
        minVolumeUsd,
      }
    },
    async token(address: string, query: TokenQuery = {}): Promise<TokenDetail> {
      const needle = address.trim().toLowerCase()
      if (!ADDRESS_RE.test(needle)) {
        throw new ApiError(400, 'invalid token address: expected 0x + 40 hex chars')
      }
      const stockKey = stockTokenKey(needle)
      const entry =
        stockKey === undefined
          ? Object.entries(TOKENS).find(([, t]) => t.address.toLowerCase() === needle)
          : ([stockKey, STOCK_TOKENS[stockKey]] as const)
      if (!entry?.[1]) throw new ApiError(404, 'token not found')
      const [symbol, seed] = entry
      const holding = stockWorld.tokenPools(needle) ?? containing(needle)
      const inPools = sortSummaries(holding, query.sort ?? 'depth', query.dir ?? 'desc')
      // A token's depth leaves stale quotes and paused stocks' pools out, as the stats do.
      const depths = inPools.filter(countsInDepthSums).map((p) => p.depth2Usd)
      return {
        token: tokenInfo(symbol, stockKey === undefined ? TOKENS : STOCK_TOKENS),
        usd: seed.usd > 0 ? seed.usd : null,
        via: seed.via,
        priceUpdatedAt: now,
        pools: page(inPools, query.limit, query.offset),
        total: inPools.length,
        poolCount: inPools.length,
        depth2UsdTotal: sumKnown(depths),
        depthKnownPools: depths.filter((d) => d !== null).length,
      }
    },
    async scorecards(query: ScorecardsQuery = {}) {
      let items = mandates
      if (query.pool !== undefined) items = items.filter((m) => m.poolId === query.pool)
      if (query.active !== undefined) items = items.filter((m) => m.active === query.active)
      return { items: items.map((m) => scorecardOf(m.id)).sort(compareScorecards) }
    },
    async scorecard(id: string): Promise<ScorecardDetail> {
      const summary = scorecardOf(id)
      return {
        ...summary,
        pool: summaries.find((s) => s.pool.id === summary.mandate.poolId) ?? null,
      }
    },
    async scorecardSamples(id: string, query: SamplesQuery = {}): Promise<SamplesResponse> {
      const window = query.window ?? '7d'
      if (!SAMPLE_WINDOWS.includes(window)) {
        throw new ApiError(400, `invalid query: window: Invalid enum value '${window}'`, [
          { path: 'window', message: `Invalid enum value '${window}'` },
        ])
      }
      const limit = Math.min(
        MAX_SAMPLES_LIMIT,
        Math.max(1, Math.floor(query.limit ?? MAX_SAMPLES_LIMIT)),
      )
      findMandate(id)
      const to = now
      const from = to - SAMPLE_WINDOW_HOURS[window] * 3600
      const series = (mmSamples.get(id) ?? []).filter(
        (s) => s.timestamp >= from && s.timestamp <= to,
      )
      // Ascending series; when it overflows the limit the newest samples are the ones that matter.
      const points = series.length > limit ? series.slice(series.length - limit) : series
      return { window, from, to, points: points.map((sample) => toJsonSafe(sample)) }
    },
    async badge(id: string) {
      return renderBadge(scorecardOf(id))
    },
    async stocks() {
      return stockWorld.stocks()
    },
    async stock(address: string) {
      return stockWorld.stock(address)
    },
  }
}
