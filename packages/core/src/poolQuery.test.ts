/**
 * The pools search: a pasted pool id finding the pools on its DEX whose address or v4 pool id
 * starts with its hex; otherwise the terms of a query, every term matching the pool anywhere in a
 * token's symbol or address, the pool address or id, or at a word start in a token's name, and
 * never the DEX.
 */
import { describe, expect, it } from 'vitest'
import {
  matchesPoolSearch,
  matchesPoolTerms,
  type PoolQueryTarget,
  poolIdQuery,
  poolQueryTerms,
  poolSearch,
} from './poolQuery.js'

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
): PoolQueryTarget {
  return {
    dex: 'uniswap-v3',
    address: '0x000000000000000000000000000000000000abcd',
    poolId: null,
    token0,
    token1,
  }
}

const matches = (p: PoolQueryTarget, q: string) => matchesPoolTerms(p, poolQueryTerms(q))

describe('poolQueryTerms', () => {
  it('splits on whitespace, "/", "-", ":" and ",", folds ASCII case and drops repeats', () => {
    const pairs = ['WETH/USDC', 'WETH USDC', 'weth-usdc', 'weth : usdc', ' WETH\t/ USDC ']
    for (const q of [...pairs, 'WETH, USDC', 'weth,usdc'])
      expect(poolQueryTerms(q), q).toEqual(['weth', 'usdc'])
    expect(poolQueryTerms('usdc weth')).toEqual(['usdc', 'weth'])
    expect(poolQueryTerms('WETH weth')).toEqual(['weth'])
    expect(poolQueryTerms('uniswap-v3:0xABC')).toEqual(['uniswap', 'v3', '0xabc'])
    expect(poolQueryTerms('ÉTH')).toEqual(['Éth'])
  })

  it('gives no term for a blank query or one of separators alone', () => {
    for (const q of ['', '  ', '/', ' - : ', ',', undefined])
      expect(poolQueryTerms(q), q).toEqual([])
  })

  it('splits on control characters too, so no term holds a NUL', () => {
    expect(poolQueryTerms('weth\u0000')).toEqual(['weth'])
    expect(poolQueryTerms('weth\u0000usdc\u007f')).toEqual(['weth', 'usdc'])
    for (const q of ['\u0000', '\u0001 \u001f', '\u0085']) expect(poolQueryTerms(q), q).toEqual([])
  })
})

describe('matchesPoolTerms', () => {
  const wethUsdc = pool(WETH, USDC)
  const usdcUsdt = pool(USDC, USDT)

  it('finds a pair written either way round, with any separator', () => {
    for (const q of ['WETH/USDC', 'WETH USDC', 'weth-usdc', 'usdc weth', 'USDC:WETH', 'WETH, USDC'])
      expect(matches(wethUsdc, q), q).toBe(true)
    expect(matches(usdcUsdt, 'WETH/USDC')).toBe(false)
    expect(matches(wethUsdc, 'weth/dai')).toBe(false)
  })

  it('matches symbols and addresses anywhere, the pool address and the v4 pool id', () => {
    expect(matches(wethUsdc, 'eth')).toBe(true)
    expect(matches(wethUsdc, '0x8335')).toBe(true)
    expect(matches(wethUsdc, 'ABCD')).toBe(true)
    const v4 = { ...pool(WETH, USDC), address: null, poolId: '0xfeedbeef' }
    expect(matches(v4, 'feedbeef')).toBe(true)
  })

  it('matches names at the start of a word only', () => {
    // "Tether USD" holds "eth" inside a word, so a search for ETH pairs leaves USDC / USDT out
    expect(matches(usdcUsdt, 'ETH/USDC')).toBe(false)
    expect(matches(usdcUsdt, 'tether')).toBe(true)
    expect(matches(pool(TSLA, USDC), 'tesla usdc')).toBe(true)
    expect(matches(pool(TSLA, USDC), 'inc')).toBe(true)
    expect(matches(wethUsdc, 'coin')).toBe(true)
    expect(matches(wethUsdc, 'oin')).toBe(false)
  })

  it('never reads the DEX, so "aero" finds the AERO token, not every Aero pool', () => {
    const AERO = {
      symbol: 'AERO',
      name: 'Aero',
      address: '0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee',
    }
    // The DEX ids "aero-slipstream" and "uniswap-v3" are on the pool, but not searched.
    const slip = { ...pool(WETH, USDC), dex: 'aero-slipstream' }
    for (const q of ['aero', 'AERO/USDC', 'slipstream usdc', 'uniswap v3'])
      expect(matches(slip, q), q).toBe(false)
    const usdcAero = { ...pool(USDC, AERO), dex: 'uniswap-v3' }
    expect(matches(usdcAero, 'AERO/USDC')).toBe(true)
  })

  it('matches every pool when the query has no term', () => {
    expect(matchesPoolTerms(usdcUsdt, [])).toBe(true)
  })
})

describe('a pasted pool id', () => {
  const V3 = '0xd0b53d9277642d899df5c87a3966a349a798f224'
  const V4 = '0x96d4b53a38337a5733179751781178a2613306063c511b78cd02684739288c0a'
  const v3 = { ...pool(WETH, USDC), address: V3 }
  const v4 = { ...pool(WETH, USDC), dex: 'uniswap-v4', address: null, poolId: V4 }
  const slip = { ...pool(WETH, USDC), dex: 'aerodrome-slipstream', address: V3 }
  const other = { ...pool(WETH, USDC), address: '0x6c561b446416e1a00e8e93e221854d6ea4171372' }
  const search = (p: PoolQueryTarget, q: string) => matchesPoolSearch(p, poolSearch(q))

  it('reads a known DEX, ":" and 0x hex, in any case, with spaces around the ":"', () => {
    const id = { dex: 'uniswap-v3', keyPrefix: V3 }
    for (const q of [
      `uniswap-v3:${V3}`,
      ` Uniswap-V3 : ${V3.toUpperCase()} `,
      `uniswap-v3:\t${V3}`,
    ])
      expect(poolIdQuery(q), q).toEqual(id)
    expect(poolIdQuery('aero-slipstream:0xD0B5')).toEqual({
      dex: 'aero-slipstream',
      keyPrefix: '0xd0b5',
    })
    expect(poolSearch(`uniswap-v3:${V3}`)).toEqual({ kind: 'pool-id', ...id })
  })

  it('reads the id as a pool link carries it: "%3A" for ":", or the whole link', () => {
    const id = { dex: 'uniswap-v3', keyPrefix: V3 }
    for (const q of [
      `uniswap-v3%3A${V3}`,
      `uniswap-v3%3a${V3}`,
      `https://depthwatch.pages.dev/#/pools/uniswap-v3%3A${V3}`,
      `http://localhost:5173/pools/uniswap-v3%3A${V3}?window=7d`,
      `/pools/uniswap-v3:${V3}/`,
      `depthwatch.pages.dev/#/pools/uniswap-v3%3A${V3}#top`,
    ])
      expect(poolIdQuery(q), q).toEqual(id)
  })

  it('leaves out a "/", ",", ":" or "." a copy took after the hex', () => {
    const id = { dex: 'uniswap-v3', keyPrefix: V3 }
    for (const q of [
      `uniswap-v3:${V3}/`,
      `uniswap-v3:${V3},`,
      `uniswap-v3:${V3}:`,
      `uniswap-v3:${V3}.`,
      `uniswap-v3:${V3}/.`,
      `https://depthwatch.pages.dev/#/pools/uniswap-v3%3A${V3}.`,
    ])
      expect(poolIdQuery(q), q).toEqual(id)
    expect(poolIdQuery(`uniswap-v3:${V3}-`)).toBeNull()
    expect(poolIdQuery(`uniswap-v3:${V3})`)).toBeNull()
  })

  it('is the whole query or nothing: anything else keeps the term rule', () => {
    for (const q of [
      'sushiswap:0xd0b5',
      'uniswap-v5:0xd0b5',
      'uniswap-v3:0x',
      'uniswap-v3:d0b5',
      'uniswap-v3:0xd0b5 weth',
      'weth uniswap-v3:0xd0b5',
      'uniswap-v3::0xd0b5',
      'uniswap-v3:0xd0b5g',
      `https://depthwatch.pages.dev/#/tokens/${V3}`,
      `https://depthwatch.pages.dev/#/pools/uniswap-v3%3A${V3}/history`,
      'WETH/USDC',
      '',
      undefined,
    ])
      expect(poolIdQuery(q), String(q)).toBeNull()
    expect(poolSearch('sushiswap:0xd0b5')).toEqual({
      kind: 'terms',
      terms: ['sushiswap', '0xd0b5'],
    })
  })

  it('finds the pool from its full id, upper-case hex, a hex prefix or its link', () => {
    for (const q of [
      `uniswap-v3:${V3}`,
      `uniswap-v3:${V3.toUpperCase()}`,
      'uniswap-v3:0xd0b5',
      'uniswap-v3 : 0xD0',
      `https://depthwatch.pages.dev/#/pools/uniswap-v3%3A${V3}`,
    ])
      expect(search(v3, q), q).toBe(true)
  })

  it('finds a v4 pool from its pool id', () => {
    for (const q of [`uniswap-v4:${V4}`, `uniswap-v4:${V4.toUpperCase()}`, 'uniswap-v4:0x96d4b5'])
      expect(search(v4, q), q).toBe(true)
    expect(search(v4, `uniswap-v3:${V4}`)).toBe(false)
  })

  it("leaves out the right DEX's other pools and the same hex on another DEX", () => {
    expect(search(other, `uniswap-v3:${V3}`)).toBe(false)
    expect(search(other, 'uniswap-v3:0xd0b5')).toBe(false)
    expect(search(slip, `uniswap-v3:${V3}`)).toBe(false)
    expect(search(v3, `aerodrome-slipstream:${V3}`)).toBe(false)
    expect(search(slip, `aerodrome-slipstream:${V3}`)).toBe(true)
  })

  it('matches only from the start of the address or pool id', () => {
    expect(search(v3, 'uniswap-v3:0x3d92')).toBe(false)
    expect(search(v4, 'uniswap-v4:0x4b53')).toBe(false)
  })

  it('falls back to the term rule for an unknown DEX, which never reads the DEX', () => {
    // "sushiswap" and "v5" match nothing, so the term rule finds no pool
    expect(search(v3, `sushiswap:${V3}`)).toBe(false)
    expect(search(v3, `uniswap-v5:${V3}`)).toBe(false)
    // "weth" is a token of the pool and the hex is in its address: every term matches
    expect(search(v3, `weth:${V3}`)).toBe(true)
    expect(search(other, `weth:${V3}`)).toBe(false)
    // "0x" without a hex digit is no id, and the terms "uniswap" and "v3" match nothing
    expect(search(v3, 'uniswap-v3:0x')).toBe(false)
  })
})
