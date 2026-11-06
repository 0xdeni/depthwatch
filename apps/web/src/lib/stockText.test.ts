/**
 * The words of the stock surfaces (docs/design/stocks-api.md §3): the eligibility and valuation
 * lines word for word, every status and every reason in words, a deviation's sign and band inside
 * and outside it (docs/METRICS.md's +25.06 and +152.28 bps), and the off-hours explanation.
 */
import type { ReferenceStatus, StockDeviationNull } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import type { StockReadingDto } from '../api/stockTypes.js'
import {
  ageText,
  answerWithAge,
  DEVIATION_NULL_WORD,
  deviationSentence,
  deviationWords,
  ELIGIBILITY_LINE,
  featuresText,
  multiplierText,
  pausedBanner,
  STATUS_WORD,
  signedBps,
  statusExplanation,
  statusTone,
  VALUATION_LABEL,
} from './stockText.js'

const nb = (s: string) => s.replace(/ /g, ' ')

const FEED = {
  address: '0xfe6e766461630000000000000000000000000000',
  decimals: 8,
  heartbeatSeconds: 86_400,
  deviationThresholdBps: 50,
  hours: '24/5',
} as const

function reading(patch: Partial<StockReadingDto> = {}): StockReadingDto {
  return {
    token: '0xb26e766461630000000000000000000000000000',
    blockNumber: '53663272',
    timestamp: 1_762_387_030,
    referenceStatus: 'live',
    referenceUsd: 199.5,
    feedAgeSeconds: 1_800,
    feedRoundId: '1',
    feedAnswer: '19950000000',
    feedUpdatedAt: 1_762_385_230,
    oracleMultiplierWad: '1000538000000000000',
    oraclePaused: false,
    tokenMultiplierWad: '1000538000000000000',
    pausedFeatures: [],
    transfersPaused: false,
    error: null,
    ...patch,
  }
}

describe('stock words', () => {
  it('says the eligibility line and the valuation convention word for word', () => {
    expect(ELIGIBILITY_LINE).toBe(
      'Coinbase tokenized stocks are only available to persons in eligible jurisdictions outside of the U.S. Depthwatch measures their markets; it does not offer, route or recommend trades in them.',
    )
    expect(VALUATION_LABEL).toBe(
      'Valuation price from Depthwatch’s price graph, used for depth and TVL; not a stock price.',
    )
  })

  it('names every status and every reason for no deviation in words', () => {
    const statuses: Record<ReferenceStatus, string> = {
      live: 'Live',
      held: 'Off-hours',
      paused: 'Paused',
      invalid: 'Invalid',
      unread: 'Unread',
      'no-feed': 'No feed',
    }
    expect(STATUS_WORD).toEqual(statuses)
    expect(statusTone('live')).toBe('ok')
    expect(statusTone('invalid')).toBe('bad')
    expect(statusTone(null)).toBe('none')
    const reasons: Record<StockDeviationNull, string> = {
      hooked: 'Hooked pool',
      thin: 'Too thin to compare',
      'stock-pair': 'Two stocks',
      'no-feed': 'No feed',
      unread: 'Feed not read',
      paused: 'Feed paused',
      invalid: 'Feed invalid',
      held: 'Off-hours',
      'quote-unpriced': 'Quote unpriced',
      'no-pool': 'No pool',
    }
    expect(DEVIATION_NULL_WORD).toEqual(reasons)
  })

  it('signs a deviation with two decimals and words its band inside and outside', () => {
    expect(nb(signedBps(25.0626))).toBe('+25.06 bps')
    expect(nb(signedBps(-125.3132))).toBe('−125.31 bps')
    expect(nb(signedBps(0.001))).toBe('0.00 bps')
    const inside = deviationWords(
      { deviationBps: 25.0626, withinTolerance: true, deviationNull: null },
      50,
      5,
    )
    expect(nb(deviationSentence(inside))).toBe(
      '+25.06 bps, within the feed’s 0.5 % band plus the pool’s 0.05 % fee',
    )
    const outside = deviationWords(
      { deviationBps: 152.2843, withinTolerance: false, deviationNull: null },
      50,
      5,
    )
    expect(nb(deviationSentence(outside))).toBe(
      '+152.28 bps, outside the feed’s 0.5 % band plus the pool’s 0.05 % fee',
    )
    // A stock's deepest-pool deviation names the band but not the pool's fee.
    const deepest = { deviationBps: 25.06, withinTolerance: true, deviationNull: null }
    expect(nb(deviationWords(deepest, 50).words)).toBe(
      'within the feed’s 0.5 % band plus the pool’s fee',
    )
    expect(
      deviationWords({ deviationBps: null, withinTolerance: null, deviationNull: 'held' }, 50),
    ).toEqual({ value: '—', words: 'Off-hours', within: null })
    expect(
      deviationWords({ deviationBps: 12, withinTolerance: null, deviationNull: null }, 50).words,
    ).toBe('no band: the pool’s fee is not known')
  })

  it('gives Chainlink’s answer with its age, the multiplier and the paused features', () => {
    expect(nb(answerWithAge(reading()))).toBe('$199.50, 30 min old')
    expect(answerWithAge(reading({ referenceStatus: 'invalid', referenceUsd: null }))).toBe(
      '— (Invalid)',
    )
    expect(answerWithAge(null)).toBe('No reading yet')
    expect(nb(ageText(100_000))).toBe('28 h')
    expect(nb(ageText(180_537))).toBe('2 d')
    expect(multiplierText('1000538000000000000')).toBe('1 token = 1.000538 shares')
    expect(multiplierText('1000000000000000000')).toBe('1 token = 1 share')
    expect(multiplierText(null)).toBeNull()
    expect(featuresText([])).toBe('None')
    expect(featuresText(['transfer'])).toBe('Transfer')
    expect(featuresText(['mint', 'burn', 'seize'])).toBe('Mint, burn and seize')
    expect(featuresText(null)).toBeNull()
  })

  it('explains a held feed and paused transfers in the design’s words', () => {
    const held = reading({
      referenceStatus: 'held',
      feedAgeSeconds: 65_337,
      feedUpdatedAt: 1_761_853_863,
    })
    expect(nb(statusExplanation(held, FEED))).toBe(
      'The feed holds its value from 30 Oct, 19:51 UTC, 18 h ago: its market is closed for the weekend or a holiday, or the feed stopped. The pools are the only market now; no deviation is computed.',
    )
    expect(pausedBanner('NVDAc')).toBe(
      'Transfers of NVDAc are paused: every swap in its pools reverts. Their depth is shown as measured and left out of the totals.',
    )
    expect(statusExplanation(reading(), null)).toMatch(/records no Chainlink feed/)
    expect(statusExplanation(null, FEED)).toMatch(/No reading is stored yet/)
    expect(
      statusExplanation(
        reading({ referenceStatus: 'unread', error: 'getOracleParams: reverted.' }),
        FEED,
      ),
    ).toContain('(getOracleParams: reverted.)')
  })
})
