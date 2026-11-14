/**
 * TanStack Query hooks, one per endpoint. Query keys are namespaced by endpoint and parameters.
 */
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { shippedMandates } from '../lib/shipped.js'
import { useApi, useIsMock, useIsStatic } from './context.js'
import type {
  GapsQuery,
  HistoryWindow,
  PoolMetaDto,
  PoolsQuery,
  SampleWindow,
  ScorecardsQuery,
  TokenQuery,
} from './types.js'

export const HEALTH_REFETCH_MS = 60_000

/**
 * `GET /api/health`, polled once a minute. When a poll finds new data, every other query is marked
 * stale and the mounted ones refetch in place, so an open page never shows a newer "Updated … ago"
 * over rows from an older pass. New data is a newer snapshot (`latestSnapshotAt`) or a newer score
 * (`latestScoredAt`): a pass stores its snapshots first and its scores (health, gap, 24 h volume)
 * at its end, so a poll between the two refetches once more after the scores land. The HTTP
 * client revalidates every fetch (`cache: 'no-cache'`), so a refetch is never answered from a
 * copy the browser holds from before. The mock and the static build never take a new snapshot,
 * so they skip it.
 */
export function useHealth() {
  const api = useApi()
  const qc = useQueryClient()
  const staticBuild = useIsStatic()
  const mock = useIsMock()
  const follows = !staticBuild && !mock
  const query = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: HEALTH_REFETCH_MS,
  })
  const at = query.data && `${query.data.latestSnapshotAt}:${query.data.latestScoredAt}`
  const seen = useRef(at)
  useEffect(() => {
    if (at === undefined) return
    const before = seen.current
    seen.current = at
    if (follows && before !== undefined && before !== at)
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'health' })
  }, [at, follows, qc])
  return query
}

export function useStats() {
  const api = useApi()
  return useQuery({ queryKey: ['stats'], queryFn: () => api.stats() })
}

export function usePools(query: PoolsQuery) {
  const api = useApi()
  return useQuery({
    queryKey: ['pools', query],
    queryFn: () => api.pools(query),
    placeholderData: keepPreviousData,
  })
}

export function usePool(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['pool', id],
    queryFn: () => api.pool(id),
    enabled: id.length > 0,
  })
}

/**
 * The observatory's metadata (pair, DEX, fee) of each pool in `ids`, by id: one `GET
 * /api/pools/:id` per distinct id, sharing the pool page's cache. Pools the observatory does not
 * know (404) or that are still loading are absent, so callers keep a fallback for them.
 */
export function usePoolMetas(ids: readonly string[]): ReadonlyMap<string, PoolMetaDto> {
  const api = useApi()
  const distinct = [...new Set(ids)].filter((id) => id.length > 0)
  return useQueries({
    queries: distinct.map((id) => ({
      queryKey: ['pool', id],
      queryFn: () => api.pool(id),
    })),
    combine: (results) => {
      const metas = new Map<string, PoolMetaDto>()
      for (const [i, result] of results.entries()) {
        const id = distinct[i]
        if (id !== undefined && result.data) metas.set(id, result.data.pool)
      }
      return metas
    },
  })
}

export function usePoolHistory(id: string, window: HistoryWindow) {
  const api = useApi()
  return useQuery({
    queryKey: ['pool', id, 'history', window],
    queryFn: () => api.history(id, window),
    enabled: id.length > 0,
    placeholderData: keepPreviousData,
  })
}

export function useGaps(query: GapsQuery) {
  const api = useApi()
  return useQuery({ queryKey: ['gaps', query], queryFn: () => api.gaps(query) })
}

export function useToken(address: string, query: TokenQuery = {}) {
  const api = useApi()
  return useQuery({
    queryKey: ['token', address, query],
    queryFn: () => api.token(address, query),
    enabled: address.length > 0,
    placeholderData: keepPreviousData,
  })
}

/** `GET /api/mm`: every scorecard, active first then by name. */
export function useScorecards(query: ScorecardsQuery = {}) {
  const api = useApi()
  return useQuery({
    queryKey: ['mm', query],
    queryFn: () => api.scorecards(query),
    placeholderData: keepPreviousData,
  })
}

/**
 * Whether the site lists the scorecards (the nav's tab, Home's block): once the list of mandates
 * holds one. Until it answers, a static build goes by the bundle it was built with
 * (`lib/shipped.ts`), as the header in index.html does, and a server by having them, so a site
 * with mandates never moves its tabs.
 */
export function useMandatesListed(): boolean {
  const list = useScorecards()
  return list.data ? list.data.items.length > 0 : (shippedMandates() ?? true)
}

/** `GET /api/mm/:id`. */
export function useScorecard(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['mm', id],
    queryFn: () => api.scorecard(id),
    enabled: id.length > 0,
  })
}

/** `GET /api/mm/:id/samples?window=`: the whole window (the API's default limit). */
export function useScorecardSamples(id: string, window: SampleWindow) {
  const api = useApi()
  return useQuery({
    queryKey: ['mm', id, 'samples', window],
    queryFn: () => api.scorecardSamples(id, { window }),
    enabled: id.length > 0,
    placeholderData: keepPreviousData,
  })
}

/** `GET /api/stocks`: every stock of the stock list, deepest first (read only when `enabled`). */
export function useStocks(enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: ['stocks'], queryFn: () => api.stocks(), enabled })
}

/** `GET /api/stocks/:token`, keyed by the lowercase address. */
export function useStock(address: string) {
  const api = useApi()
  const token = address.toLowerCase()
  return useQuery({
    queryKey: ['stock', token],
    queryFn: () => api.stock(token),
    enabled: token.length > 0,
  })
}

/** `GET /api/mm/:id/badge.svg` as text, for the embed preview. */
export function useBadge(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['mm', id, 'badge'],
    queryFn: () => api.badge(id),
    enabled: id.length > 0,
  })
}
