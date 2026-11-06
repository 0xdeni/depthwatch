import { describe, expect, it } from 'vitest'
import { BIGINT_KEYS, jsonStringify, reviveBigints } from '../json.js'
import { makeStock, stockRawRead } from '../testing.js'
import {
  decodePausedFeatures,
  evaluateStockReading,
  isHeld,
  isTransferPaused,
  quoteRouteAvoids,
  REFERENCE_AGE_GRACE_SECONDS,
  referenceUsdPerToken,
} from './reference.js'
import type { StockFeedInfo, StockReading } from './types.js'

const utc = (iso: string): number => Date.parse(iso) / 1000

const nvda = makeStock('NVDAc')
if (nvda.feed === null) throw new Error('the test stock has a feed')
const feed: StockFeedInfo = nvda.feed
const always: StockFeedInfo = { ...feed, hours: '24/7' }

/** Wednesday 2026-11-04 15:00:00 UTC: a weekday, far from any close. */
const WEDNESDAY = utc('2026-11-04T15:00:00Z')
const block = (timestamp: number) => ({ blockNumber: 53_663_272n, timestamp })
const read = (
  updatedAt: number,
  overrides: Parameters<typeof stockRawRead>[3] = {},
  at = WEDNESDAY,
  error?: string,
): StockReading =>
  evaluateStockReading(
    nvda,
    stockRawRead(nvda, 19_950_000_000n, updatedAt, overrides),
    block(at),
    error,
  )

describe('isHeld: the age part', () => {
  it('holds above heartbeat + 3,600 s = 90,000 s, not at it', () => {
    expect(REFERENCE_AGE_GRACE_SECONDS).toBe(3_600)
    expect(isHeld(feed, WEDNESDAY, WEDNESDAY - 90_000)).toBe(false)
    expect(isHeld(feed, WEDNESDAY, WEDNESDAY - 90_001)).toBe(true)
    expect(isHeld({ ...feed, heartbeatSeconds: 3_600 }, WEDNESDAY, WEDNESDAY - 7_201)).toBe(true)
  })

  it('a 24/7 feed is held by its age alone', () => {
    const saturday = utc('2026-11-07T14:00:00Z')
    expect(isHeld(always, saturday, saturday - 60_000)).toBe(false)
    expect(isHeld(feed, saturday, saturday - 60_000)).toBe(true)
    expect(isHeld(always, saturday, saturday - 90_001)).toBe(true)
  })
})

describe('isHeld: the weekly close part', () => {
  const opens = utc('2026-11-07T01:00:00Z') // Friday 2026-11-06 20:00 EST
  // A heartbeat of ten days keeps the age part out of the way.
  const slow: StockFeedInfo = { ...feed, heartbeatSeconds: 864_000 }
  it('holds inside a close when the answer is from before the close began', () => {
    expect(isHeld(slow, opens, opens - 1)).toBe(true)
    expect(isHeld(slow, opens - 1, opens - 2)).toBe(false) // Friday 19:59:59: the market is open
    expect(isHeld(slow, utc('2026-11-09T00:59:59Z'), opens - 1)).toBe(true) // Sunday 19:59:59
    expect(isHeld(slow, utc('2026-11-09T01:00:00Z'), opens - 1)).toBe(false) // Sunday 20:00
    // With the ten feeds' heartbeat, Friday's answer is 48 h old by then: held by its age.
    expect(isHeld(feed, utc('2026-11-09T01:00:00Z'), opens - 1)).toBe(true)
  })

  it('does not hold an answer published at or after the close began', () => {
    expect(isHeld(feed, opens + 600, opens)).toBe(false)
    expect(isHeld(feed, opens + 600, opens + 300)).toBe(false)
  })
})

describe('the answer and the paused features', () => {
  it('referenceUsdPerToken: answer / 10^decimals; null for an answer ≤ 0 or bad decimals', () => {
    expect(referenceUsdPerToken(19_950_000_000n, 8)).toBe(199.5)
    expect(referenceUsdPerToken(18_026_191_788n, 8)).toBe(180.26191788)
    expect(referenceUsdPerToken(1n, 0)).toBe(1)
    expect(referenceUsdPerToken(0n, 8)).toBeNull()
    expect(referenceUsdPerToken(-5n, 8)).toBeNull()
    expect(referenceUsdPerToken(5n, -1)).toBeNull()
    expect(referenceUsdPerToken(5n, 1.5)).toBeNull()
  })

  it('decodePausedFeatures: B20 ordinals 0..3 as a set in ordinal order, unknown ones dropped', () => {
    expect(decodePausedFeatures([])).toEqual([])
    expect(decodePausedFeatures([0])).toEqual(['transfer'])
    expect(decodePausedFeatures([3, 1, 2, 0])).toEqual(['transfer', 'mint', 'burn', 'seize'])
    expect(decodePausedFeatures([2, 2, 7, 255])).toEqual(['burn'])
  })

  it('isTransferPaused: transfer only; unknown is not a pause', () => {
    expect(isTransferPaused(['transfer'])).toBe(true)
    expect(isTransferPaused(['mint', 'burn', 'seize'])).toBe(false)
    expect(isTransferPaused([])).toBe(false)
    expect(isTransferPaused(null)).toBeNull()
  })

  it('quoteRouteAvoids: false when the route walks any pool holding the stock', () => {
    const stockPools = new Set(['aero-slipstream:0xf668', 'uniswap-v3:0x6066'])
    expect(quoteRouteAvoids([], stockPools)).toBe(true)
    expect(quoteRouteAvoids(['uniswap-v3:0xd0b5', 'uniswap-v3:0x24e1'], stockPools)).toBe(true)
    expect(quoteRouteAvoids(['uniswap-v3:0xd0b5', 'uniswap-v3:0x6066'], stockPools)).toBe(false)
  })
})

describe('evaluateStockReading: statuses in order', () => {
  it('live: the answer in USD, its age, every field passed through', () => {
    const reading = read(WEDNESDAY - 1_800, { roundId: 42n, pausedOrdinals: [1] })
    expect(reading).toEqual({
      token: nvda.token.address,
      blockNumber: 53_663_272n,
      timestamp: WEDNESDAY,
      referenceStatus: 'live',
      referenceUsd: 199.5,
      feedAgeSeconds: 1_800,
      feedRoundId: 42n,
      feedAnswer: 19_950_000_000n,
      feedUpdatedAt: WEDNESDAY - 1_800,
      oracleMultiplierWad: 10n ** 18n,
      oraclePaused: false,
      tokenMultiplierWad: 10n ** 18n,
      pausedFeatures: ['mint'],
      transfersPaused: false,
      error: null,
    })
  })

  it('no-feed first, whatever was read', () => {
    const bare = makeStock('BAREc', { feed: null })
    const raw = stockRawRead(bare, 0n, 0, { pausedOrdinals: [0], answer: null })
    const reading = evaluateStockReading(bare, raw, block(WEDNESDAY))
    expect(reading).toMatchObject({
      referenceStatus: 'no-feed',
      referenceUsd: null,
      feedAgeSeconds: null,
      transfersPaused: true,
      error: null,
    })
    expect(evaluateStockReading(bare, null, block(WEDNESDAY)).referenceStatus).toBe('no-feed')
  })

  it('unread: a failed read, or any of the four required calls missing', () => {
    const failed = evaluateStockReading(nvda, null, block(WEDNESDAY), 'HTTP 429')
    expect(failed).toMatchObject({
      referenceStatus: 'unread',
      referenceUsd: null,
      feedAgeSeconds: null,
      pausedFeatures: null,
      transfersPaused: null,
      error: 'HTTP 429',
    })
    expect(evaluateStockReading(nvda, null, block(WEDNESDAY)).error).toBe('not read')
    for (const field of [
      'answer',
      'updatedAt',
      'decimals',
      'description',
      'oracleMultiplierWad',
      'oraclePaused',
    ] as const) {
      const reading = read(WEDNESDAY - 60, {
        [field]: null,
        oraclePaused: field === 'oraclePaused' ? null : true,
      })
      expect(reading.referenceStatus, field).toBe('unread')
      expect(reading.referenceUsd, field).toBeNull()
      expect(reading.feedAgeSeconds, field).toBeNull()
      expect(reading.error, field).toBe(`not read: ${field}`)
    }
    // The chain's error names the failed call; core adds nothing to it.
    expect(
      read(WEDNESDAY - 60, { description: null }, WEDNESDAY, 'description() reverted').error,
    ).toBe('description() reverted')
  })

  it('never unread for the token multiplier or the paused features: those fields go null', () => {
    const reading = read(
      WEDNESDAY - 60,
      { tokenMultiplierWad: null, pausedOrdinals: null },
      WEDNESDAY,
      'multiplier() reverted',
    )
    expect(reading).toMatchObject({
      referenceStatus: 'live',
      referenceUsd: 199.5,
      tokenMultiplierWad: null,
      pausedFeatures: null,
      transfersPaused: null,
      error: 'multiplier() reverted',
    })
  })

  it('paused: the oracle registry flag, before invalid; the answer is still published', () => {
    const paused = read(WEDNESDAY - 1_800, { oraclePaused: true })
    expect(paused).toMatchObject({
      referenceStatus: 'paused',
      referenceUsd: 199.5,
      feedAgeSeconds: 1_800,
    })
    const pausedAndWrong = read(WEDNESDAY - 1_800, {
      oraclePaused: true,
      description: 'Coinbase TSLA',
    })
    expect(pausedAndWrong.referenceStatus).toBe('paused')
    // A held answer under a pause reads paused: the pause comes first.
    expect(read(WEDNESDAY - 200_000, { oraclePaused: true }).referenceStatus).toBe('paused')
    expect(read(WEDNESDAY + 10, { oraclePaused: true }).feedAgeSeconds).toBeNull()
  })

  it('invalid: each reason, before held, with no answer in USD', () => {
    const cases: [Parameters<typeof read>[1], number, string, number | null][] = [
      [{ answer: 0n }, WEDNESDAY - 60, 'answer 0 is not positive', 60],
      [{ answer: -1n }, WEDNESDAY - 60, 'answer -1 is not positive', 60],
      [{}, 0, 'updatedAt 0 is not positive', null],
      [{}, WEDNESDAY + 1, `updatedAt ${WEDNESDAY + 1} after the block's ${WEDNESDAY}`, null],
      [{ decimals: 18 }, WEDNESDAY - 60, 'decimals 18, expected 8', 60],
      [
        { description: 'Coinbase TSLA' },
        WEDNESDAY - 60,
        "description 'Coinbase TSLA', expected 'Coinbase NVDA'",
        60,
      ],
      [
        { description: 'Coinbase NVDA (24/7)' },
        WEDNESDAY - 60,
        "description 'Coinbase NVDA (24/7)', expected 'Coinbase NVDA'",
        60,
      ],
    ]
    for (const [overrides, updatedAt, error, age] of cases) {
      const reading = read(updatedAt, overrides)
      expect(reading, error).toMatchObject({
        referenceStatus: 'invalid',
        referenceUsd: null,
        feedAgeSeconds: age,
        error,
      })
    }
    // An old answer that is also invalid reads invalid.
    expect(read(WEDNESDAY - 200_000, { decimals: 6 }).referenceStatus).toBe('invalid')
    // A recorded scale no uint8 holds cannot give an answer in USD: invalid, never live.
    const odd = makeStock('ODDc', { feed: { decimals: 300 } })
    const oddRaw = stockRawRead(odd, 5n, WEDNESDAY - 60)
    expect(evaluateStockReading(odd, oddRaw, block(WEDNESDAY))).toMatchObject({
      referenceStatus: 'invalid',
      referenceUsd: null,
      error: 'answer at 300 decimals',
    })
    // The chain's error and core's reason together.
    expect(read(WEDNESDAY - 60, { answer: 0n }, WEDNESDAY, 'pausedFeatures() reverted').error).toBe(
      'pausedFeatures() reverted; answer 0 is not positive',
    )
  })

  it('held, then live; held keeps its answer and its age', () => {
    expect(read(WEDNESDAY - 90_001)).toMatchObject({
      referenceStatus: 'held',
      referenceUsd: 199.5,
      feedAgeSeconds: 90_001,
    })
    expect(read(WEDNESDAY - 90_000).referenceStatus).toBe('live')
    expect(read(WEDNESDAY).referenceStatus).toBe('live') // updatedAt = T: age 0
    expect(read(WEDNESDAY).feedAgeSeconds).toBe(0)
  })

  it('a stock without a recorded 24/5 schedule is held by age alone', () => {
    const stock = makeStock('NVDAc', { feed: { hours: '24/7' } })
    const saturday = utc('2026-11-07T14:00:00Z')
    const raw = stockRawRead(stock, 19_950_000_000n, saturday - 60_000)
    expect(evaluateStockReading(stock, raw, block(saturday)).referenceStatus).toBe('live')
  })
})

describe('evaluateStockReading: the multiplier and the wire', () => {
  it('never applies the multiplier: NVDAc answers USD per token', () => {
    const m = 1_000_537_939_576_369_481n
    const reading = evaluateStockReading(
      nvda,
      stockRawRead(nvda, 18_026_191_788n, WEDNESDAY - 1_268, {
        oracleMultiplierWad: m,
        tokenMultiplierWad: m,
      }),
      block(WEDNESDAY),
    )
    expect(reading.referenceUsd).toBe(180.26191788)
    expect(reading.oracleMultiplierWad).toBe(m)
    expect(reading.tokenMultiplierWad).toBe(m)
  })

  it('round-trips through jsonStringify and reviveBigints with BIGINT_KEYS', () => {
    const reading = read(WEDNESDAY - 1_800, {
      roundId: 18_446_744_073_709_552_000n,
      oracleMultiplierWad: 1_000_537_939_576_369_481n,
    })
    const wire = JSON.parse(jsonStringify(reading)) as Record<string, unknown>
    expect(wire.feedRoundId).toBe('18446744073709552000')
    expect(wire.feedAnswer).toBe('19950000000')
    expect(reviveBigints<StockReading>(wire, BIGINT_KEYS)).toEqual(reading)
    const failed = evaluateStockReading(nvda, null, block(WEDNESDAY), 'timeout')
    expect(reviveBigints<StockReading>(JSON.parse(jsonStringify(failed)), BIGINT_KEYS)).toEqual(
      failed,
    )
  })
})
