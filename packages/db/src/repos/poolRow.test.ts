/**
 * The pool search (`PoolFilter.q`) in SQL: every term matching either token, the pool or the DEX,
 * in any order, through both `pools.list` and `scores.topBy`, exactly as core's `matchesPoolTerms`
 * decides it for the same pools.
 */
import { matchesPoolTerms, type PoolMeta, poolQueryTerms, type TokenInfo } from '@depthwatch/core'
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
const ALL = [WETH_USDC, WETH_USDC_SLIP, USDC_AERO, WETH_AERO, USDC_USDT]

const ids = (pools: readonly { id: string }[]) => pools.map((p) => p.id).sort()

describe('filterReadsTokens', () => {
  it('reads the token columns only when the query has a term', () => {
    expect(filterReadsTokens({ q: 'weth' })).toBe(true)
    expect(filterReadsTokens({ q: ' / ' })).toBe(false)
    expect(filterReadsTokens({ dex: 'uniswap-v3' })).toBe(false)
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
    for (const q of ['WETH/USDC', 'WETH USDC', 'weth-usdc', 'usdc weth', 'USDC:WETH']) {
      expect(listed(q), q).toEqual(pair)
      expect(scored(q), q).toEqual(pair)
      expect(db.scores.topBy('health', { q }).total, q).toBe(2)
      expect(db.pools.count({ q }), q).toBe(2)
    }
  })

  it('needs every term: one token alone still lists every pool holding it', () => {
    expect(listed('aero')).toEqual(ids([WETH_USDC_SLIP, USDC_AERO, WETH_AERO]))
    // "aero" is also the start of the Aerodrome DEXes, and any term may match the DEX
    expect(listed('AERO/USDC')).toEqual(ids([WETH_USDC_SLIP, USDC_AERO]))
    expect(listed('weth/aero/usdc')).toEqual(ids([WETH_USDC_SLIP]))
    expect(listed('weth/dai')).toEqual([])
  })

  it('matches token names and the DEX at a word start, addresses and symbols anywhere', () => {
    expect(listed('wrapped')).toEqual(ids([WETH_USDC, WETH_USDC_SLIP, WETH_AERO]))
    expect(listed(`${FIXTURE_WETH.address} ${FIXTURE_USDC.address.toUpperCase()}`)).toEqual(
      ids([WETH_USDC, WETH_USDC_SLIP]),
    )
    expect(listed(fixtureAddress(3))).toEqual([USDC_AERO.id])
    expect(listed('slipstream weth')).toEqual([WETH_USDC_SLIP.id])
    expect(listed('Uniswap v3 WETH')).toEqual(ids([WETH_USDC, WETH_AERO]))
    expect(listed(WETH_USDC_SLIP.id)).toEqual([WETH_USDC_SLIP.id])
    expect(listed('tether')).toEqual([USDC_USDT.id])
    // "Tether USD" holds "eth" inside a word only: ETH / USDC leaves USDC / USDT out
    expect(listed('ETH/USDC')).toEqual(ids([WETH_USDC, WETH_USDC_SLIP]))
    expect(listed('drome')).toEqual([])
  })

  it("lists exactly the pools core's rule matches", () => {
    const queries = [
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
      FIXTURE_USDC.address.slice(0, 10),
      'weth %',
      '_',
      ' / ',
    ]
    for (const q of queries) {
      const terms = poolQueryTerms(q)
      expect(listed(q), q).toEqual(ids(ALL.filter((p) => matchesPoolTerms(p, terms))))
    }
  })

  it('keeps LIKE metacharacters literal and ignores a query of separators', () => {
    expect(listed('weth %')).toEqual([])
    expect(listed('_/weth')).toEqual([])
    expect(listed(' / ')).toEqual(ids(ALL))
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
    expect(ALL.map(pair)).toEqual(['WETH/USDC', 'WETH/USDC', 'USDC/AERO', 'WETH/AERO', 'USDC/USDT'])
    expect(FIXTURE_WETH.name.toLowerCase()).toContain('wrapped')
    expect(FIXTURE_USDC.name.toLowerCase()).not.toContain('wrapped')
  })
})
