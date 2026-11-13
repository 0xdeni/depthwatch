/**
 * The pool search (`PoolFilter.q`) in SQL: a pasted pool id finding the pools on its DEX whose
 * address or v4 pool id starts with its hex; otherwise every term matching either token or the
 * pool (never the DEX), in any order; through both `pools.list` and `scores.topBy`, exactly as
 * core's `matchesPoolSearch` decides it for the same pools.
 */
import {
  DEXES,
  matchesPoolSearch,
  type PoolMeta,
  poolSearch,
  type TokenInfo,
} from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import {
  FIXTURE_AERO,
  FIXTURE_USDC,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
  fixtureScore,
} from '../fixtures.js'
import { filterReadsTokens } from './poolRow.js'

/** "Tether USD" holds "eth" inside a word: a search for ETH pairs must leave it out. */
const USDT: TokenInfo = {
  address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  symbol: 'USDT',
  name: 'Tether USD',
  decimals: 6,
}

const WETH_USDC = fixturePool({ address: fixtureAddress(1) })
const WETH_USDC_SLIP = fixturePool({ dex: 'aerodrome-slipstream', address: fixtureAddress(2) })
const USDC_AERO = fixturePool({
  dex: 'aerodrome-v2',
  kind: 'constant-product',
  address: fixtureAddress(3),
  token0: FIXTURE_USDC,
  token1: FIXTURE_AERO,
  tickSpacing: null,
})
const WETH_AERO = fixturePool({ address: fixtureAddress(4), token1: FIXTURE_AERO })
const USDC_USDT = fixturePool({ address: fixtureAddress(5), token0: FIXTURE_USDC, token1: USDT })

/** The pools of the pasted-id cases: tokens no other case searches, addresses that differ early. */
const DEGEN: TokenInfo = {
  address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
  symbol: 'DEGEN',
  name: 'Degen',
  decimals: 18,
}
const TOSHI: TokenInfo = {
  address: '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4',
  symbol: 'TOSHI',
  name: 'Toshi',
  decimals: 18,
}
const ID_V3 = fixturePool({
  address: '0xd0b53d9277642d899df5c87a3966a349a798f224',
  token0: DEGEN,
  token1: TOSHI,
})
const ID_V3_NEXT = fixturePool({
  address: '0xd0b5aa0000000000000000000000000000000001',
  token0: DEGEN,
  token1: TOSHI,
  feePips: 3000,
})
const ID_SLIP = fixturePool({
  dex: 'aerodrome-slipstream',
  address: '0xb2cc224c1c9fee385f8ad6a55b4d94e92359dc59',
  token0: DEGEN,
  token1: TOSHI,
})
const ID_V4 = fixturePool({
  dex: 'uniswap-v4',
  address: null,
  poolId: '0x96d4b53a38337a5733179751781178a2613306063c511b78cd02684739288c0a',
  token0: DEGEN,
  token1: TOSHI,
})
const ALL = [
  WETH_USDC,
  WETH_USDC_SLIP,
  USDC_AERO,
  WETH_AERO,
  USDC_USDT,
  ID_V3,
  ID_V3_NEXT,
  ID_SLIP,
  ID_V4,
]

const ids = (pools: readonly { id: string }[]) => pools.map((p) => p.id).sort()

describe('filterReadsTokens', () => {
  it('reads the token columns only when the query has a term', () => {
    expect(filterReadsTokens({ q: 'weth' })).toBe(true)
    expect(filterReadsTokens({ q: ' / ' })).toBe(false)
    expect(filterReadsTokens({ dex: 'uniswap-v3' })).toBe(false)
    // A pasted pool id reads the DEX and the pool's address or id: `pools` alone.
    expect(filterReadsTokens({ q: 'uniswap-v3:0xd0b5' })).toBe(false)
  })
})

describe('the pool search', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
    db.pools.upsertMany(ALL)
    db.pools.setTracked(
      ALL.map((p) => p.id),
      true,
    )
    db.scores.upsertMany(ALL.map((p) => fixtureScore({ poolId: p.id })))
  })
  afterEach(() => db.close())

  const listed = (q: string) => ids(db.pools.list({ q }))
  const scored = (q: string) => ids(db.scores.topBy('health', { q }).items.map((row) => row.pool))

  it('finds a pair written either way round, with any separator', () => {
    const pair = ids([WETH_USDC, WETH_USDC_SLIP])
    for (const q of [
      'WETH/USDC',
      'WETH USDC',
      'weth-usdc',
      'usdc weth',
      'USDC:WETH',
      'WETH, USDC',
    ]) {
      expect(listed(q), q).toEqual(pair)
      expect(scored(q), q).toEqual(pair)
      expect(db.scores.topBy('health', { q }).total, q).toBe(2)
      expect(db.pools.count({ q }), q).toBe(2)
    }
  })

  it('needs every term: one token alone still lists every pool holding it', () => {
    // The Aerodrome Slipstream WETH / USDC pool holds no AERO: its DEX is not searched.
    expect(listed('aero')).toEqual(ids([USDC_AERO, WETH_AERO]))
    expect(listed('AERO/USDC')).toEqual([USDC_AERO.id])
    expect(listed('weth/aero/usdc')).toEqual([])
    expect(listed('weth/dai')).toEqual([])
  })

  it('matches token names at a word start, addresses and symbols anywhere, never the DEX', () => {
    expect(listed('wrapped')).toEqual(ids([WETH_USDC, WETH_USDC_SLIP, WETH_AERO]))
    expect(listed(`${FIXTURE_WETH.address} ${FIXTURE_USDC.address.toUpperCase()}`)).toEqual(
      ids([WETH_USDC, WETH_USDC_SLIP]),
    )
    expect(listed(fixtureAddress(3))).toEqual([USDC_AERO.id])
    expect(listed('slipstream weth')).toEqual([])
    expect(listed('Uniswap v3 WETH')).toEqual([])
    expect(listed(fixtureAddress(2).toUpperCase())).toEqual([WETH_USDC_SLIP.id])
    expect(listed('tether')).toEqual([USDC_USDT.id])
    // "Tether USD" holds "eth" inside a word only: ETH / USDC leaves USDC / USDT out
    expect(listed('ETH/USDC')).toEqual(ids([WETH_USDC, WETH_USDC_SLIP]))
    expect(listed('drome')).toEqual([])
  })

  it("lists exactly the pools core's rule matches", () => {
    const queries = [
      `uniswap-v3:${ID_V3.address}`,
      `uniswap-v3:${ID_V3.address?.toUpperCase()}`,
      'uniswap-v3:0xd0b5',
      'uniswap-v3 : 0xD0B5A',
      `uniswap-v3:${fixtureAddress(1)}`,
      'uniswap-v3:0x000',
      `uniswap-v4:${ID_V4.poolId}`,
      'uniswap-v4:0x96D4',
      `uniswap-v3:${ID_V4.poolId}`,
      `aerodrome-slipstream:${ID_V3.address}`,
      `uniswap-v3:${ID_SLIP.address}`,
      `uniswap-v3%3A${ID_V3.address}`,
      `https://depthwatch.pages.dev/#/pools/uniswap-v4%3A${ID_V4.poolId}?window=7d`,
      `sushiswap:${ID_V3.address}`,
      `degen:${ID_V3.address}`,
      'uniswap-v3:0x',
      'uniswap-v3:0xd0b5 degen',
      'WETH/USDC',
      'eth usdc',
      'ETH',
      'aero',
      'aero usdc',
      'usd',
      'coin',
      'oin',
      'tether',
      'ether',
      'slip',
      'stream',
      'uniswap v3',
      'v2',
      'wrapped weth',
      'WETH, USDC',
      FIXTURE_USDC.address.slice(0, 10),
      'weth %',
      '_',
      ' / ',
      'weth\u0000',
      'usdc\u0000weth',
      '\u0000',
      `uniswap-v3:${ID_V3.address}/`,
    ]
    for (const q of queries) {
      const search = poolSearch(q)
      const expected = ids(ALL.filter((p) => matchesPoolSearch(p, search)))
      expect(listed(q), q).toEqual(expected)
      expect(scored(q), q).toEqual(expected)
      expect(db.pools.count({ q }), q).toBe(expected.length)
    }
  })

  it("agrees with core's rule on every pool's id and its prefixes, on every DEX", () => {
    let found = 0
    for (const pool of ALL) {
      const key = pool.address ?? pool.poolId ?? ''
      for (const dex of DEXES)
        for (const end of [3, 7, 12, key.length]) {
          for (const q of [
            `${dex}:${key.slice(0, end)}`,
            `${dex} : ${key.slice(0, end).toUpperCase()}`,
          ]) {
            const expected = ids(ALL.filter((p) => matchesPoolSearch(p, poolSearch(q))))
            expect(listed(q), q).toEqual(expected)
            found += expected.length
          }
        }
    }
    expect(found).toBeGreaterThan(0)
  })

  it('finds a pasted pool id: the pools on its DEX whose address or pool id starts with it', () => {
    const id = `uniswap-v3:${ID_V3.address}`
    expect(listed(id)).toEqual([ID_V3.id])
    expect(scored(id)).toEqual([ID_V3.id])
    expect(db.pools.count({ q: id })).toBe(1)
    expect(listed(`uniswap-v3:${ID_V3.address?.toUpperCase()}`)).toEqual([ID_V3.id])
    expect(listed('uniswap-v3:0xD0B5')).toEqual(ids([ID_V3, ID_V3_NEXT]))
    expect(listed('uniswap-v3 : 0xd0b5a')).toEqual([ID_V3_NEXT.id])
    expect(listed(`uniswap-v4:${ID_V4.poolId}`)).toEqual([ID_V4.id])
    expect(listed('uniswap-v4:0x96d4')).toEqual([ID_V4.id])
    expect(listed(`uniswap-v3%3A${ID_V3.address}`)).toEqual([ID_V3.id])
    expect(listed(`https://depthwatch.pages.dev/#/pools/uniswap-v3%3A${ID_V3.address}`)).toEqual([
      ID_V3.id,
    ])
  })

  it('finds no pool for the right DEX with another hex, or the hex on another DEX', () => {
    expect(listed(`uniswap-v3:${ID_SLIP.address}`)).toEqual([])
    expect(listed(`uniswap-v3:${ID_V4.poolId}`)).toEqual([])
    expect(listed('uniswap-v3:0xd0b6')).toEqual([])
    expect(listed(`aerodrome-slipstream:${ID_V3.address}`)).toEqual([])
    expect(listed(`uniswap-v4:${ID_V3.address}`)).toEqual([])
    // combined with the DEX filter, both must hold
    expect(ids(db.pools.list({ q: 'uniswap-v3:0xd0b5', dex: 'aerodrome-slipstream' }))).toEqual([])
  })

  it('keeps the term rule for an unknown DEX prefix, which never reads the DEX', () => {
    // "sushiswap" and "v5" match no token or pool
    expect(listed(`sushiswap:${ID_V3.address}`)).toEqual([])
    expect(listed(`uniswap-v5:${ID_V3.address}`)).toEqual([])
    // "degen" is a token of the pool and the hex is in its address
    expect(listed(`degen:${ID_V3.address}`)).toEqual([ID_V3.id])
    // a pool id and more is no pool id: "uniswap" and "v3" match nothing
    expect(listed(`uniswap-v3:${ID_V3.address} degen`)).toEqual([])
  })

  it('keeps LIKE metacharacters literal and ignores a query of separators', () => {
    expect(listed('weth %')).toEqual([])
    expect(listed('_/weth')).toEqual([])
    expect(listed(' / ')).toEqual(ids(ALL))
  })

  it('reads a control character as a separator, never as the end of the LIKE pattern', () => {
    // SQLite's LIKE stops at a NUL: bound as is, "usdc\0weth" would match every "…usdc".
    expect(listed('usdc\u0000weth')).toEqual(ids([WETH_USDC, WETH_USDC_SLIP]))
    expect(db.pools.count({ q: '\u0000' })).toBe(ALL.length)
  })

  it('combines with the other filters', () => {
    expect(ids(db.pools.list({ q: 'usdc weth', dex: 'uniswap-v3' }))).toEqual([WETH_USDC.id])
    expect(db.pools.count({ q: 'usdc weth', tracked: false })).toBe(0)
  })
})

/** Keeps the fixture's shape honest: the pools above hold the tokens their names say. */
describe('fixtures', () => {
  it('builds the pairs the cases rely on', () => {
    const pair = (p: PoolMeta) => `${p.token0.symbol}/${p.token1.symbol}`
    expect(ALL.map(pair)).toEqual([
      'WETH/USDC',
      'WETH/USDC',
      'USDC/AERO',
      'WETH/AERO',
      'USDC/USDT',
      'DEGEN/TOSHI',
      'DEGEN/TOSHI',
      'DEGEN/TOSHI',
      'DEGEN/TOSHI',
    ])
    expect(FIXTURE_WETH.name.toLowerCase()).toContain('wrapped')
    expect(FIXTURE_USDC.name.toLowerCase()).not.toContain('wrapped')
  })
})
