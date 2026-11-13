/**
 * The pools search (`q` on `GET /api/pools` and the Pools page): one rule for the API's SQL
 * (packages/db/src/repos/poolRow.ts), the static and mock clients and the Pools field.
 *
 * The query is split into terms on whitespace, "/", "-" and ":", and every term must match the
 * pool somewhere, so "WETH/USDC", "WETH USDC", "weth-usdc" and "usdc weth" list the same pools.
 * A term matches anywhere in either token's symbol or address, the pool address or the v4 pool id
 * ("eth" finds WETH and cbETH), and at the start of a word in either token's name or the DEX
 * ("tesla" finds Tesla Inc., "slipstream" the Slipstream DEXes, but "eth" not Tether USD). Case
 * folds for ASCII letters only, as SQLite's `LIKE` does.
 */

/** What separates the terms of a search: whitespace, "/", "-" and ":". */
const TERM_SEPARATORS = /[\s/:-]+/

/**
 * What starts a word inside a name or a DEX id, besides its start: a space, "/", "-" or ":"
 * (the DEX id "aero-slipstream" holds the words "aero" and "slipstream").
 */
export const POOL_QUERY_WORD_BREAKS = ['/', '-', ':'] as const

/** ASCII letters lowercased, everything else kept: the case folding of SQLite's `LIKE`. */
function foldAscii(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/**
 * The terms of a pool search, folded and deduplicated: "WETH/USDC", "WETH USDC", "weth-usdc" and
 * "usdc weth" all give the two terms of one pair. None for a blank query or one of separators
 * alone ("/"), which is no query. No term holds a separator or a space.
 */
export function poolQueryTerms(q: string | undefined): string[] {
  const terms = foldAscii(q ?? '')
    .split(TERM_SEPARATORS)
    .filter((term) => term !== '')
  return [...new Set(terms)]
}

/** The fields of a pool a search reads. */
export interface PoolQueryTarget {
  dex: string
  address: string | null
  poolId: string | null
  token0: { symbol: string; name: string; address: string }
  token1: { symbol: string; name: string; address: string }
}

/** `text` with a space before each word: its start and each word break become a space. */
function spacedWords(text: string): string {
  let out = ` ${foldAscii(text)}`
  for (const mark of POOL_QUERY_WORD_BREAKS) out = out.split(mark).join(' ')
  return out
}

/** Whether one folded term matches the pool (the rule above). */
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
  const words = [pool.token0.name, pool.token1.name, pool.dex]
  return words.some((field) => spacedWords(field).includes(` ${term}`))
}

/** Whether every term (from `poolQueryTerms`) matches the pool; no terms match every pool. */
export function matchesPoolTerms(pool: PoolQueryTarget, terms: readonly string[]): boolean {
  return terms.every((term) => termMatches(pool, term))
}
