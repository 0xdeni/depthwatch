/**
 * HTTP client for `/api` plus startup mode resolution (live vs mock).
 *
 * Responses are used as-is: `types.ts` mirrors the API's DTOs exactly, so nothing is normalised
 * on the way in. Non-2xx responses become `ApiError`s carrying the API's `{ error, issues? }`.
 */
import { ApiError, ApiUnavailableError } from './errors.js'
import type { StockDetail, StocksResponse } from './stockTypes.js'
import type {
  ApiClient,
  ErrorIssue,
  GapsQuery,
  GapsResponse,
  HealthResponse,
  HistoryResponse,
  HistoryWindow,
  PoolDetail,
  PoolsQuery,
  PoolsResponse,
  SamplesQuery,
  SamplesResponse,
  ScorecardDetail,
  ScorecardsQuery,
  ScorecardsResponse,
  StatsResponse,
  TokenDetail,
  TokenQuery,
} from './types.js'

export { ApiError, ApiUnavailableError } from './errors.js'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface HttpClientOptions {
  baseUrl?: string
  fetchFn?: FetchLike
}

type QueryParams = Record<string, string | number | boolean | undefined>

/** Query string from params, in insertion order; undefined and empty values are omitted. */
export function buildQuery(params: QueryParams | undefined): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/**
 * Path of a pool resource. Pool ids contain `:` (`uniswap-v3:0x…`, `uniswap-v4:0x…`), so the id
 * is percent-encoded to stay one path segment through every proxy and router; the API decodes it.
 */
export function poolPath(id: string): string {
  return `/pools/${encodeURIComponent(id)}`
}

/** Path of a token resource; the API lowercases too, but lowercase here keeps cache keys stable. */
export function tokenPath(address: string): string {
  return `/tokens/${encodeURIComponent(address.trim().toLowerCase())}`
}

/** Path of a stock resource, lowercased like `tokenPath`: the address is the stock's identity. */
export function stockPath(address: string): string {
  return `/stocks/${encodeURIComponent(address.trim().toLowerCase())}`
}

/** Path of a scorecard resource. Mandate ids are slugs; encoding keeps a stray id harmless. */
export function mmPath(id: string): string {
  return `/mm/${encodeURIComponent(id)}`
}

/** Path of the scorecard badge, relative to the API base (`/api/mm/:id/badge.svg`). */
export function badgePath(id: string): string {
  return `${mmPath(id)}/badge.svg`
}

function isIssue(value: unknown): value is ErrorIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { path?: unknown }).path === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}

/** Reads the API's `{ error, issues? }` body; falls back to the status line for non-JSON bodies. */
async function toApiError(res: Response): Promise<ApiError> {
  const fallback = `${res.status} ${res.statusText}`.trim()
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const { error, issues } = body as { error: unknown; issues?: unknown }
      if (typeof error === 'string') {
        return new ApiError(res.status, error, Array.isArray(issues) ? issues.filter(isIssue) : [])
      }
    }
  } catch {
    // body was not JSON; fall through
  }
  return new ApiError(res.status, fallback)
}

export function createHttpClient(opts: HttpClientOptions = {}): ApiClient {
  const base = (opts.baseUrl ?? '/api').replace(/\/$/, '')
  const fetchFn: FetchLike = opts.fetchFn ?? ((input, init) => fetch(input, init))

  // `no-cache`: the browser revalidates every request (a bodiless 304 by ETag when nothing changed)
  // instead of answering from a copy it holds under the API's `max-age`, so a refetch after a new
  // snapshot or score never gets the rows from before it.
  async function get<T>(path: string, params?: QueryParams): Promise<T> {
    const res = await fetchFn(`${base}${path}${buildQuery(params)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-cache',
    })
    if (!res.ok) throw await toApiError(res)
    return (await res.json()) as T
  }

  /** Like `get` for a text body (the badge SVG); errors are still the API's JSON bodies. */
  async function getText(path: string, accept: string): Promise<string> {
    const res = await fetchFn(`${base}${path}`, { headers: { accept }, cache: 'no-cache' })
    if (!res.ok) throw await toApiError(res)
    return await res.text()
  }

  return {
    health: () => get<HealthResponse>('/health'),
    stats: () => get<StatsResponse>('/stats'),
    pools: (query: PoolsQuery = {}) =>
      get<PoolsResponse>('/pools', {
        sort: query.sort,
        dir: query.dir,
        dex: query.dex,
        q: query.q,
        minVolume: query.minVolume,
        rated: query.rated,
        limit: query.limit,
        offset: query.offset,
      }),
    pool: (id: string) => get<PoolDetail>(poolPath(id)),
    history: (id: string, window: HistoryWindow = '24h') =>
      get<HistoryResponse>(`${poolPath(id)}/history`, { window }),
    gaps: (query: GapsQuery = {}) =>
      get<GapsResponse>('/gaps', {
        limit: query.limit,
        offset: query.offset,
        minVolume: query.minVolume,
      }),
    token: (address: string, query: TokenQuery = {}) =>
      get<TokenDetail>(tokenPath(address), {
        sort: query.sort,
        dir: query.dir,
        limit: query.limit,
        offset: query.offset,
      }),
    scorecards: (query: ScorecardsQuery = {}) =>
      get<ScorecardsResponse>('/mm', { pool: query.pool, active: query.active }),
    scorecard: (id: string) => get<ScorecardDetail>(mmPath(id)),
    scorecardSamples: (id: string, query: SamplesQuery = {}) =>
      get<SamplesResponse>(`${mmPath(id)}/samples`, { window: query.window, limit: query.limit }),
    badge: (id: string) => getText(badgePath(id), 'image/svg+xml'),
    stocks: () => get<StocksResponse>('/stocks'),
    stock: (address: string) => get<StockDetail>(stockPath(address)),
  }
}

/** What a probe of `/api/health` found. */
export interface HealthProbe {
  /** `/api/health` answered 2xx within the timeout. */
  reachable: boolean
  /** The body of that answer; null when unreachable or when the body is not a JSON object. */
  health: HealthResponse | null
}

/** Probes `/api/health` once, keeping its body (the data source and newest snapshot). Never throws. */
export async function probeHealth(
  fetchFn: FetchLike = (input, init) => fetch(input, init),
  baseUrl = '/api',
  timeoutMs = 2500,
): Promise<HealthProbe> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/$/, '')}/health`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) return { reachable: false, health: null }
    let health: HealthResponse | null = null
    try {
      const body: unknown = await res.json()
      if (typeof body === 'object' && body !== null) health = body as HealthResponse
    } catch {
      // reachable, but the body is not JSON: nothing to learn about the data
    }
    return { reachable: true, health }
  } catch {
    return { reachable: false, health: null }
  } finally {
    clearTimeout(timer)
  }
}

/** True when `/api/health` answers 2xx within `timeoutMs`. Never throws. */
export async function probeApi(
  fetchFn: FetchLike = (input, init) => fetch(input, init),
  baseUrl = '/api',
  timeoutMs = 2500,
): Promise<boolean> {
  return (await probeHealth(fetchFn, baseUrl, timeoutMs)).reachable
}

/** What the data is, as the dashboard needs to know it before the first page renders. */
export interface DataMode {
  /** The synthetic demo world (`source: 'demo'`): demo banner, "synthetic" tags, footer line. */
  demo: boolean
  /**
   * The demo world's clock (unix seconds) for "… ago" texts: its newest snapshot, which is the
   * clock the demo server answers with. Null means the wall clock (live data).
   */
  dataNow: number | null
}

/** The data mode a health answer describes; live (wall clock) unless it says `source: 'demo'`. */
export function dataModeOf(
  health: Pick<HealthResponse, 'source' | 'latestSnapshotAt'> | null | undefined,
): DataMode {
  if (health?.source !== 'demo') return { demo: false, dataNow: null }
  return { demo: true, dataNow: health.latestSnapshotAt ?? null }
}

export interface ResolvedClient extends DataMode {
  client: ApiClient
  mock: boolean
  /**
   * Why mock mode was chosen; null when live: `env` is `VITE_MOCK=1`, `unreachable` is the
   * development server's fallback when `/api/health` did not answer (never in a production build).
   */
  reason: 'env' | 'unreachable' | null
}

export interface ResolveOptions {
  forceMock?: boolean
  /**
   * Whether the mock may stand in when `/api/health` does not answer. Defaults to
   * `import.meta.env.DEV`: only the Vite dev server falls back, a production build never does.
   */
  allowMockFallback?: boolean
  fetchFn?: FetchLike
  baseUrl?: string
  timeoutMs?: number
  /** Lazily loaded; the default import exists only in the dev server and in `VITE_MOCK=1` builds. */
  loadMock?: () => Promise<ApiClient>
}

const defaultLoadMock = async (): Promise<ApiClient> => {
  // Both conditions are replaced by literals at build time, so a production build drops this
  // import and the mock JSON behind it (docs/design/web-v2.md §4: nothing made-up in dist).
  if (import.meta.env.DEV || import.meta.env.VITE_MOCK === '1') {
    const mod = await import('./mock.js')
    return mod.createMockClient()
  }
  throw new ApiUnavailableError('The mock data is not part of this build.')
}

const MOCK_MODE: DataMode = { demo: false, dataNow: null }

/**
 * Pick the client for this session: `VITE_MOCK=1` forces the mock; otherwise probe `/api/health`.
 * An API that does not answer falls back to the mock only in the Vite dev server
 * (`allowMockFallback`, default `import.meta.env.DEV`); anywhere else this throws
 * `ApiUnavailableError`, so a production dashboard shows the "not answering" page and never
 * made-up pools. The probe's answer also says whether the server runs the synthetic demo world
 * (`source: 'demo'`), like `bundle.source` in the static build.
 */
export async function resolveClient(opts: ResolveOptions = {}): Promise<ResolvedClient> {
  const forceMock = opts.forceMock ?? import.meta.env.VITE_MOCK === '1'
  const allowMockFallback = opts.allowMockFallback ?? import.meta.env.DEV
  const loadMock = opts.loadMock ?? defaultLoadMock
  if (forceMock) return { client: await loadMock(), mock: true, reason: 'env', ...MOCK_MODE }
  const probe = await probeHealth(opts.fetchFn, opts.baseUrl, opts.timeoutMs)
  if (!probe.reachable) {
    if (!allowMockFallback) throw new ApiUnavailableError()
    return { client: await loadMock(), mock: true, reason: 'unreachable', ...MOCK_MODE }
  }
  return {
    client: createHttpClient({ baseUrl: opts.baseUrl, fetchFn: opts.fetchFn }),
    mock: false,
    reason: null,
    ...dataModeOf(probe.health),
  }
}
