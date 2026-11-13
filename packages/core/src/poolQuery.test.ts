/**
 * The pools search: the terms of a query, and every term matching the pool anywhere in a token's
 * symbol or address, the pool address or id, or at a word start in a token's name or the DEX.
 */
import { describe, expect, it } from 'vitest'
import { matchesPoolTerms, type PoolQueryTarget, poolQueryTerms } from './poolQuery.js'

const WETH = {
  symbol: 'WETH',
  name: 'Wrapped Ether',
  address: '0x4200000000000000000000000000000000000006',
}
const USDC = {
  symbol: 'USDC',
  name: 'USD Coin',
  address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
}
const USDT = {
  symbol: 'USDT',
  name: 'Tether USD',
  address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
}
const TSLA = {
  symbol: 'TSLAc',
  name: 'Tesla Inc.',
  address: '0x00000000000000000000000000000000000075a1',
}

function pool(
  token0: PoolQueryTarget['token0'],
  token1: PoolQueryTarget['token1'],
  dex = 'uniswap-v3',
): PoolQueryTarget {
  return {
    dex,
    address: '0x000000000000000000000000000000000000abcd',
    poolId: null,
    token0,
    token1,
  }
}

const matches = (p: PoolQueryTarget, q: string) => matchesPoolTerms(p, poolQueryTerms(q))

describe('poolQueryTerms', () => {
  it('splits on whitespace, "/", "-" and ":", folds ASCII case and drops repeats', () => {
    for (const q of ['WETH/USDC', 'WETH USDC', 'weth-usdc', 'weth : usdc', ' WETH\t/ USDC '])
      expect(poolQueryTerms(q), q).toEqual(['weth', 'usdc'])
    expect(poolQueryTerms('usdc weth')).toEqual(['usdc', 'weth'])
    expect(poolQueryTerms('WETH weth')).toEqual(['weth'])
    expect(poolQueryTerms('uniswap-v3:0xABC')).toEqual(['uniswap', 'v3', '0xabc'])
    expect(poolQueryTerms('ÉTH')).toEqual(['Éth'])
  })

  it('gives no term for a blank query or one of separators alone', () => {
    for (const q of ['', '  ', '/', ' - : ', undefined]) expect(poolQueryTerms(q), q).toEqual([])
  })
})

describe('matchesPoolTerms', () => {
  const wethUsdc = pool(WETH, USDC)
  const usdcUsdt = pool(USDC, USDT)

  it('finds a pair written either way round, with any separator', () => {
    for (const q of ['WETH/USDC', 'WETH USDC', 'weth-usdc', 'usdc weth', 'USDC:WETH'])
      expect(matches(wethUsdc, q), q).toBe(true)
    expect(matches(usdcUsdt, 'WETH/USDC')).toBe(false)
    expect(matches(wethUsdc, 'weth/dai')).toBe(false)
  })

  it('matches symbols and addresses anywhere, the pool address and the v4 pool id', () => {
    expect(matches(wethUsdc, 'eth')).toBe(true)
    expect(matches(wethUsdc, '0x8335')).toBe(true)
    expect(matches(wethUsdc, 'ABCD')).toBe(true)
    const v4 = { ...pool(WETH, USDC, 'uniswap-v4'), address: null, poolId: '0xfeedbeef' }
    expect(matches(v4, 'feedbeef')).toBe(true)
  })

  it('matches names and the DEX at the start of a word only', () => {
    // "Tether USD" holds "eth" inside a word, so a search for ETH pairs leaves USDC / USDT out
    expect(matches(usdcUsdt, 'ETH/USDC')).toBe(false)
    expect(matches(usdcUsdt, 'tether')).toBe(true)
    expect(matches(pool(TSLA, USDC), 'tesla usdc')).toBe(true)
    expect(matches(pool(TSLA, USDC), 'inc')).toBe(true)
    expect(matches(wethUsdc, 'coin')).toBe(true)
    expect(matches(wethUsdc, 'oin')).toBe(false)
    const slip = pool(WETH, USDC, 'aerodrome-slipstream')
    expect(matches(slip, 'slipstream usdc')).toBe(true)
    expect(matches(slip, 'aero')).toBe(true)
    expect(matches(slip, 'drome')).toBe(false)
    expect(matches(wethUsdc, 'uniswap v3')).toBe(true)
    expect(matches(wethUsdc, 'v4')).toBe(false)
  })

  it('lets the DEX answer a term, so a token named like a DEX also finds that DEX', () => {
    // "aero" is a token and two DEXes: every term may match the DEX, as the rule says
    expect(matches(pool(WETH, USDC, 'aero-slipstream'), 'AERO/USDC')).toBe(true)
    expect(matches(pool(WETH, USDC), 'AERO/USDC')).toBe(false)
  })

  it('matches every pool when the query has no term', () => {
    expect(matchesPoolTerms(usdcUsdt, [])).toBe(true)
  })
})
