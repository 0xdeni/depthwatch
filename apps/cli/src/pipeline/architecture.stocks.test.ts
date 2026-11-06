/**
 * docs/ARCHITECTURE.md, "Seeded discovery": the tokenized stocks are seeded as cross tokens
 * (docs/design/stocks.md §3), and the counts the prose gives for them (pairs, calls per DEX, the
 * multicalls, the quadratic cost of seeding them as `--seed-token` addresses instead) are derived
 * here from the stock list, the chain's own pair list (`seedPairs`), the seeded tiers and keys, the
 * Slipstream spacings the same section counts and the multicall size, so a stock added to the list
 * or a tier that moves fails a test instead of dating the page.
 */
import {
  BASE_STOCKS,
  DEFAULT_MAX_CALLS_PER_MULTICALL,
  REFERENCE_TOKENS,
  SEED_WORLD_AERO_TICK_SPACINGS,
  type SeedPair,
  seedPairs,
  UNISWAP_V3_CANDIDATE_FEES,
  UNISWAP_V4_STANDARD_KEYS,
} from '@depthwatch/chain'
import { NATIVE_ETH } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { numbers, section } from '../testing/architectureDoc.js'

describe('ARCHITECTURE.md: seeded discovery counts of the stocks', () => {
  const seed = section('### Seeded discovery: factory views and archive state')
  const pairs = (n: number) => BigInt((n * (n - 1)) / 2)

  it('derives the stock seed counts from the stock list and the seeded tiers', () => {
    // The Slipstream spacings the prose counts: 22 over the three Aerodrome factories, 7 on Aero's.
    const erc20 = REFERENCE_TOKENS.filter((t) => t.address !== NATIVE_ETH).length
    const counted = numbers(
      seed,
      /\(([\d,]+) with the (\d+) spacings the three Aerodrome factories enable today, ([\d,]+) with the (\d+) of the Aero factory\)/,
    )
    const aerodromeSpacings = counted[1] ?? 0n
    const aeroSpacings = counted[3] ?? 0n
    expect(counted).toEqual([
      pairs(erc20) * aerodromeSpacings,
      aerodromeSpacings,
      pairs(erc20) * aeroSpacings,
      BigInt(SEED_WORLD_AERO_TICK_SPACINGS.length),
    ])

    const stocks = BASE_STOCKS.tokens.length
    expect(
      numbers(seed, /`packages\/chain\/src\/stocks.ts`, the (\d+) stocks of base\.org\/stocks/),
    ).toEqual([BigInt(stocks)])
    // The pairs the seed adds, from the chain's own pair list: 14 ERC-20 and 15 currency pairs.
    const references = REFERENCE_TOKENS.map((t) => t.address)
    const list = BASE_STOCKS.tokens.map((t) => t.address)
    const erc20Of = (p: readonly SeedPair[]) =>
      BigInt(p.filter(([a, b]) => a !== NATIVE_ETH && b !== NATIVE_ETH).length)
    const base = seedPairs(references)
    const cross = seedPairs(references, list)
    const perErc20 = (erc20Of(cross) - erc20Of(base)) / BigInt(stocks)
    const perCurrency = BigInt((cross.length - base.length) / stocks)
    expect([perErc20, perCurrency]).toEqual([BigInt(erc20), BigInt(REFERENCE_TOKENS.length)])
    // Calls per ERC-20 pair: 7 v3 tiers, 2 Aerodrome v2, 2 Aero v2 and the 22 + 7 Slipstream
    // spacings, 40 in all; per currency pair the 4 v4 keys.
    const v3 = perErc20 * BigInt(UNISWAP_V3_CANDIDATE_FEES.length)
    const v4 = perCurrency * BigInt(UNISWAP_V4_STANDARD_KEYS.length)
    const slipstream = perErc20 * aerodromeSpacings
    const aeroSlipstream = perErc20 * aeroSpacings
    const perStock = v3 + 4n * perErc20 + v4 + slipstream + aeroSlipstream
    const all = perStock * BigInt(stocks)
    expect(
      numbers(
        seed,
        /Each stock adds (\d+) ERC-20 pairs and (\d+) currency pairs: (\d+) v3, (\d+) Aerodrome v2, (\d+) Aero v2, (\d+) v4, (\d+) Aerodrome Slipstream and (\d+) Aero Slipstream calls, (\d+) calls a stock and ([\d,]+) for the/,
      ),
    ).toEqual([
      perErc20,
      perCurrency,
      v3,
      2n * perErc20,
      2n * perErc20,
      v4,
      slipstream,
      aeroSlipstream,
      perStock,
      all,
    ])
    const size = BigInt(DEFAULT_MAX_CALLS_PER_MULTICALL)
    expect(numbers(seed, /for the \d+, about (\d+) more multicalls/)).toEqual([
      (all + size - 1n) / size,
    ])

    // As seed tokens: every pair among references and stocks, the stock × stock pairs included.
    const asTokens = seedPairs([...references, ...list])
    expect([(perStock - v4) / perErc20, v4 / perCurrency]).toEqual([40n, 4n])
    expect(
      numbers(seed, /the \d+ would add ([\d,]+) calls, their (\d+) stock × stock pairs included/),
    ).toEqual([
      (erc20Of(asTokens) - erc20Of(base)) * 40n + BigInt(asTokens.length - base.length) * 4n,
      pairs(stocks),
    ])
    expect(asTokens.length - cross.length).toBe(Number(pairs(stocks)))
  })
})
