/**
 * Query-string validation with zod. Every schema reads the flat `Record<string, string>` Hono
 * gives for the query, treats empty values as absent, and applies DESIGN.md defaults
 * (limit 50 max 200, offset 0, sort health, dir desc).
 */
import { DEXES, poolQueryTerms } from '@depthwatch/core'
import { z } from 'zod'
import type { ErrorResponse } from './dto.js'

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

/** Sort keys of `/api/pools` and `/api/tokens/:address`: `spread` is `spread10kBps`, `top` `ownerTop1Share`. */
export const POOL_SORTS = ['health', 'depth', 'volume', 'gap', 'tvl', 'spread', 'top'] as const
export const SORT_DIRS = ['asc', 'desc'] as const
export const HISTORY_WINDOWS = ['24h', '7d'] as const
/** Scorecard sample windows (`GET /api/mm/:id/samples`), matching the uptime windows. */
export const SAMPLE_WINDOWS = ['24h', '7d', '30d'] as const
/** Most samples one `/samples` response carries (30 d at a 5-minute cadence is 8 640). */
export const MAX_SAMPLES_LIMIT = 10_000

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

/** Non-negative number parameter (e.g. a USD floor); absent or empty means undefined. */
const usdParam = z.preprocess(emptyToUndefined, z.coerce.number().min(0).finite().optional())

const limitParam = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
)

const offsetParam = z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).default(0))

const pagingSchema = { limit: limitParam, offset: offsetParam }

const sortingSchema = {
  sort: z.preprocess(emptyToUndefined, z.enum(POOL_SORTS).default('health')),
  dir: z.preprocess(emptyToUndefined, z.enum(SORT_DIRS).default('desc')),
}

/** `true` / `false` (the literal words, any case); absent or empty means undefined. */
const boolParam = z.preprocess(
  (value) => (typeof value === 'string' ? emptyToUndefined(value.trim().toLowerCase()) : value),
  z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
)

export const poolsQuerySchema = z.object({
  ...sortingSchema,
  /** `true` keeps only rated pools, `false` only unrated ones; both when absent. */
  rated: boolParam,
  dex: z.preprocess(emptyToUndefined, z.enum(DEXES).optional()),
  /**
   * Search terms, split on whitespace, "/", "-" and ":" (core's `poolQueryTerms`), every one
   * matching the pool, so "WETH/USDC" and "usdc weth" list the same pools. A query of separators
   * alone ("/") is no query.
   */
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value && poolQueryTerms(value).length > 0 ? value : undefined)),
  minVolume: usdParam,
  ...pagingSchema,
})
export type PoolsQuery = z.infer<typeof poolsQuerySchema>

export const healthQuerySchema = z.object({
  /** Seconds: answer 503 when the newest snapshot is older than this, or there is none. */
  maxAge: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
})
export type HealthQuery = z.infer<typeof healthQuerySchema>

export const historyQuerySchema = z.object({
  window: z.preprocess(emptyToUndefined, z.enum(HISTORY_WINDOWS).default('24h')),
})
export type HistoryQuery = z.infer<typeof historyQuerySchema>

export const gapsQuerySchema = z.object({
  minVolume: usdParam,
  ...pagingSchema,
})
export type GapsQuery = z.infer<typeof gapsQuerySchema>

export const tokenQuerySchema = z.object({
  sort: z.preprocess(emptyToUndefined, z.enum(POOL_SORTS).default('depth')),
  dir: z.preprocess(emptyToUndefined, z.enum(SORT_DIRS).default('desc')),
  ...pagingSchema,
})
export type TokenQuery = z.infer<typeof tokenQuerySchema>

export const scorecardsQuerySchema = z.object({
  /** Keep only the mandates of this pool id (exact match). */
  pool: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** Keep only active (true) or deactivated (false) mandates; both when absent. */
  active: boolParam,
})
export type ScorecardsQuery = z.infer<typeof scorecardsQuerySchema>

export const samplesQuerySchema = z.object({
  window: z.preprocess(emptyToUndefined, z.enum(SAMPLE_WINDOWS).default('7d')),
  limit: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(MAX_SAMPLES_LIMIT).default(MAX_SAMPLES_LIMIT),
  ),
})
export type SamplesQuery = z.infer<typeof samplesQuerySchema>

const ADDRESS_RE = /^0x[0-9a-f]{40}$/

/** The 400 body for a path address `parseAddress` rejects (`/api/tokens/:address`, `/api/stocks/:token`). */
export const INVALID_ADDRESS: ErrorResponse = Object.freeze({
  error: 'invalid token address: expected 0x + 40 hex chars',
})

/** The address lowercased (DESIGN.md rule 2), or undefined when it is not 0x + 40 hex chars. */
export function parseAddress(raw: string): `0x${string}` | undefined {
  const lower = raw.trim().toLowerCase()
  return ADDRESS_RE.test(lower) ? (lower as `0x${string}`) : undefined
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: ErrorResponse }

/** Validates a raw query record and shapes failures into a 400 body with a readable message. */
export function parseQuery<T>(schema: z.ZodType<T>, raw: Record<string, string>): ParseResult<T> {
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(query)',
    message: issue.message,
  }))
  const summary = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  return { ok: false, error: { error: `invalid query: ${summary}`, issues } }
}
