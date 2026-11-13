/**
 * The pools search (`q` on `GET /api/pools` and the Pools page): one rule for the API's SQL
 * (packages/db/src/repos/poolRow.ts), the static and mock clients and the Pools field.
 *
 * A pasted pool id first: when the whole trimmed query is a pool id, a DEX id of `DEXES`, ":"
 * (spaces around it allowed) and "0x" with at least one hex digit, the search finds the pools on
 * that DEX whose address or v4 pool id starts with that hex, in any letter case
 * ("uniswap-v3:0xd0b5" finds the Uniswap v3 pools at 0xd0b5…). The id may be written as the
 * site's pool links carry it, with "%3A" for the ":", and may be the whole link
 * ("https://…/#/pools/uniswap-v3%3A0xd0b5…?window=7d": anything up to "/pools/", the id, then an
 * optional "/", "?…" or "#…"), as an address bar copies it. A "/", ",", ":" or "." a copy took
 * after the hex is left out.
 *
 * Any other query is split into terms on whitespace (control characters count as whitespace),
 * "/", "-", ":" and ",", and every term must match the pool somewhere, so "WETH/USDC",
 * "WETH USDC", "weth-usdc", "WETH, USDC" and "usdc weth" list the same pools. A term matches
 * anywhere in either token's symbol or address, the pool address or the v4 pool id ("eth" finds
 * WETH and cbETH), and at the start of a word in either token's name ("tesla" finds Tesla Inc.,
 * but "eth" not Tether USD). Terms never read the DEX: it has its own filter, and the Aero DEX
 * ids would answer every "aero" meant for the AERO token. Case folds for ASCII letters only, as
 * SQLite's `LIKE` does.
 */
import { DEXES, type Dex } from './types.js'

/**
 * The longest search the API and the static client accept, in characters: room for a Uniswap v4
 * pool's whole link (its 64-hex-digit pool id after an origin, "/#/pools/" and "uniswap-v4%3A").
 */
export const POOL_QUERY_MAX_LENGTH = 200

/**
 * What separates the terms of a search: whitespace, "/", "-", ":" and ",". Control characters
 * count as whitespace: SQLite's `LIKE` would end its pattern at a NUL.
 */
const TERM_SEPARATORS = /[\s\p{Cc}/:,-]+/u

/** What starts a word inside a token's name, besides its start: a space, "/", "-" or ":". */
export const POOL_QUERY_WORD_BREAKS = ['/', '-', ':'] as const

/** ASCII letters lowercased, everything else kept: the case folding of SQLite's `LIKE`. */
function foldAscii(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/** A pool's link up to its id: any text ending in "/pools/", the id, an optional "/", "?…", "#…". */
const POOL_LINK = /^\S*\/pools\/([^/?#\s]+)\/?(?:[?#]\S*)?$/

/** Every DEX id of `DEXES`, as a regular-expression alternation. */
const DEX_IDS = DEXES.map((dex) => dex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

/**
 * A pool id: a known DEX, ":" or its URL encoding "%3a" (folded), and 0x with some hex, then any
 * "/", ",", ":" or "." a copy took with it.
 */
const POOL_ID = new RegExp(`^(${DEX_IDS})\\s*(?::|%3a)\\s*(0x[0-9a-f]+)[/,:.]*$`)

/** A pasted pool id: the pools on `dex` whose address or v4 pool id starts with `keyPrefix`. */
export interface PoolIdQuery {
  dex: Dex
  /** "0x" and at least one hex digit, lowercased. */
  keyPrefix: string
}

/**
 * The pool id the whole query is, or null when it is not one: a known DEX, ":" (or "%3A") and
 * 0x hex, alone or at the end of a pool's link. "uniswap-v3:0xD0B5", "uniswap-v3 : 0xd0b5",
 * "uniswap-v3:0xd0b5/" and "https://…/#/pools/uniswap-v3%3A0xd0b5" give `uniswap-v3` and
 * "0xd0b5"; "sushi:0xd0b5", "uniswap-v3:0x" and "uniswap-v3:0xd0b5 weth" give null.
 */
export function poolIdQuery(q: string | undefined): PoolIdQuery | null {
  const text = foldAscii(q ?? '').trim()
  const match = POOL_ID.exec(POOL_LINK.exec(text)?.[1] ?? text)
  if (!match) return null
  return { dex: match[1] as Dex, keyPrefix: match[2] as string }
}

/**
 * The terms of a pool search, folded and deduplicated: "WETH/USDC", "WETH USDC", "weth-usdc",
 * "WETH, USDC" and "usdc weth" all give the two terms of one pair. None for a blank query or one
 * of separators alone ("/"), which is no query. No term holds a separator or a space.
 */
export function poolQueryTerms(q: string | undefined): string[] {
  const terms = foldAscii(q ?? '')
    .split(TERM_SEPARATORS)
    .filter((term) => term !== '')
  return [...new Set(terms)]
}

/** A parsed pools search: a pasted pool id, or the terms that must all match. */
export type PoolSearch = ({ kind: 'pool-id' } & PoolIdQuery) | { kind: 'terms'; terms: string[] }

/** The search `q` asks for: its pool id when the whole query is one, else its terms. */
export function poolSearch(q: string | undefined): PoolSearch {
  const id = poolIdQuery(q)
  return id ? { kind: 'pool-id', ...id } : { kind: 'terms', terms: poolQueryTerms(q) }
}

/** The fields of a pool a search reads; only a pasted pool id reads the DEX. */
export interface PoolQueryTarget {
  dex: string
  address: string | null
  poolId: string | null
  token0: { symbol: string; name: string; address: string }
  token1: { symbol: string; name: string; address: string }
}

/** Whether the pool is on the id's DEX and its address or v4 pool id starts with its hex. */
export function matchesPoolId(pool: PoolQueryTarget, id: PoolIdQuery): boolean {
  if (pool.dex !== id.dex) return false
  return [pool.address, pool.poolId].some(
    (key) => key !== null && foldAscii(key).startsWith(id.keyPrefix),
  )
}

/** `text` with a space before each word: its start and each word break become a space. */
function spacedWords(text: string): string {
  let out = ` ${foldAscii(text)}`
  for (const mark of POOL_QUERY_WORD_BREAKS) out = out.split(mark).join(' ')
  return out
}

/** Whether one folded term matches the pool (the term rule above; never the DEX). */
function termMatches(pool: PoolQueryTarget, term: string): boolean {
  const anywhere = [
    pool.token0.symbol,
    pool.token0.address,
    pool.token1.symbol,
    pool.token1.address,
    pool.address,
    pool.poolId,
  ]
  if (anywhere.some((field) => field !== null && foldAscii(field).includes(term))) return true
  const words = [pool.token0.name, pool.token1.name]
  return words.some((field) => spacedWords(field).includes(` ${term}`))
}

/** Whether every term (from `poolQueryTerms`) matches the pool; no terms match every pool. */
export function matchesPoolTerms(pool: PoolQueryTarget, terms: readonly string[]): boolean {
  return terms.every((term) => termMatches(pool, term))
}

/** Whether the pool answers the search (`poolSearch`): its pool id, else every one of its terms. */
export function matchesPoolSearch(pool: PoolQueryTarget, search: PoolSearch): boolean {
  return search.kind === 'pool-id'
    ? matchesPoolId(pool, search)
    : matchesPoolTerms(pool, search.terms)
}
