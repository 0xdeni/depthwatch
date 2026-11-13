/**
 * The pools search (`q`) on a pool summary: core's rule (packages/core/src/poolQuery.ts), the one
 * the API's SQL applies. A pasted pool id ("uniswap-v3:0xd0b5…", as the site's pool links carry
 * it, also with "%3A" for the ":" or as the whole link) finds the pools on that DEX whose address
 * or v4 pool id starts with its hex. Any other query is split into terms on whitespace, "/", "-",
 * ":" and ",", and every term must match the pool: anywhere in either token's symbol or address,
 * the pool address or the v4 pool id, or at the start of a word in either token's name (terms
 * never read the DEX). "WETH/USDC", "WETH USDC", "weth-usdc" and "usdc weth" list the same
 * pools. The static client, the mock client and the Pools field all match through here, so they
 * agree with the API.
 */
import { matchesPoolSearch, poolQueryTerms, poolSearch } from '@depthwatch/core'
import type { PoolSummary } from '../api/types.js'

export { poolQueryTerms }

/** Whether this pool answers `q`; a query without terms matches every pool. */
export function matchesPoolQuery(item: PoolSummary, q: string): boolean {
  return matchesPoolSearch(item.pool, poolSearch(q))
}
