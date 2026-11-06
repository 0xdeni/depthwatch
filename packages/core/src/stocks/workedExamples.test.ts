/**
 * The worked examples of docs/METRICS.md "Reference deviation" and "Stock aggregates", reproduced
 * to the digits the page prints (bps to two decimals, shares to four). A change that moves any
 * figure here must update the page in the same commit.
 */

import { describe, expect, it } from 'vitest'
import { rawToHuman } from '../math.js'
import { makeStock, makeToken, stockRawRead } from '../testing.js'
import { sqrtPriceX96ToPrice } from '../tickMath.js'
import type { Address } from '../types.js'
import { summarizeStock } from './aggregate.js'
import { weeklyCloseAt } from './hours.js'
import {
  evaluateStockReading,
  isHeld,
  type PoolReferenceInput,
  poolReference,
} from './reference.js'
import type { PoolReference, StockPoolInput, StockReading } from './types.js'

const utc = (iso: string): number => Date.parse(iso) / 1000
const twoDp = (x: number | null | undefined): number | null =>
  x == null ? null : Number(x.toFixed(2))
const fourDp = (x: number | null | undefined): number | null =>
  x == null ? null : Number(x.toFixed(4))

/** The repository's addresses (packages/chain): NVDAc sorts after USDC and before cbBTC. */
const NVDAC: Address = '0xb20000000000000000000078ee7ce2fe4908108c'
const nvda = makeStock('NVDAc', { address: NVDAC })
function fail(): never {
  throw new Error('the test stock has a feed')
}
const usdc = makeToken('USDC', 6, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
const cbbtc = makeToken('cbBTC', 8, '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf')

const readAt = (timestamp: number, answer: bigint, updatedAt: number, oraclePaused = false) =>
  evaluateStockReading(nvda, stockRawRead(nvda, answer, updatedAt, { oraclePaused }), {
    blockNumber: 1n,
    timestamp,
  })

describe('METRICS.md "Off-hours": NVDA\'s feed over the weekend of 2026-10-31', () => {
  /** Friday 2026-10-30 19:51:03 UTC, 15:51 New York time: its last round before that weekend. */
  const updatedAt = utc('2026-10-30T19:51:03Z')
  const at = (iso: string) => readAt(utc(iso), 18_026_191_788n, updatedAt)

  it('Friday 23:00:00 UTC (19:00 New York time): age 11,337 s, before the close: live', () => {
    expect(at('2026-10-30T23:00:00Z')).toMatchObject({
      referenceStatus: 'live',
      feedAgeSeconds: 11_337,
    })
  })

  it('Saturday 14:00:00 UTC: age 65,337 s, in the close that began at Saturday 00:00 UTC: held', () => {
    const t = utc('2026-10-31T14:00:00Z')
    expect(at('2026-10-31T14:00:00Z')).toMatchObject({
      referenceStatus: 'held',
      feedAgeSeconds: 65_337,
    })
    expect(weeklyCloseAt(t)?.start).toBe(utc('2026-10-31T00:00:00Z'))
    // By age alone it would read live until Saturday 20:51:03 UTC.
    const byAge = { ...(nvda.feed ?? fail()), hours: '24/7' as const }
    expect(isHeld(byAge, t, updatedAt)).toBe(false)
    expect(isHeld(byAge, utc('2026-10-31T20:51:03Z'), updatedAt)).toBe(false)
    expect(isHeld(byAge, utc('2026-10-31T20:51:04Z'), updatedAt)).toBe(true)
  })

  it('Sunday 22:00:00 UTC (17:00 EST, in the close that ends at Monday 01:00 UTC): age 180,537 s, held by both parts', () => {
    const t = utc('2026-11-01T22:00:00Z')
    expect(at('2026-11-01T22:00:00Z')).toMatchObject({
      referenceStatus: 'held',
      feedAgeSeconds: 180_537,
    })
    expect(weeklyCloseAt(t)?.end).toBe(utc('2026-11-02T01:00:00Z'))
    expect(180_537).toBeGreaterThan(90_000)
  })

  it('Monday 01:00:30 UTC, after the close, before the first new round: age 191,367 s, held by its age', () => {
    expect(weeklyCloseAt(utc('2026-11-02T01:00:30Z'))).toBeNull()
    expect(at('2026-11-02T01:00:30Z')).toMatchObject({
      referenceStatus: 'held',
      feedAgeSeconds: 191_367,
    })
  })

  it('at exactly 90,000 s, on a weekday outside a close, the status is still live', () => {
    const wednesday = utc('2026-11-04T15:00:00Z')
    expect(readAt(wednesday, 18_026_191_788n, wednesday - 90_000)).toMatchObject({
      referenceStatus: 'live',
      feedAgeSeconds: 90_000,
    })
  })
})

/** Wednesday 2026-11-04 15:00:00 UTC. */
const WEDNESDAY = utc('2026-11-04T15:00:00Z')
const SATURDAY = utc('2026-11-07T15:00:00Z')
const liveAt199_50 = readAt(WEDNESDAY, 19_950_000_000n, WEDNESDAY - 1_800)

/** "An NVDAc/USDC Slipstream pool at a 0.05 % fee: USDC is token0, NVDAc token1, price = 0.005." */
function example(
  overrides: Partial<PoolReferenceInput> = {},
  reading: StockReading = liveAt199_50,
) {
  return poolReference({
    pool: { token0: usdc, token1: nvda.token, hooks: null },
    price: 0.005,
    token0Usd: 1,
    token1Usd: 200,
    depth2UpUsd: 52_000,
    depth2DownUsd: 40_000,
    feePips: 500,
    quoteIndependent: true,
    stocks: new Map([[NVDAC, { info: nvda, reading }]]),
    ...overrides,
  })
}

describe('METRICS.md "Reference deviation": worked example', () => {
  it('poolUsd = 1 / 0.005 = $200.00, referenceUsd = $199.50, age 1,800 s: live', () => {
    expect(liveAt199_50).toMatchObject({
      referenceStatus: 'live',
      referenceUsd: 199.5,
      feedAgeSeconds: 1_800,
    })
    expect(twoDp(example()?.poolUsd)).toBe(200)
  })

  it('+25.06 bps against a tolerance of 50 + 500 / 100 = 55: within the band', () => {
    const ref = example()
    expect(twoDp(ref?.deviationBps)).toBe(25.06)
    expect(ref).toMatchObject({
      toleranceBps: 55,
      deviationThresholdBps: 50,
      feeBps: 5,
      withinTolerance: true,
      deviationNull: null,
    })
  })

  it('had the feed answered 19700000000 ($197.00): +152.28 bps, outside', () => {
    const ref = example({}, readAt(WEDNESDAY, 19_700_000_000n, WEDNESDAY - 1_800))
    expect(twoDp(ref?.deviationBps)).toBe(152.28)
    expect(ref?.withinTolerance).toBe(false)
  })

  it('NVDAc/cbBTC at 0.30 %, 0.002 cbBTC per NVDAc, cbBTC at $100,000: the same +25.06 bps, tolerance 80', () => {
    const ref = example({
      pool: { token0: nvda.token, token1: cbbtc, hooks: null },
      price: 0.002,
      token0Usd: 200,
      token1Usd: 100_000,
      feePips: 3_000,
    })
    expect(twoDp(ref?.poolUsd)).toBe(200)
    expect(twoDp(ref?.deviationBps)).toBe(25.06)
    expect(ref).toMatchObject({
      toleranceBps: 80,
      deviationThresholdBps: 50,
      feeBps: 30,
      withinTolerance: true,
    })
  })

  it('$3,000 on the thinner side: thin; on a Saturday: held, $199.50 still published', () => {
    expect(example({ depth2DownUsd: 3_000 })).toMatchObject({
      deviationBps: null,
      deviationNull: 'thin',
    })
    const held = example({}, readAt(SATURDAY, 19_950_000_000n, utc('2026-11-06T20:51:03Z')))
    expect(held).toMatchObject({
      deviationBps: null,
      toleranceBps: null,
      withinTolerance: null,
      deviationNull: 'held',
      referenceStatus: 'held',
      referenceUsd: 199.5,
    })
  })

  it("the multiplier is never applied: it would understate the deviation by 5.38 bps for NVDAc's", () => {
    const m = 1_000_537_939_576_369_481n
    const reading = evaluateStockReading(
      nvda,
      stockRawRead(nvda, 19_950_000_000n, WEDNESDAY - 1_800, {
        oracleMultiplierWad: m,
        tokenMultiplierWad: m,
      }),
      { blockNumber: 1n, timestamp: WEDNESDAY },
    )
    const used = example({}, reading)?.deviationBps ?? Number.NaN
    expect(twoDp(used)).toBe(25.06)
    const multiplier = rawToHuman(m, 18)
    const perShare = (200 / (199.5 * multiplier) - 1) * 10_000
    expect(twoDp((multiplier - 1) * 10_000)).toBe(5.38)
    expect(used - perShare).toBeCloseTo(5.38, 1)
  })

  it('on chain at block 53,663,272: the Aero Slipstream NVDAc/USDC pool at $180.4632, +11.17 bps', () => {
    const t = 1_793_923_030 // 2026-11-05 23:57:10 UTC
    const price = sqrtPriceX96ToPrice(58_977_342_723_604_087_960_932_729_566n, 6, 8)
    const reading = readAt(t, 18_026_191_788n, utc('2026-11-05T23:36:02Z'))
    expect(reading).toMatchObject({
      referenceStatus: 'live',
      referenceUsd: 180.26191788,
      feedAgeSeconds: 1_268,
    })
    // The pool's sides at that block are not on the page; any above the $5,000 floor will do.
    const ref = example({ price, feePips: null }, reading)
    expect(fourDp(ref?.poolUsd)).toBe(180.4632)
    expect(twoDp(ref?.deviationBps)).toBe(11.17)
    // Inside the feed's 50 bps band before the pool's fee is even added.
    expect(Math.abs(ref?.deviationBps ?? Number.NaN)).toBeLessThan(50)
  })
})

describe('METRICS.md "Stock aggregates": worked example', () => {
  const p1Reference = example()
  if (p1Reference === null) throw new Error('P1 is a stock pool')
  const other: PoolReference = {
    ...p1Reference,
    deviationBps: null,
    toleranceBps: null,
    deviationThresholdBps: null,
    feeBps: null,
    withinTolerance: null,
    deviationNull: 'thin',
  }
  /** NVDAc is token1 in all four: up is the sell side, down the buy side. */
  const row = (
    poolId: string,
    dex: StockPoolInput['dex'],
    up: number,
    down: number,
    tvlUsd: number | null,
    spread10kBps: number | null,
    volume24hUsd: number | null,
    staleQuote: boolean,
    reference: PoolReference,
  ): StockPoolInput => ({
    poolId,
    dex,
    token0: usdc.address,
    token1: NVDAC,
    tvlUsd,
    depth2UpUsd: up,
    depth2DownUsd: down,
    spread10kBps,
    staleQuote,
    volume24hUsd,
    reference,
  })
  const pools = [
    row('P1', 'aero-slipstream', 260_000, 250_000, 1_500_000, 30, 400_000, false, p1Reference),
    row('P2', 'uniswap-v3', 40_000, 50_000, 200_000, 120, 100_000, false, other),
    row('P3', 'uniswap-v4', 10_000, 10_000, null, 80, null, false, other),
    row('P4', 'aero-v2', 3_000, 0, 5_000, null, 0, true, other),
  ]
  const agg = summarizeStock(NVDAC, pools)

  it('TVL $1,705,000 over 3 pools; depth $310,000 a side over 3; spread 30 bps (P1); volume $500,000 over 3', () => {
    expect(agg).toMatchObject({
      poolCount: 4,
      tvlUsd: 1_705_000,
      tvlKnownPools: 3,
      depth2BuyUsd: 310_000,
      depth2SellUsd: 310_000,
      sidesKnownPools: 3,
      spread10kBps: 30,
      spread10kPoolId: 'P1',
      volume24hUsd: 500_000,
      volumeKnownPools: 3,
    })
  })

  it('venues: depth and volume shares as printed', () => {
    const printed = agg.venues.map((v) => ({
      dex: v.dex,
      depth2Usd: v.depth2Usd,
      depthShare: fourDp(v.depthShare),
      volume24hUsd: v.volume24hUsd,
      volumeShare: fourDp(v.volumeShare),
    }))
    expect(printed).toEqual([
      {
        dex: 'uniswap-v3',
        depth2Usd: 90_000,
        depthShare: 0.1452,
        volume24hUsd: 100_000,
        volumeShare: 0.2,
      },
      {
        dex: 'uniswap-v4',
        depth2Usd: 20_000,
        depthShare: 0.0323,
        volume24hUsd: null,
        volumeShare: null,
      },
      { dex: 'aero-v2', depth2Usd: null, depthShare: null, volume24hUsd: 0, volumeShare: 0 },
      {
        dex: 'aero-slipstream',
        depth2Usd: 510_000,
        depthShare: 0.8226,
        volume24hUsd: 400_000,
        volumeShare: 0.8,
      },
    ])
  })

  it("deepest: P1; the stock's deviation is P1's, +25.06 bps within tolerance", () => {
    expect(agg.deepestPoolId).toBe('P1')
    expect(twoDp(agg.deviationBps)).toBe(25.06)
    expect(agg).toMatchObject({ withinTolerance: true, deviationNull: null })
  })

  it("were NVDAc's transfers paused: no pool counts, TVL and volume unchanged", () => {
    const paused = summarizeStock(
      NVDAC,
      pools.map((p) => ({
        ...p,
        reference: p.reference && { ...p.reference, transfersPaused: true },
      })),
    )
    expect(paused).toMatchObject({
      depth2BuyUsd: null,
      depth2SellUsd: null,
      sidesKnownPools: 0,
      spread10kBps: null,
      spread10kPoolId: null,
      deepestPoolId: null,
      deviationBps: null,
      withinTolerance: null,
      deviationNull: 'no-pool',
      tvlUsd: 1_705_000,
      volume24hUsd: 500_000,
    })
  })
})
