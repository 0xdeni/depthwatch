/**
 * The pools search (`q`) on a pool summary: core's rule (packages/core/src/poolQuery.ts), the one
 * the API's SQL applies. The query is split into terms on whitespace, "/", "-" and ":", and every
 * term must match the pool: anywhere in either token's symbol or address, the pool address or the
 * v4 pool id, or at the start of a word in either token's name or the DEX. "WETH/USDC", "WETH
 * USDC", "weth-usdc" and "usdc weth" list the same pools. The static client, the mock client and
 * the Pools field all match through here, so they agree with the API.
 */
import { matchesPoolTerms, poolQueryTerms } from '@depthwatch/core'
import type { PoolSummary } from '../api/types.js'

export { poolQueryTerms }

/** Whether every term of `q` matches this pool; a query without terms matches every pool. */
export function matchesPoolQuery(item: PoolSummary, q: string): boolean {
  return matchesPoolTerms(item.pool, poolQueryTerms(q))
}
