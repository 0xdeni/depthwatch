/**
 * Query validation of the static client, mirroring `apps/api/src/query.ts` (zod) message for
 * message, so a bad parameter fails with the same 400 body (`invalid query: <path>: <message>`
 * plus `issues`) the server sends.
 *
 * Every parameter goes through what the HTTP client would put on the wire first: undefined and
 * `''` are omitted (`buildQuery`), anything else becomes `String(value)`; then, like the API,
 * blank values count as absent and the schema's defaults apply.
 */
import { DEXES, type Dex, POOL_QUERY_MAX_LENGTH } from '@depthwatch/core'
import { ApiError } from './errors.js'
import type {
  ErrorIssue,
  GapsQuery,
  HistoryWindow,
  PoolSort,
  PoolsQuery,
  SamplesQuery,
  SampleWindow,
  ScorecardsQuery,
  SortDir,
  TokenQuery,
} from './types.js'
import { HISTORY_WINDOWS, MAX_SAMPLES_LIMIT, POOL_SORTS, SAMPLE_WINDOWS } from './types.js'

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200
const SORT_DIRS: readonly SortDir[] = ['asc', 'desc']

type Wire = string | number | boolean | null | undefined

/** What reaches the API for one parameter: undefined when the HTTP client would omit it. */
function onWire(value: Wire): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return String(value)
}

/** The API's `emptyToUndefined`: blank strings are absent. */
function present(value: Wire): string | undefined {
  const raw = onWire(value)
  return raw === undefined || raw.trim() === '' ? undefined : raw
}

/** Collects issues in schema order and throws the API's 400 when there are any. */
class Issues {
  readonly list: ErrorIssue[] = []

  add(path: string, message: string): void {
    this.list.push({ path, message })
  }

  throwIfAny(): void {
    if (this.list.length === 0) return
    const summary = this.list.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    throw new ApiError(400, `invalid query: ${summary}`, this.list)
  }
}

/** `z.enum(options).optional()` after the blank check: undefined when absent or invalid. */
function optionalEnum<T extends string>(
  issues: Issues,
  path: string,
  raw: string | undefined,
  options: readonly T[],
): T | undefined {
  if (raw === undefined) return undefined
  if ((options as readonly string[]).includes(raw)) return raw as T
  const expected = options.map((option) => `"${option}"`).join('|')
  issues.add(path, `Invalid option: expected one of ${expected}`)
  return undefined
}

/** `z.enum(options).default(fallback)` behind `emptyToUndefined`. */
function enumParam<T extends string>(
  issues: Issues,
  path: string,
  value: Wire,
  options: readonly T[],
  fallback: T,
): T {
  return optionalEnum(issues, path, present(value), options) ?? fallback
}

/** `z.coerce.number()`: NaN and ±Infinity are rejected before any other check. */
function coerceNumber(issues: Issues, path: string, raw: string): number | undefined {
  const n = Number(raw)
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    issues.add(path, `Invalid input: expected number, received ${String(n)}`)
    return undefined
  }
  return n
}

/** `z.coerce.number().int().min(min).max(max).default(fallback)`. */
function intParam(
  issues: Issues,
  path: string,
  value: Wire,
  bounds: { min: number; max?: number; fallback: number },
): number {
  const raw = present(value)
  if (raw === undefined) return bounds.fallback
  const n = coerceNumber(issues, path, raw)
  if (n === undefined) return bounds.fallback
  if (!Number.isInteger(n)) {
    issues.add(path, 'Invalid input: expected int, received number')
    return bounds.fallback
  }
  const before = issues.list.length
  if (n > Number.MAX_SAFE_INTEGER)
    issues.add(path, `Too big: expected int to be <=${Number.MAX_SAFE_INTEGER}`)
  if (n < -Number.MAX_SAFE_INTEGER)
    issues.add(path, `Too small: expected int to be >=-${Number.MAX_SAFE_INTEGER}`)
  if (n < bounds.min) issues.add(path, `Too small: expected number to be >=${bounds.min}`)
  if (bounds.max !== undefined && n > bounds.max)
    issues.add(path, `Too big: expected number to be <=${bounds.max}`)
  return issues.list.length === before ? n : bounds.fallback
}

/** Non-negative USD floor; absent means undefined. */
function usdParam(issues: Issues, path: string, value: Wire): number | undefined {
  const raw = present(value)
  if (raw === undefined) return undefined
  const n = coerceNumber(issues, path, raw)
  if (n === undefined) return undefined
  if (n < 0) {
    issues.add(path, 'Too small: expected number to be >=0')
    return undefined
  }
  return n
}

/** `z.string().trim().max(max)`, blank → undefined. */
function textParam(issues: Issues, path: string, value: Wire, max: number): string | undefined {
  const raw = onWire(value)
  if (raw === undefined) return undefined
  const text = raw.trim()
  if (text.length > max) {
    issues.add(path, `Too big: expected string to have <=${max} characters`)
    return undefined
  }
  return text === '' ? undefined : text
}

function paging(issues: Issues, query: { limit?: Wire; offset?: Wire }) {
  return {
    limit: intParam(issues, 'limit', query.limit, {
      min: 1,
      max: MAX_LIMIT,
      fallback: DEFAULT_LIMIT,
    }),
    offset: intParam(issues, 'offset', query.offset, { min: 0, fallback: 0 }),
  }
}

export interface ParsedPoolsQuery {
  sort: PoolSort
  dir: SortDir
  dex?: Dex
  q?: string
  minVolume?: number
  rated?: boolean
  limit: number
  offset: number
}

/** `boolParam`: the words true / false in any case; absent or blank means undefined. */
function boolParam(issues: Issues, path: string, value: Wire): boolean | undefined {
  const raw = present(value)?.trim().toLowerCase()
  const word = optionalEnum(issues, path, raw, ['true', 'false'] as const)
  return word === undefined ? undefined : word === 'true'
}

/** `poolsQuerySchema`: sort health, dir desc, limit 1..200 default 50, offset ≥ 0. */
export function parsePoolsQuery(query: PoolsQuery): ParsedPoolsQuery {
  const issues = new Issues()
  const sort = enumParam(issues, 'sort', query.sort, POOL_SORTS, 'health')
  const dir = enumParam(issues, 'dir', query.dir, SORT_DIRS, 'desc')
  const dex = optionalEnum(issues, 'dex', present(query.dex), DEXES)
  const q = textParam(issues, 'q', query.q, POOL_QUERY_MAX_LENGTH)
  const minVolume = usdParam(issues, 'minVolume', query.minVolume)
  const rated = boolParam(issues, 'rated', query.rated)
  const page = paging(issues, query)
  issues.throwIfAny()
  return { sort, dir, dex, q, minVolume, rated, ...page }
}

/** `gapsQuerySchema`: minVolume (no default here: the route applies the feed floor), paging. */
export function parseGapsQuery(query: GapsQuery): {
  minVolume?: number
  limit: number
  offset: number
} {
  const issues = new Issues()
  const minVolume = usdParam(issues, 'minVolume', query.minVolume)
  const page = paging(issues, query)
  issues.throwIfAny()
  return { minVolume, ...page }
}

/** `tokenQuerySchema`: sort depth, dir desc, paging. */
export function parseTokenQuery(query: TokenQuery): {
  sort: PoolSort
  dir: SortDir
  limit: number
  offset: number
} {
  const issues = new Issues()
  const sort = enumParam(issues, 'sort', query.sort, POOL_SORTS, 'depth')
  const dir = enumParam(issues, 'dir', query.dir, SORT_DIRS, 'desc')
  const page = paging(issues, query)
  issues.throwIfAny()
  return { sort, dir, ...page }
}

/** `historyQuerySchema`: window 24h | 7d, default 24h. */
export function parseHistoryWindow(window: Wire): HistoryWindow {
  const issues = new Issues()
  const parsed = enumParam(issues, 'window', window, HISTORY_WINDOWS, '24h')
  issues.throwIfAny()
  return parsed
}

/** `scorecardsQuerySchema`: pool (exact id, ≤ 200 chars) and active (`true` / `false`). */
export function parseScorecardsQuery(query: ScorecardsQuery): {
  pool?: string
  active?: boolean
} {
  const issues = new Issues()
  const pool = textParam(issues, 'pool', query.pool, 200)
  // `boolParam`: trimmed and lowercased before the blank check and the enum.
  const activeRaw = onWire(query.active)?.trim().toLowerCase()
  const activeWord = optionalEnum(issues, 'active', activeRaw || undefined, ['true', 'false'])
  issues.throwIfAny()
  return { pool, active: activeWord === undefined ? undefined : activeWord === 'true' }
}

/** `samplesQuerySchema`: window 24h | 7d | 30d (default 7d), limit 1..10 000 (default max). */
export function parseSamplesQuery(query: SamplesQuery): { window: SampleWindow; limit: number } {
  const issues = new Issues()
  const window = enumParam(issues, 'window', query.window, SAMPLE_WINDOWS, '7d')
  const limit = intParam(issues, 'limit', query.limit, {
    min: 1,
    max: MAX_SAMPLES_LIMIT,
    fallback: MAX_SAMPLES_LIMIT,
  })
  issues.throwIfAny()
  return { window, limit }
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/

/** The API's `parseAddress`: trimmed, lowercased, 0x + 40 hex chars; undefined otherwise. */
export function parseAddress(raw: string): string | undefined {
  const lower = raw.trim().toLowerCase()
  return ADDRESS_RE.test(lower) ? lower : undefined
}
