/**
 * The stock list (docs/design/stocks.md §5): the snapshot step replaces it at every pass, and the
 * API reads which tokens are stocks from it alone. A stock without a feed keeps `feed: null`.
 */
import { type Address, makeStock } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'

const NVDA = makeStock('NVDAc')
const AMZN = makeStock('AMZNc', { feed: { hours: '24/7', heartbeatSeconds: 3_600 } })
const NOFEED = makeStock('ZZZc', { feed: null })

const upper = (address: Address) => `0x${address.slice(2).toUpperCase()}`

describe('StocksRepo', () => {
  let db: Database
  let now = 1_700_000_000
  beforeEach(() => {
    now = 1_700_000_000
    db = openDatabase(':memory:', { now: () => now })
  })
  afterEach(() => db.close())

  it('round-trips the stock list with its feeds, by ticker, and a stock without a feed', () => {
    expect(db.stocks.replaceAll([NVDA, NOFEED, AMZN])).toBe(3)
    expect(db.stocks.list()).toEqual([
      { ...AMZN, updatedAt: now },
      { ...NVDA, updatedAt: now },
      { ...NOFEED, updatedAt: now },
    ])
    expect(db.stocks.get(NOFEED.token.address)).toEqual({ ...NOFEED, updatedAt: now })
    expect(db.stocks.get(AMZN.token.address)?.feed).toEqual({
      address: AMZN.feed?.address,
      decimals: 8,
      heartbeatSeconds: 3_600,
      deviationThresholdBps: 50,
      hours: '24/7',
    })
    expect(db.stocks.count()).toBe(3)
  })

  it('stores and finds addresses lowercase', () => {
    const feed = NVDA.feed
    if (feed === null) throw new Error('NVDAc has a feed')
    const shouting = {
      ...NVDA,
      token: { ...NVDA.token, address: upper(NVDA.token.address) as Address },
      feed: { ...feed, address: upper(feed.address) as Address },
    }
    db.stocks.replaceAll([shouting])
    expect(db.stocks.get(upper(NVDA.token.address))).toEqual({ ...NVDA, updatedAt: now })
    expect(db.stocks.list()[0]?.feed?.address).toBe(feed.address)
  })

  it('replaces the whole list at every write, with its time', () => {
    db.stocks.replaceAll([NVDA, AMZN])
    now += 1_800
    expect(db.stocks.replaceAll([AMZN])).toBe(1)
    expect(db.stocks.list()).toEqual([{ ...AMZN, updatedAt: now }])
    expect(db.stocks.get(NVDA.token.address)).toBeUndefined()
    db.stocks.replaceAll([NVDA], 42)
    expect(db.stocks.get(NVDA.token.address)?.updatedAt).toBe(42)
    expect(db.stocks.replaceAll([])).toBe(0)
    expect(db.stocks.list()).toEqual([])
  })

  it('refuses a token listed twice and keeps the list it had', () => {
    db.stocks.replaceAll([NVDA])
    expect(() => db.stocks.replaceAll([AMZN, AMZN])).toThrow(/UNIQUE/)
    expect(db.stocks.list()).toEqual([{ ...NVDA, updatedAt: now }])
  })
})
