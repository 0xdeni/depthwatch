/**
 * The DEXes a Pools search names. Search reads tokens and addresses, never the DEX (core's rule,
 * packages/core/src/poolQuery.ts), so "uniswap v3 weth" finds nothing; the empty state then
 * points to the DEX filter, with the rest of the search ("weth") kept.
 */
import { DEXES, type Dex, poolQueryTerms, poolSearch } from '@depthwatch/core'
import { dexLabel } from '../../lib/format.js'
import { dexShort } from './PoolsControls.js'

/** A DEX the search names, and the search without the words that named it. */
export interface NamedDex {
  dex: Dex
  rest: string
}

/** A version word ("v2", "v3", "v4") names a DEX only beside another of its words. */
const VERSION = /^v\d+$/

/** Each DEX's words: its id's, its label's and its phone filter label's ("aerodrome", "cl"). */
const DEX_WORDS: ReadonlyMap<Dex, ReadonlySet<string>> = new Map(
  DEXES.map((dex) => [dex, new Set(poolQueryTerms(`${dex} ${dexLabel(dex)} ${dexShort(dex)}`))]),
)

/**
 * The DEXes with the most of their words among the search's terms: "uniswap v3 weth" names
 * Uniswap v3 and leaves "weth", "uniswap" names both Uniswap DEXes, "Aerodrome CL" Aerodrome
 * Slipstream. None when no term names a DEX, and none for a pasted pool id, which reads its DEX.
 */
export function dexesNamedBy(q: string): NamedDex[] {
  const search = poolSearch(q)
  if (search.kind !== 'terms') return []
  let best = 0
  let named: NamedDex[] = []
  for (const [dex, words] of DEX_WORDS) {
    const hits = search.terms.filter((term) => words.has(term))
    if (hits.length < best || hits.every((term) => VERSION.test(term))) continue
    const entry = { dex, rest: search.terms.filter((term) => !words.has(term)).join(' ') }
    named = hits.length > best ? [entry] : [...named, entry]
    best = hits.length
  }
  return named
}
