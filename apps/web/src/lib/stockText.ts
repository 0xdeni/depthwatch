/**
 * The words of every stock surface (docs/design/stocks-api.md §3): the eligibility line, the
 * valuation-convention label, Chainlink's answer with its status and age, a deviation with its
 * band or the reason it has none, and why a reading holds. Formatting only: every status, figure
 * and reason comes from the API, which takes them from core (docs/METRICS.md, "Reference
 * deviation" and "Stock aggregates"). No surface names a buy, a trade or a swap.
 */
import {
  HEALTH_RATING_MIN_SIDE_USD,
  type ReferenceStatus,
  type StockDeviationNull,
  type StockFeedInfo,
} from '@depthwatch/core'
import type { StockReadingDto } from '../api/stockTypes.js'
import { DASH, fee, full, MINUS, NB, price, usd } from './format.js'
import { rawToDecimal } from './raw.js'

/** On `/stocks`, `/stocks/:token`, a stock pool's page and in the footer (`FOOTER_STOCKS`). */
export const ELIGIBILITY_LINE =
  'Coinbase tokenized stocks are only available to persons in eligible jurisdictions outside of the U.S. Depthwatch measures their markets; it does not offer, route or recommend trades in them.'

/** Wherever a stock's price-graph USD price shows: depth and TVL in USD, a pool's prices. */
export const VALUATION_LABEL =
  'Valuation price from Depthwatch’s price graph, used for depth and TVL; not a stock price.'

/** `referenceUsd`, always with its status and age. */
export const REFERENCE_WORDS = 'Chainlink’s answer'

export const STATUS_WORD: Readonly<Record<ReferenceStatus, string>> = {
  live: 'Live',
  held: 'Off-hours',
  paused: 'Paused',
  invalid: 'Invalid',
  unread: 'Unread',
  'no-feed': 'No feed',
}

/** A stock with no stored reading yet (before its first snapshot pass). */
export const NO_READING = 'No reading yet'

/** The chip of a stock whose `pausedFeatures()` holds `TRANSFER`. */
export const TRANSFERS_PAUSED = 'Transfers paused'

export type StockTone = 'ok' | 'warn' | 'bad' | 'none'

/** Live is the one ok state; a closed or paused feed is a known hold; invalid and unread fail. */
export function statusTone(status: ReferenceStatus | null): StockTone {
  switch (status) {
    case 'live':
      return 'ok'
    case 'held':
    case 'paused':
      return 'warn'
    case 'invalid':
    case 'unread':
      return 'bad'
    default:
      return 'none'
  }
}

export const DEVIATION_NULL_WORD: Readonly<Record<StockDeviationNull, string>> = {
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

/** The reason in words with its one-line why, for a tooltip or a note. */
export function deviationNullDetail(reason: StockDeviationNull): string {
  const word = DEVIATION_NULL_WORD[reason]
  switch (reason) {
    case 'hooked':
      return `${word}: its mid is not known to be a price a swap gets.`
    case 'thin':
      return `${word}: the pool’s thinner side within 2${NB}% is not known to hold ${usd(HEALTH_RATING_MIN_SIDE_USD)} (it holds less, or a side has no dollar value), a price no one need correct.`
    case 'stock-pair':
      return `${word}: the quote is another stock, so its feed would be set against a pool price.`
    case 'no-feed':
      return `${word}: the stock list records no Chainlink feed for this stock.`
    case 'unread':
      return `${word}: a required call failed at the snapshot’s block.`
    case 'paused':
      return `${word}: the oracle registry has paused the stock for a corporate action.`
    case 'invalid':
      return `${word}: the feed’s answer failed a check.`
    case 'held':
      return `${word}: the feed holds a closed market’s value, so no pool is compared with it.`
    case 'quote-unpriced':
      return `${word}: the quote’s dollar price is routed through a pool of the stock itself.`
    case 'no-pool':
      return `${word}: no pool of the stock counts in its sums.`
  }
}

/** A deviation, signed, two decimals: "+25.06 bps", "−125.31 bps". */
export function signedBps(v: number): string {
  const text = Math.abs(v).toFixed(2)
  const sign = Number(text) === 0 ? '' : v < 0 ? MINUS : '+'
  return `${sign}${text}${NB}bps`
}

/** "the feed’s 0.5 % band plus the pool’s 0.05 % fee"; the fee unnamed when not known here. */
export function bandWords(thresholdBps: number | null, feeBps: number | null): string {
  const band =
    thresholdBps === null ? 'the feed’s band' : `the feed’s ${fee(thresholdBps * 100)} band`
  const poolFee =
    feeBps === null ? 'the pool’s fee' : `the pool’s ${fee(Math.round(feeBps * 100))} fee`
  return `${band} plus ${poolFee}`
}

export interface DeviationWords {
  /** "+25.06 bps", or "—" when there is none. */
  value: string
  /** "within the feed’s 0.5 % band plus the pool’s 0.05 % fee", or the reason in words. */
  words: string
  /** Inside the band (true), outside (false), unknown or no deviation (null). */
  within: boolean | null
}

/**
 * A deviation and its band in words, from the band's two parts as core publishes them with a
 * pool's reference (`deviationThresholdBps`, `feeBps`). The list's deepest-pool deviation has no
 * reference at hand: it passes the feed's threshold only and names the pool's fee without a
 * figure.
 */
export function deviationWords(
  d: {
    deviationBps: number | null
    withinTolerance: boolean | null
    deviationNull: StockDeviationNull | null
  },
  thresholdBps: number | null,
  feeBps: number | null = null,
): DeviationWords {
  if (d.deviationBps === null) {
    return { value: DASH, words: DEVIATION_NULL_WORD[d.deviationNull ?? 'no-pool'], within: null }
  }
  const value = signedBps(d.deviationBps)
  if (d.withinTolerance === null) {
    return { value, words: 'no band: the pool’s fee is not known', within: null }
  }
  const where = d.withinTolerance ? 'within' : 'outside'
  return { value, words: `${where} ${bandWords(thresholdBps, feeBps)}`, within: d.withinTolerance }
}

/** "+25.06 bps, within the feed’s 0.5 % band plus the pool’s 0.05 % fee"; "—, Off-hours". */
export function deviationSentence(w: DeviationWords): string {
  return `${w.value}, ${w.words}`
}

/** A feed's age at the reading's block: "30 min", "28 h", "3 d". */
export function ageText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))}${NB}min`
  if (seconds < 172_800) return `${Math.round(seconds / 3_600)}${NB}h`
  return `${Math.round(seconds / 86_400)}${NB}d`
}

/** Chainlink's answer in dollars per token: "$199.50", or "—" when it is not published. */
export function answerText(reading: StockReadingDto | null): string {
  return reading?.referenceUsd == null ? DASH : `$${price(reading.referenceUsd)}`
}

/** "$199.50, 30 min old"; "—" with the status word when there is no answer. */
export function answerWithAge(reading: StockReadingDto | null): string {
  if (reading === null) return NO_READING
  if (reading.referenceUsd === null) return `${DASH} (${STATUS_WORD[reading.referenceStatus]})`
  const age = reading.feedAgeSeconds === null ? '' : `, ${ageText(reading.feedAgeSeconds)} old`
  return `${answerText(reading)}${age}`
}

/** The token's `multiplier()` (WAD): "1 token = 1.000538 shares"; null when unknown. */
export function multiplierText(wad: string | null): string | null {
  if (wad === null) return null
  const shares = rawToDecimal(wad, 18, 6)
  if (shares === null) return null
  return `1 token = ${shares} ${shares === '1' ? 'share' : 'shares'}`
}

/** The paused features in words: "Transfer", "Mint and burn", "None"; null when unknown. */
export function featuresText(features: readonly string[] | null): string | null {
  if (features === null) return null
  if (features.length === 0) return 'None'
  const words = features.map((f, i) => (i === 0 ? f[0]?.toUpperCase() + f.slice(1) : f))
  return words.length === 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** The banner of a stock whose transfers are paused. */
export function pausedBanner(symbol: string): string {
  return `Transfers of ${symbol} are paused: every swap in its pools reverts. Their depth is shown as measured and left out of the totals.`
}

/** What the reading's status means, in a sentence or two, for the stock's reference panel. */
export function statusExplanation(
  reading: StockReadingDto | null,
  feed: StockFeedInfo | null,
): string {
  if (feed === null) {
    return 'The stock list records no Chainlink feed for this stock, so no pool is compared with a reference.'
  }
  if (reading === null) {
    return 'No reading is stored yet: the next snapshot reads the feed at its block.'
  }
  const age = ageText(reading.feedAgeSeconds)
  const why = reading.error === null ? '' : ` (${reading.error})`
  switch (reading.referenceStatus) {
    case 'live':
      return `The feed’s latest round was ${age} old at the snapshot’s block. A pool inside the feed’s ${fee(feed.deviationThresholdBps * 100)} band plus its own fee shows no sign of mispricing; a large age on a weekday can be a quiet market or a holiday.`
    case 'held':
      return `The feed holds its value from ${full(reading.feedUpdatedAt)}, ${age} ago: its market is closed for the weekend or a holiday, or the feed stopped. The pools are the only market now; no deviation is computed.`
    case 'paused':
      return 'The oracle registry has paused the stock for a corporate action: the feed holds its last good value until the price and the multiplier both reflect it. No deviation is computed.'
    case 'invalid':
      return `The feed’s answer failed a check${why}. No deviation is computed.`
    case 'unread':
      return `A required call failed at the snapshot’s block${why}. No deviation is computed.`
    case 'no-feed':
      return 'The stock list records no Chainlink feed for this stock, so no pool is compared with a reference.'
  }
}
