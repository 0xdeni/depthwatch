/**
 * The Pools explorer's URL state (ia-v3 §2, docs/design/visual-v4.md §6.3): `q`, `sort`, `dir`,
 * `dex`, `cols`, `page`, `rated` (only the rated pools), `unrated` (pages of unrated pools opened
 * behind "Show N unrated pools") and `rows` (`all`: every loaded rated row on a phone, where the
 * list shows 25 at first). Defaults are left out of the URL and every change replaces the entry
 * instead of pushing one. v2 links keep their meaning (`?sort=depth&dir=asc`, `?dex=aerodrome-v2`,
 * `?q=weth`). The sort keys, columns and order are the shared pools table's (lib/poolsTable.ts);
 * the API orders by every key.
 */
import { DEXES, type Dex, POOL_QUERY_MAX_LENGTH } from '@depthwatch/core'
import type { SortDir } from '../../api/types.js'
import { count } from '../../lib/format.js'
import {
  colsParam,
  defaultDir,
  type OptionalColumn,
  type PoolsSortKey,
  readTableState,
} from '../../lib/poolsTable.js'

export interface PoolsState {
  q: string
  sort: PoolsSortKey
  dir: SortDir
  dex: Dex | ''
  cols: OptionalColumn[]
  /** Pages of 50 shown (TB8), from 1. */
  page: number
  /** "Rated only": the pools with no grade are not offered at all. */
  ratedOnly: boolean
  /** Pages of 50 unrated pools shown after the rated ones; 0 keeps them behind "Show N unrated pools". */
  unrated: number
  /** `rows=all`: a phone shows every loaded rated row instead of the first 25. */
  allRows: boolean
}

export const PAGE_SIZE = 50
/** Rated rows a phone shows before "Show all 50 rated pools" (§5.8). */
export const PHONE_PAGE = 25
export const DEFAULT_SORT: PoolsSortKey = 'health'

export function readPoolsState(params: URLSearchParams): PoolsState {
  const rawDex = params.get('dex') ?? ''
  const dex = (DEXES as readonly string[]).includes(rawDex) ? (rawDex as Dex) : ''
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const unrated = Number.parseInt(params.get('unrated') ?? '', 10)
  const ratedOnly = params.get('rated') === '1'
  return {
    // The API takes 200 characters: a pasted pool link with tracking parameters is cut to them,
    // which keeps its id, instead of failing the whole list.
    q: (params.get('q') ?? '').slice(0, POOL_QUERY_MAX_LENGTH),
    ...readTableState(params, DEFAULT_SORT),
    dex,
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 100) : 1,
    ratedOnly,
    unrated: !ratedOnly && Number.isFinite(unrated) && unrated > 0 ? Math.min(unrated, 100) : 0,
    allRows: params.get('rows') === 'all',
  }
}

/** `params` with `patch` applied, defaults left out; a new query, filter or order resets the page. */
export function writePoolsState(
  params: URLSearchParams,
  patch: Partial<PoolsState>,
): URLSearchParams {
  const cur = readPoolsState(params)
  const next: PoolsState = { ...cur, ...patch }
  const reorders = ['q', 'sort', 'dir', 'dex', 'ratedOnly'].some((k) => k in patch)
  if (patch.page === undefined && reorders) next.page = 1
  // A new order or filter keeps the unrated pools open, from their first page; "Rated only"
  // closes them.
  if (patch.unrated === undefined && reorders) next.unrated = Math.min(next.unrated, 1)
  if (next.ratedOnly) next.unrated = 0
  const out = new URLSearchParams(params)
  const put = (key: string, value: string, fallback = '') => {
    if (value && value !== fallback) out.set(key, value)
    else out.delete(key)
  }
  put('q', next.q)
  put('sort', next.sort, DEFAULT_SORT)
  put('dir', next.dir, defaultDir(next.sort))
  put('dex', next.dex)
  put('cols', colsParam(next.cols))
  put('page', next.page > 1 ? String(next.page) : '')
  put('rated', next.ratedOnly ? '1' : '')
  put('unrated', next.unrated > 0 ? String(next.unrated) : '')
  put('rows', next.allRows ? 'all' : '')
  return out
}

/**
 * The rated rows a phone shows (§5.8): the first 25 until the reader asks for all of them, and
 * every loaded row once the unrated pools are open, so they always follow the last rated one.
 * Desktop shows every loaded row (pages of 50).
 */
export function visibleRows<T>(
  rows: readonly T[],
  { phone, allRows, unratedOpen }: { phone: boolean; allRows: boolean; unratedOpen: boolean },
): T[] {
  if (!phone || allRows || unratedOpen) return [...rows]
  return rows.slice(0, PHONE_PAGE)
}

/**
 * The phone's "show all" button: "Show all 50 rated pools" when every rated pool the list can show
 * is loaded, otherwise the loaded rows behind it ("Show 25 more pools"); then the pages take over.
 */
export function showAllRowsLabel(loaded: number, everyRow: boolean): string {
  if (everyRow) return `Show all ${count(loaded)} rated ${loaded === 1 ? 'pool' : 'pools'}`
  const more = loaded - PHONE_PAGE
  return `Show ${count(more)} more ${more === 1 ? 'pool' : 'pools'}`
}
