/**
 * What each route reads first, keyed exactly as its page asks for it (docs/design/visual-v3.md §4
 * row 6, §5.12 ST1). The shell prefetches these on intent (a pointer resting on a link, pointer
 * down, keyboard focus) and, for a pointer click, waits for them briefly before it lets the route
 * commit, so the route cross-fade lands on a populated page instead of an empty one. The cache
 * readers give a cold page its title block at once from what other screens already loaded.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { StockSummary, StocksResponse } from './api/stockTypes.js'
import type {
  ApiClient,
  GapsResponse,
  PoolDetail,
  PoolSummary,
  PoolsResponse,
  ScorecardDetail,
  ScorecardSummaryDto,
  ScorecardsResponse,
  TokenDetail,
} from './api/types.js'
import { readPoolsState } from './pages/lists/poolsState.js'
import { poolsPageQuery } from './pages/lists/usePoolRows.js'
import { readTableState, tokenQuery } from './pages/token/tokenSort.js'

export interface RouteQuery {
  queryKey: readonly unknown[]
  queryFn: () => Promise<unknown>
}

/** The pathname and query of an in-app href, for either router ("/pools" or "#/pools"). */
export function hrefTarget(href: string): { pathname: string; params: URLSearchParams } | null {
  const path = href.startsWith('#/') ? href.slice(1) : href
  if (!path.startsWith('/') || path.startsWith('//')) return null
  const url = new URL(path, 'http://depthwatch.invalid')
  return { pathname: url.pathname, params: url.searchParams }
}

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** The queries a route's first view needs, or [] for a route that reads nothing up front. */
export function routeQueries(href: string, api: ApiClient): RouteQuery[] {
  const target = hrefTarget(href)
  if (!target) return []
  const { pathname, params } = target
  const pool = pathname.match(/^\/pools\/([^/]+)$/)
  if (pool?.[1]) {
    const id = decode(pool[1])
    return [{ queryKey: ['pool', id], queryFn: () => api.pool(id) }]
  }
  const token = pathname.match(/^\/tokens\/([^/]+)$/)
  if (token?.[1]) {
    const address = decode(token[1]).toLowerCase()
    const query = tokenQuery(readTableState(params))
    return [{ queryKey: ['token', address, query], queryFn: () => api.token(address, query) }]
  }
  const stock = pathname.match(/^\/stocks\/([^/]+)$/)
  if (stock?.[1]) {
    const address = decode(stock[1]).toLowerCase()
    return [{ queryKey: ['stock', address], queryFn: () => api.stock(address) }]
  }
  const mm = pathname.match(/^\/mm\/([^/]+)$/)
  if (mm?.[1]) {
    const id = decode(mm[1])
    return [
      { queryKey: ['mm', id], queryFn: () => api.scorecard(id) },
      {
        queryKey: ['mm', id, 'samples', '30d'],
        queryFn: () => api.scorecardSamples(id, { window: '30d' }),
      },
    ]
  }
  if (pathname === '/pools') {
    const query = poolsPageQuery(readPoolsState(params), 0)
    return [
      { queryKey: ['stats'], queryFn: () => api.stats() },
      { queryKey: ['pools', query], queryFn: () => api.pools(query) },
    ]
  }
  if (pathname === '/gaps') {
    const query = { limit: 100 }
    return [{ queryKey: ['gaps', query], queryFn: () => api.gaps(query) }]
  }
  if (pathname === '/stocks') {
    return [{ queryKey: ['stocks'], queryFn: () => api.stocks() }]
  }
  if (pathname === '/mm') {
    return [{ queryKey: ['mm', {}], queryFn: () => api.scorecards({}) }]
  }
  return []
}

/** The route's queries that have no data in the cache yet. */
export function missingQueries(qc: QueryClient, queries: readonly RouteQuery[]): RouteQuery[] {
  return queries.filter((q) => qc.getQueryData(q.queryKey) === undefined)
}

/** Every pool summary the cache holds: pool lists, token pages, the gap feed, scorecards. */
function cachedSummaries(qc: QueryClient): PoolSummary[] {
  const out: PoolSummary[] = []
  for (const [, data] of qc.getQueriesData<PoolsResponse>({ queryKey: ['pools'] }))
    if (data?.items) out.push(...data.items)
  for (const [, data] of qc.getQueriesData<TokenDetail>({ queryKey: ['token'] }))
    if (data?.pools) out.push(...data.pools)
  for (const [, data] of qc.getQueriesData<GapsResponse>({ queryKey: ['gaps'] }))
    if (data?.items) out.push(...data.items.map((g) => g.pool))
  return out
}

/** A pool's summary from any list already loaded, for its title block while its page loads. */
export function cachedPoolSummary(qc: QueryClient, id: string): PoolSummary | undefined {
  return cachedSummaries(qc).find((p) => p.pool.id === id)
}

/** A token's symbol and name from any pool already loaded. */
export function cachedToken(qc: QueryClient, address: string): TokenDetail['token'] | undefined {
  const a = address.toLowerCase()
  for (const p of cachedSummaries(qc)) {
    if (p.pool.token0.address.toLowerCase() === a) return p.pool.token0
    if (p.pool.token1.address.toLowerCase() === a) return p.pool.token1
  }
  for (const [, data] of qc.getQueriesData<PoolDetail>({ queryKey: ['pool'] })) {
    const pool = data?.pool
    if (pool?.token0.address.toLowerCase() === a) return pool.token0
    if (pool?.token1.address.toLowerCase() === a) return pool.token1
  }
  return undefined
}

/**
 * A scorecard's title data from the scorecards list, with its pool's summary when that is
 * loaded too (the meta line names the pool's DEX and fee). Undefined when either is missing, so
 * the title never changes its words when the page's own data lands.
 */
export function cachedScorecard(qc: QueryClient, id: string): ScorecardDetail | undefined {
  let summary: ScorecardSummaryDto | undefined
  for (const [, data] of qc.getQueriesData<ScorecardsResponse>({ queryKey: ['mm'] })) {
    summary = data?.items?.find((s) => s.mandate.id === id)
    if (summary) break
  }
  if (!summary) return undefined
  const pool = cachedPoolSummary(qc, summary.mandate.poolId)
  return pool ? { ...summary, pool } : undefined
}

/** A stock's summary from the stocks list already loaded, for its title block while it loads. */
export function cachedStock(qc: QueryClient, address: string): StockSummary | undefined {
  const a = address.toLowerCase()
  return qc
    .getQueryData<StocksResponse>(['stocks'])
    ?.items.find((s) => s.stock.token.address.toLowerCase() === a)
}
