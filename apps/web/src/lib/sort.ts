import type { PoolSort, PoolSummary, SortDir } from '../api/types.js'

/** The numeric value a sort key reads from a summary; null sorts last in either direction. */
export function sortValue(item: PoolSummary, sort: PoolSort): number | null {
  switch (sort) {
    case 'health':
      return item.health.total
    case 'depth':
      return item.depth2Usd
    case 'volume':
      return item.volume24hUsd
    case 'gap':
      return item.gapScore
    case 'tvl':
      return item.tvlUsd
    case 'spread':
      return item.spread10kBps
    case 'top':
      return item.ownerTop1Share
  }
}

/**
 * Stable sort of summaries (used by the mock client, the static client and client-side tables),
 * ordered like the API: nulls last in both directions; when sorting by health the unrated pools
 * come after every rated one, and when sorting by depth the stale quotes after the others, in both
 * directions, each group by its value.
 */
export function sortSummaries(
  items: readonly PoolSummary[],
  sort: PoolSort,
  dir: SortDir,
): PoolSummary[] {
  const sign = dir === 'asc' ? 1 : -1
  const last = (item: PoolSummary) =>
    (sort === 'health' && !item.health.rated) || (sort === 'depth' && item.staleQuote) ? 1 : 0
  return items
    .map((item, index) => ({ item, index, value: sortValue(item, sort), last: last(item) }))
    .sort((a, b) => {
      if (a.last !== b.last) return a.last - b.last
      if (a.value === null && b.value === null) return a.index - b.index
      if (a.value === null) return 1
      if (b.value === null) return -1
      if (a.value !== b.value) return (a.value - b.value) * sign
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

/**
 * The API's `q` filter (`matchesPoolQuery`, core's rule): every term of the query matches either
 * token, the pool or the DEX, so the mock client and the Pools field agree with the API.
 */
export { matchesPoolQuery as matchesQuery } from './poolQuery.js'
