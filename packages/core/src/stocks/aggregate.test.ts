import { describe, expect, it } from 'vitest'
import type { Address } from '../types.js'
import {
  countsInStockSums,
  newerReadingPauses,
  stockPassDepth,
  stockSides,
  summarizeStock,
} from './aggregate.js'
import type { PoolReference, StockPoolInput } from './types.js'

const NVDA: Address = '0xb20000000000000000000078ee7ce2fe4908108c'
const USDC: Address = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const CBBTC: Address = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'

const ref = (overrides: Partial<PoolReference> = {}): PoolReference => ({
  stock: NVDA,
  poolUsd: 200,
  referenceUsd: 199.5,
  referenceStatus: 'live',
  feedAgeSeconds: 1_800,
  deviationBps: 25.06,
  toleranceBps: 55,
  deviationThresholdBps: 50,
  feeBps: 5,
  withinTolerance: true,
  deviationNull: null,
  transfersPaused: false,
  ...overrides,
})

/** NVDAc as token1 against USDC: its buy side is the down level. */
const pool = (poolId: string, overrides: Partial<StockPoolInput> = {}): StockPoolInput => ({
  poolId,
  dex: 'uniswap-v3',
  token0: USDC,
  token1: NVDA,
  tvlUsd: 100_000,
  depth2UpUsd: 20_000,
  depth2DownUsd: 30_000,
  spread10kBps: 50,
  staleQuote: false,
  volume24hUsd: 10_000,
  reference: ref(),
  ...overrides,
})

describe('stockSides and countsInStockSums', () => {
  it('buy is the side whose input is the quote, on both orientations, in any case', () => {
    expect(stockSides(NVDA, USDC, 1, 2)).toEqual({ buyUsd: 2, sellUsd: 1 }) // stock token1
    expect(stockSides(NVDA, NVDA, 1, 2)).toEqual({ buyUsd: 1, sellUsd: 2 }) // stock token0
    expect(stockSides(NVDA.toUpperCase() as Address, NVDA, 1, null)).toEqual({
      buyUsd: 1,
      sellUsd: null,
    })
  })

  it('a pool counts unless its quote is stale or its transfers are paused', () => {
    expect(countsInStockSums(pool('a'))).toBe(true)
    expect(countsInStockSums(pool('a', { staleQuote: true }))).toBe(false)
    expect(countsInStockSums(pool('a', { reference: ref({ transfersPaused: true }) }))).toBe(false)
    expect(countsInStockSums(pool('a', { reference: ref({ transfersPaused: null }) }))).toBe(true)
    expect(countsInStockSums(pool('a', { reference: null }))).toBe(true)
    // A newer reading that finds the transfers paused leaves the pool out, reference or not.
    expect(countsInStockSums(pool('a', { pausedByNewerReading: true }))).toBe(false)
    expect(countsInStockSums(pool('a', { reference: null, pausedByNewerReading: true }))).toBe(
      false,
    )
    expect(countsInStockSums(pool('a', { pausedByNewerReading: false }))).toBe(true)
  })

  it('a newer reading pauses a pool only when it is later than the snapshot and paused', () => {
    const at = (blockNumber: bigint, transfersPaused: boolean | null) => ({
      blockNumber,
      transfersPaused,
    })
    expect(newerReadingPauses(100n, [at(101n, true)])).toBe(true)
    // The snapshot's own block: its reference already holds that reading's pause.
    expect(newerReadingPauses(100n, [at(100n, true)])).toBe(false)
    expect(newerReadingPauses(100n, [at(99n, true)])).toBe(false)
    // Unknown is not a pause, and a resumed reading lifts no snapshot's pause.
    expect(newerReadingPauses(100n, [at(101n, null), at(101n, false)])).toBe(false)
    // Either stock of a pool of two; a pool without a snapshot is older than any reading.
    expect(newerReadingPauses(100n, [undefined, at(101n, true)])).toBe(true)
    expect(newerReadingPauses(null, [at(1n, true)])).toBe(true)
    expect(newerReadingPauses(null, [undefined])).toBe(false)
  })
})

describe('summarizeStock', () => {
  it('no pool: counts of 0, sums null, no venue, no-pool', () => {
    expect(summarizeStock(NVDA, [])).toEqual({
      token: NVDA,
      poolCount: 0,
      tvlUsd: null,
      tvlKnownPools: 0,
      depth2BuyUsd: null,
      depth2SellUsd: null,
      sidesKnownPools: 0,
      spread10kBps: null,
      spread10kPoolId: null,
      volume24hUsd: null,
      volumeKnownPools: 0,
      venues: [],
      deepestPoolId: null,
      deviationBps: null,
      withinTolerance: null,
      deviationNull: 'no-pool',
    })
  })

  it('ignores a pool that does not hold the stock, and reads the token in any case', () => {
    const other = pool('x', { token0: USDC, token1: CBBTC, tvlUsd: 9e9 })
    const agg = summarizeStock(NVDA.toUpperCase() as Address, [pool('a'), other])
    expect(agg).toMatchObject({ token: NVDA, poolCount: 1, tvlUsd: 100_000 })
  })

  it('stale and paused pools leave the depth, the spread and the deepest pool, not TVL or volume', () => {
    const pools = [
      pool('a', { depth2UpUsd: 10_000, depth2DownUsd: 10_000, spread10kBps: 80 }),
      pool('b', { staleQuote: true, depth2UpUsd: 1e6, depth2DownUsd: 1e6, spread10kBps: 5 }),
      pool('c', {
        dex: 'aero-slipstream',
        depth2UpUsd: 1e6,
        depth2DownUsd: 1e6,
        spread10kBps: 4,
        reference: ref({ transfersPaused: true }),
      }),
    ]
    const agg = summarizeStock(NVDA, pools)
    expect(agg).toMatchObject({
      poolCount: 3,
      tvlUsd: 300_000,
      tvlKnownPools: 3,
      depth2BuyUsd: 10_000,
      depth2SellUsd: 10_000,
      sidesKnownPools: 1,
      spread10kBps: 80,
      spread10kPoolId: 'a',
      volume24hUsd: 30_000,
      volumeKnownPools: 3,
      deepestPoolId: 'a',
    })
    // The paused pool's venue is listed, with no depth of its own.
    expect(agg.venues.find((v) => v.dex === 'aero-slipstream')).toEqual({
      dex: 'aero-slipstream',
      poolCount: 1,
      depth2Usd: null,
      depthShare: null,
      volume24hUsd: 10_000,
      volumeShare: 10_000 / 30_000,
    })
  })

  it('a newer paused reading leaves out every pool its stock is in, as METRICS.md says', () => {
    const agg = summarizeStock(NVDA, [
      pool('a', { pausedByNewerReading: true }),
      pool('b', { pausedByNewerReading: true, reference: null }),
    ])
    expect(agg).toMatchObject({
      poolCount: 2,
      tvlUsd: 200_000,
      volume24hUsd: 20_000,
      depth2BuyUsd: null,
      depth2SellUsd: null,
      sidesKnownPools: 0,
      spread10kBps: null,
      deepestPoolId: null,
      deviationBps: null,
      deviationNull: 'no-pool',
    })
  })

  it("a Uniswap v4 pool's unknown TVL: the sum is a lower bound over the known pools", () => {
    const agg = summarizeStock(NVDA, [pool('a'), pool('v4', { dex: 'uniswap-v4', tvlUsd: null })])
    expect(agg).toMatchObject({ poolCount: 2, tvlUsd: 100_000, tvlKnownPools: 1 })
    expect(summarizeStock(NVDA, [pool('v4', { tvlUsd: null })]).tvlUsd).toBeNull()
  })

  it('a counted pool with one side unknown stays out of the sides, not out of the spread', () => {
    const agg = summarizeStock(NVDA, [
      pool('a', { spread10kBps: 90 }),
      pool('b', { depth2UpUsd: null, spread10kBps: 40 }),
    ])
    expect(agg).toMatchObject({ depth2BuyUsd: 30_000, depth2SellUsd: 20_000, sidesKnownPools: 1 })
    expect(agg).toMatchObject({ spread10kBps: 40, spread10kPoolId: 'b', deepestPoolId: 'a' })
    // An infeasible spread is no spread.
    expect(summarizeStock(NVDA, [pool('a', { spread10kBps: null })]).spread10kBps).toBeNull()
  })

  it('the deepest pool: the larger thinner side, then the larger total, then the lower id', () => {
    const deepest = (...pools: StockPoolInput[]) => summarizeStock(NVDA, pools).deepestPoolId
    // b is deeper on one side only: a's thinner side wins.
    expect(
      deepest(
        pool('a', { depth2UpUsd: 50_000, depth2DownUsd: 50_000 }),
        pool('b', { depth2UpUsd: 40_000, depth2DownUsd: 900_000 }),
      ),
    ).toBe('a')
    expect(
      deepest(
        pool('a', { depth2UpUsd: 50_000, depth2DownUsd: 50_000 }),
        pool('b', { depth2UpUsd: 50_000, depth2DownUsd: 60_000 }),
      ),
    ).toBe('b')
    expect(deepest(pool('b'), pool('a'), pool('c'))).toBe('a')
  })

  it('the lowest spread ties to the lower pool id', () => {
    const agg = summarizeStock(NVDA, [
      pool('c', { spread10kBps: 30 }),
      pool('b', { spread10kBps: 30 }),
    ])
    expect(agg).toMatchObject({ spread10kBps: 30, spread10kPoolId: 'b' })
  })

  it('venues in DEXES order with depth and volume shares of 0..1', () => {
    const agg = summarizeStock(NVDA, [
      pool('s', {
        dex: 'aero-slipstream',
        depth2UpUsd: 24_000,
        depth2DownUsd: 24_000,
        volume24hUsd: 0,
      }),
      pool('u1', { depth2UpUsd: 10_000, depth2DownUsd: 10_000, volume24hUsd: 30_000 }),
      pool('u2', { depth2UpUsd: 5_000, depth2DownUsd: 7_000, volume24hUsd: null }),
      pool('v4', {
        dex: 'uniswap-v4',
        depth2UpUsd: 10_000,
        depth2DownUsd: 10_000,
        volume24hUsd: null,
      }),
    ])
    expect(agg).toMatchObject({ depth2BuyUsd: 51_000, depth2SellUsd: 49_000 })
    expect(agg.venues).toEqual([
      {
        dex: 'uniswap-v3',
        poolCount: 2,
        depth2Usd: 32_000,
        depthShare: 0.32,
        volume24hUsd: 30_000,
        volumeShare: 1,
      },
      {
        dex: 'uniswap-v4',
        poolCount: 1,
        depth2Usd: 20_000,
        depthShare: 0.2,
        volume24hUsd: null,
        volumeShare: null,
      },
      {
        dex: 'aero-slipstream',
        poolCount: 1,
        depth2Usd: 48_000,
        depthShare: 0.48,
        volume24hUsd: 0,
        volumeShare: 0,
      },
    ])
    expect(agg).toMatchObject({ volume24hUsd: 30_000, volumeKnownPools: 2 })
  })

  it('a total of 0 gives no share', () => {
    const agg = summarizeStock(NVDA, [
      pool('a', { depth2UpUsd: 0, depth2DownUsd: 0, volume24hUsd: 0 }),
    ])
    expect(agg.venues).toEqual([
      {
        dex: 'uniswap-v3',
        poolCount: 1,
        depth2Usd: 0,
        depthShare: null,
        volume24hUsd: 0,
        volumeShare: null,
      },
    ])
  })

  it("the deviation is the deepest pool's; without a reference it reads unread", () => {
    const outside = ref({ deviationBps: -152.28, withinTolerance: false })
    const agg = summarizeStock(NVDA, [
      pool('a', { depth2UpUsd: 90_000, depth2DownUsd: 90_000, reference: outside }),
      pool('b', {
        reference: ref({
          deviationBps: null,
          toleranceBps: null,
          deviationThresholdBps: null,
          feeBps: null,
          withinTolerance: null,
          deviationNull: 'thin',
        }),
      }),
    ])
    expect(agg).toMatchObject({
      deepestPoolId: 'a',
      deviationBps: -152.28,
      withinTolerance: false,
      deviationNull: null,
    })
    const held = ref({
      deviationBps: null,
      withinTolerance: null,
      deviationNull: 'held',
      referenceStatus: 'held',
    })
    expect(summarizeStock(NVDA, [pool('a', { reference: held })])).toMatchObject({
      deviationBps: null,
      withinTolerance: null,
      deviationNull: 'held',
    })
    expect(summarizeStock(NVDA, [pool('a', { reference: null })])).toMatchObject({
      deepestPoolId: 'a',
      deviationBps: null,
      withinTolerance: null,
      deviationNull: 'unread',
    })
  })

  it('stockPassDepth keeps the depth and the deviation of the pass', () => {
    const agg = summarizeStock(NVDA, [pool('a'), pool('b', { staleQuote: true })])
    expect(stockPassDepth(agg)).toEqual({
      depth2BuyUsd: 30_000,
      depth2SellUsd: 20_000,
      sidesKnownPools: 1,
      deepestPoolId: 'a',
      deviationBps: 25.06,
      withinTolerance: true,
      deviationNull: null,
    })
  })
})
