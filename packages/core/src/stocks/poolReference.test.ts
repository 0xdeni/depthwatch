import { describe, expect, it } from 'vitest'
import { makeStock, makeToken, stockRawRead } from '../testing.js'
import type { Address } from '../types.js'
import { evaluateStockReading, type PoolReferenceInput, poolReference } from './reference.js'
import type { StockInfo, StockReading } from './types.js'

const WEDNESDAY = Date.parse('2026-11-04T15:00:00Z') / 1000
const block = { blockNumber: 53_663_272n, timestamp: WEDNESDAY }

const nvda = makeStock('NVDAc')
const tsla = makeStock('TSLAc')
/** USDC (0x7573…) sorts before the stocks (0xb2…): the stock is token1 against it. */
const usdc = makeToken('USDC', 6)
/** cbBTC sorts after them: the stock is token0 against it. */
const cbbtc = makeToken('cbBTC', 8, '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf')
/** A dollar token after the stocks, for exact arithmetic with the stock as token0. */
const dusd = makeToken('dUSD', 6, '0xd000000000000000000000000000000000000001')

const reading = (stock: StockInfo, answer: bigint, age = 1_800, ordinals: number[] = []) =>
  evaluateStockReading(
    stock,
    stockRawRead(stock, answer, WEDNESDAY - age, { pausedOrdinals: ordinals }),
    block,
  )
const entry = (info: StockInfo, r: StockReading) =>
  [info.token.address, { info, reading: r }] as const

const LIVE = reading(nvda, 19_950_000_000n)
const stocksWith = (
  r: StockReading,
  more: (readonly [Address, { info: StockInfo; reading: StockReading }])[] = [],
) => new Map([entry(nvda, r), ...more])

/** The METRICS.md example: NVDAc/USDC at 0.005 NVDAc per USDC, $40,000 on its thinner side. */
function input(overrides: Partial<PoolReferenceInput> = {}): PoolReferenceInput {
  return {
    pool: { token0: usdc, token1: nvda.token, hooks: null },
    price: 0.005,
    token0Usd: 1,
    token1Usd: 205, // the price graph's value for the stock: never used
    depth2UpUsd: 45_000,
    depth2DownUsd: 40_000,
    feePips: 500,
    quoteIndependent: true,
    stocks: stocksWith(LIVE),
    ...overrides,
  }
}

describe('poolReference: the deviation', () => {
  it('is null for a pool with no stock', () => {
    expect(poolReference(input({ pool: { token0: usdc, token1: cbbtc, hooks: null } }))).toBeNull()
    expect(poolReference(input({ stocks: new Map() }))).toBeNull()
  })

  it('a live pool: poolUsd from the quote only, the signed deviation and its band', () => {
    const ref = poolReference(input())
    expect(ref).toMatchObject({
      stock: nvda.token.address,
      poolUsd: 200,
      referenceUsd: 199.5,
      referenceStatus: 'live',
      feedAgeSeconds: 1_800,
      toleranceBps: 55,
      // The band's two parts, published beside their sum.
      deviationThresholdBps: 50,
      feeBps: 5,
      withinTolerance: true,
      deviationNull: null,
      transfersPaused: false,
    })
    expect(ref?.deviationBps).toBeCloseTo(25.0627, 4)
  })

  it('finds the stock whatever the case of the pool token address', () => {
    const upper = { ...nvda.token, address: nvda.token.address.toUpperCase() as Address }
    const ref = poolReference(input({ pool: { token0: usdc, token1: upper, hooks: null } }))
    expect(ref?.stock).toBe(nvda.token.address)
    expect(ref?.deviationNull).toBeNull()
  })

  it('signs on both orientations: positive when the pool is above the feed', () => {
    const asToken1 = (price: number) => poolReference(input({ price }))?.deviationBps ?? Number.NaN
    expect(asToken1(0.005)).toBeGreaterThan(0) // $200.00
    expect(asToken1(0.00502)).toBeLessThan(0) // $199.20
    const asToken0 = (price: number) =>
      poolReference(
        input({
          pool: { token0: nvda.token, token1: cbbtc, hooks: null },
          price,
          token0Usd: 205,
          token1Usd: 100_000,
        }),
      )?.deviationBps ?? Number.NaN
    expect(asToken0(0.002)).toBeCloseTo(25.0627, 4) // $200.00
    expect(asToken0(0.00199)).toBeCloseTo(-25.0627, 4) // $199.00
  })

  it('withinTolerance at, inside and outside the band, and null with the fee unknown', () => {
    // NVDAc/dUSD, the stock token0, the feed at $64: 65/64 − 1 = +156.25 bps exactly.
    const at64 = stocksWith(reading(nvda, 6_400_000_000n))
    const exact = (price: number, feePips: number | null) =>
      poolReference(
        input({
          pool: { token0: nvda.token, token1: dusd, hooks: null },
          price,
          token0Usd: 64,
          token1Usd: 1,
          feePips,
          stocks: at64,
        }),
      )
    expect(exact(65, 10_625)).toMatchObject({
      deviationBps: 156.25,
      toleranceBps: 156.25,
      withinTolerance: true,
    })
    expect(exact(63, 10_625)).toMatchObject({ deviationBps: -156.25, withinTolerance: true })
    expect(exact(65, 10_624)).toMatchObject({
      toleranceBps: 156.24,
      deviationThresholdBps: 50,
      feeBps: 106.24,
      withinTolerance: false,
    })
    expect(exact(64.32, 500)?.withinTolerance).toBe(true) // +50 bps inside 55
    expect(exact(65, 0)).toMatchObject({ toleranceBps: 50, withinTolerance: false })
    expect(exact(65, null)).toMatchObject({
      deviationBps: 156.25,
      toleranceBps: null,
      deviationThresholdBps: null,
      feeBps: null,
      withinTolerance: null,
      deviationNull: null,
    })
  })
})

describe('poolReference: deviationNull, the first that applies', () => {
  const nulls = {
    deviationBps: null,
    toleranceBps: null,
    deviationThresholdBps: null,
    feeBps: null,
    withinTolerance: null,
  }

  it('hooked first, before thin: the mid is not known to be a price a swap gets', () => {
    const hooked = poolReference(
      input({
        pool: {
          token0: usdc,
          token1: nvda.token,
          hooks: '0x00000000000000000000000000000000000000c0',
        },
        depth2UpUsd: null,
        depth2DownUsd: null,
      }),
    )
    expect(hooked).toMatchObject({ ...nulls, deviationNull: 'hooked', poolUsd: null })
    const zeroHook = '0x0000000000000000000000000000000000000000'
    expect(
      poolReference(input({ pool: { token0: usdc, token1: nvda.token, hooks: zeroHook } }))
        ?.deviationNull,
    ).toBeNull()
  })

  it('thin right after hooked: the thinner side under $5,000 or unknown, before every other reason', () => {
    expect(poolReference(input({ depth2DownUsd: 4_999.99 }))).toMatchObject({
      ...nulls,
      deviationNull: 'thin',
    })
    expect(poolReference(input({ depth2UpUsd: 5_000 }))?.deviationNull).toBeNull()
    expect(poolReference(input({ depth2UpUsd: null }))?.deviationNull).toBe('thin')
    // A quote with no USD price leaves its side without one: thin, not quote-unpriced.
    expect(poolReference(input({ token0Usd: null, depth2DownUsd: null }))).toMatchObject({
      deviationNull: 'thin',
      poolUsd: null,
    })
    const held = stocksWith(reading(nvda, 19_950_000_000n, 100_000))
    expect(poolReference(input({ depth2UpUsd: 3_000, stocks: held }))?.deviationNull).toBe('thin')
  })

  it('stock-pair before the status: token0 is the reference, either pause pauses', () => {
    const held = reading(tsla, 33_866_000_000n, 100_000)
    const pair = (a: StockReading, b: StockReading) =>
      poolReference(
        input({
          pool: { token0: nvda.token, token1: tsla.token, hooks: null },
          price: 0.59,
          token0Usd: 200,
          token1Usd: 338.66,
          stocks: stocksWith(a, [entry(tsla, b)]),
        }),
      )
    expect(pair(LIVE, held)).toMatchObject({
      ...nulls,
      stock: nvda.token.address,
      referenceStatus: 'live',
      deviationNull: 'stock-pair',
      transfersPaused: false,
    })
    expect(pair(LIVE, held)?.poolUsd).toBeCloseTo(199.81, 2) // measured, never compared
    const pausedOf = (s: StockInfo) => reading(s, 33_866_000_000n, 60, [0])
    const unknownOf = (s: StockInfo) =>
      evaluateStockReading(s, stockRawRead(s, 1n, WEDNESDAY, { pausedOrdinals: null }), block)
    expect(pair(LIVE, pausedOf(tsla))?.transfersPaused).toBe(true)
    expect(pair(pausedOf(nvda), held)?.transfersPaused).toBe(true)
    expect(pair(LIVE, unknownOf(tsla))?.transfersPaused).toBeNull()
    expect(pair(unknownOf(nvda), pausedOf(tsla))?.transfersPaused).toBe(true)
  })

  it("the reading's status when it is not live; held and paused keep the answer", () => {
    const cases: [StockReading, string, number | null][] = [
      [reading(nvda, 19_950_000_000n, 100_000), 'held', 199.5],
      [
        evaluateStockReading(
          nvda,
          stockRawRead(nvda, 19_950_000_000n, WEDNESDAY - 60, { oraclePaused: true }),
          block,
        ),
        'paused',
        199.5,
      ],
      [evaluateStockReading(nvda, stockRawRead(nvda, 0n, WEDNESDAY - 60), block), 'invalid', null],
      [evaluateStockReading(nvda, null, block, 'timeout'), 'unread', null],
      [evaluateStockReading(makeStock('NVDAc', { feed: null }), null, block), 'no-feed', null],
    ]
    for (const [r, status, usd] of cases) {
      const ref = poolReference(input({ stocks: stocksWith(r) }))
      expect(ref, status).toMatchObject({
        ...nulls,
        deviationNull: status,
        referenceStatus: status,
        referenceUsd: usd,
        poolUsd: 200,
      })
    }
  })

  it('quote-unpriced last: the quote priced through a pool of the stock itself', () => {
    expect(poolReference(input({ quoteIndependent: false }))).toMatchObject({
      ...nulls,
      deviationNull: 'quote-unpriced',
      poolUsd: null,
      referenceUsd: 199.5,
    })
    expect(poolReference(input({ price: 0 }))?.deviationNull).toBe('quote-unpriced')
  })

  it('a live reading without its answer in USD is no reference: invalid', () => {
    const broken: StockReading = { ...LIVE, referenceUsd: null }
    expect(poolReference(input({ stocks: stocksWith(broken) }))?.deviationNull).toBe('invalid')
  })

  it('a pool whose transfers are paused keeps its deviation', () => {
    const paused = stocksWith(reading(nvda, 19_950_000_000n, 1_800, [0, 2]))
    const ref = poolReference(input({ stocks: paused }))
    expect(ref).toMatchObject({ transfersPaused: true, withinTolerance: true, deviationNull: null })
    expect(ref?.deviationBps).toBeCloseTo(25.0627, 4)
  })
})
