/**
 * Compression and cache headers (DESIGN.md "API (apps/api)"). Every response is gzip- or
 * deflate-compressed when the client accepts it (hono's `compress`) and carries an `ETag` that
 * answers a matching `If-None-Match` with a bodiless 304 (`etagFromBytes`), on `/api/*` and on
 * the dashboard files alike. `Cache-Control` says how long a copy may be reused: 30 s for API
 * reads (pool and stock data change at the pipeline's cadence, minutes apart), 60 s for a pool's
 * history (the most expensive read, which changes at the same cadence), never stated for
 * `/api/health` (a probe must see the server as it is), a year for the hashed `/assets/*` build
 * outputs (a new build is a new path; `index.html` answered there as the SPA fallback is not one)
 * and `no-cache` for `index.html` and the other dashboard files, which clients revalidate by
 * `ETag`.
 */
import { createHash } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { compress } from 'hono/compress'

/** Successful `GET /api/*` responses that set no `Cache-Control` of their own. */
export const API_CACHE_CONTROL = 'public, max-age=30'
/** `GET /api/pools/:id/history`: a week of points scored per request. */
export const HISTORY_CACHE_CONTROL = 'public, max-age=60'
/** The dashboard's hashed build outputs under `/assets/`. */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
/** `index.html` and every other dashboard file: always revalidated. */
export const STATIC_CACHE_CONTROL = 'no-cache'

const HEALTH_PATH = '/api/health'
const ASSETS_PREFIX = '/assets/'

function isRead(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

/**
 * `compress()` outside `etagFromBytes()`: the tag is computed over the uncompressed body, so it is
 * the same whatever the client accepts, and `compress` weakens it (`W/`) when it encodes the body.
 */
export function compressAndTag(): MiddlewareHandler[] {
  return [compress(), etagFromBytes()]
}

/** What a 304 keeps (RFC 9110 §15.4.5), as hono's `etag` does. */
const KEPT_ON_304: ReadonlySet<string> = new Set([
  'cache-control',
  'content-location',
  'date',
  'etag',
  'expires',
  'vary',
])

const stripWeak = (tag: string): string => tag.trim().replace(/^W\//, '')

function etagMatches(tag: string, ifNoneMatch: string | undefined): boolean {
  if (ifNoneMatch === undefined) return false
  if (ifNoneMatch.trim() === '*') return true
  return ifNoneMatch.split(',').some((candidate) => stripWeak(candidate) === stripWeak(tag))
}

/**
 * hono's `etag()` without `Response.clone()`: the body is read once into bytes, tagged with their
 * SHA-1 and the response rebuilt from them. On Node 22.13 and 22.14 (undici 6.21), a clone that is
 * garbage-collected before the original is read leaves the original unusable ("Body is unusable:
 * Body has already been read"), so any tagged response could fail when a collection ran between
 * the tag and the write.
 */
export function etagFromBytes(): MiddlewareHandler {
  return async (c, next) => {
    const ifNoneMatch = c.req.header('If-None-Match')
    await next()
    if (!isRead(c.req.method) || !c.res.ok) return
    let tag = c.res.headers.get('ETag')
    if (tag === null) {
      if (c.res.body === null) return
      const bytes = new Uint8Array(await c.res.arrayBuffer())
      tag = `"${createHash('sha1').update(bytes).digest('hex')}"`
      c.res = new Response(bytes, c.res)
    }
    if (etagMatches(tag, ifNoneMatch)) {
      c.res = new Response(null, {
        status: 304,
        statusText: 'Not Modified',
        headers: { ETag: tag },
      })
      for (const key of [...c.res.headers.keys()])
        if (!KEPT_ON_304.has(key)) c.res.headers.delete(key)
    } else c.res.headers.set('ETag', tag)
  }
}

/** Adds `API_CACHE_CONTROL` to a successful read that set none; `/api/health` keeps none. */
export function apiCacheControl(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    if (!isRead(c.req.method) || c.req.path === HEALTH_PATH || !c.res.ok) return
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', API_CACHE_CONTROL)
  }
}

/**
 * The `Cache-Control` of the dashboard response to request path `path` with content type
 * `contentType`. Only a build output under `/assets/` is immutable: `index.html` served there as
 * the SPA fallback (a navigation to a chunk a later build removed) is revalidated like any other
 * page, so no cache keeps HTML under that URL for a year.
 */
export function staticCacheControl(path: string, contentType = ''): string {
  const html = contentType.toLowerCase().startsWith('text/html')
  return path.startsWith(ASSETS_PREFIX) && !html ? ASSET_CACHE_CONTROL : STATIC_CACHE_CONTROL
}

/** Sets `staticCacheControl` on a successful dashboard response (file or SPA fallback). */
export function staticCacheHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    if (!isRead(c.req.method) || !c.res.ok) return
    if (!c.res.headers.has('Cache-Control')) {
      const type = c.res.headers.get('content-type') ?? ''
      c.header('Cache-Control', staticCacheControl(c.req.path, type))
    }
  }
}
