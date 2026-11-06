/**
 * Reference deviation and stock tradability (docs/METRICS.md, "Reference deviation" and "Stock
 * tradability"): a stock's reading at a snapshot block, judged from its on-chain answers, and each
 * stock pool's deviation from it.
 *
 * Not an oracle: `referenceUsd` is Chainlink's answer as read, `poolUsd` one pool's mid in dollars,
 * and no pool is compared with a reading that is not `live`. The feeds answer USD per token (the
 * share price times the token's multiplier), the unit of a pool's price, so the multiplier is never
 * applied to the answer.
 */

import { rawToHuman } from '../math.js'
import { HEALTH_RATING_MIN_SIDE_USD, isHookedPool, thinnerSideUsd } from '../metrics/health.js'
import type { Address, PoolMeta } from '../types.js'
import { weeklyCloseAt } from './hours.js'
import {
  PAUSABLE_FEATURES,
  type PausableFeature,
  type PoolReference,
  type ReferenceNullReason,
  type ReferenceStatus,
  type StockFeedInfo,
  type StockInfo,
  type StockRawRead,
  type StockReading,
} from './types.js'

/**
 * Grace beyond the heartbeat before a feed's age alone holds it: 86,400 + 3,600 = 90,000 s for the
 * ten feeds. The longest gap of 15,903 rounds with no Saturday inside was the heartbeat plus 18 s.
 */
export const REFERENCE_AGE_GRACE_SECONDS = 3_600

/**
 * Whether a feed holds a closed market's value at `timestamp` (docs/METRICS.md, "Off-hours"): its
 * age is above `heartbeatSeconds + REFERENCE_AGE_GRACE_SECONDS`, or, for a 24/5 feed, `timestamp`
 * lies in a weekly close and `updatedAt` is before that close began.
 */
export function isHeld(feed: StockFeedInfo, timestamp: number, updatedAt: number): boolean {
  if (timestamp - updatedAt > feed.heartbeatSeconds + REFERENCE_AGE_GRACE_SECONDS) return true
  if (feed.hours !== '24/5') return false
  const close = weeklyCloseAt(timestamp)
  return close !== null && updatedAt < close.start
}

/** `answer / 10^decimals`, USD per stock token, converted at the end; null for `answer ≤ 0`. */
export function referenceUsdPerToken(answer: bigint, decimals: number): number | null {
  if (answer <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null
  return rawToHuman(answer, decimals)
}

/** `pausedFeatures()` ordinals as features, a set in ordinal order; unknown ordinals are dropped. */
export function decodePausedFeatures(ordinals: readonly number[]): PausableFeature[] {
  const set = new Set(ordinals)
  return PAUSABLE_FEATURES.filter((_, ordinal) => set.has(ordinal))
}

/** Whether `TRANSFER` is paused; null when the features are unknown (unknown is not a pause). */
export function isTransferPaused(features: readonly PausableFeature[] | null): boolean | null {
  return features === null ? null : features.includes('transfer')
}

/** Whether a quote's price route (`DerivedPrice.via`) avoids every pool holding the stock. */
export function quoteRouteAvoids(
  via: readonly string[],
  stockPoolIds: ReadonlySet<string>,
): boolean {
  return !via.some((source) => stockPoolIds.has(source))
}

interface Verdict {
  referenceStatus: ReferenceStatus
  referenceUsd: number | null
  feedAgeSeconds: number | null
  /** Core's own account of the status (a missing answer, why invalid); null when none. */
  why: string | null
}

const verdict = (
  referenceStatus: ReferenceStatus,
  why: string | null = null,
  referenceUsd: number | null = null,
  feedAgeSeconds: number | null = null,
): Verdict => ({ referenceStatus, referenceUsd, feedAgeSeconds, why })

/** The first reason the answers are `invalid`, or null. */
function invalidReason(
  stock: StockInfo,
  feed: StockFeedInfo,
  answer: bigint,
  updatedAt: number,
  decimals: number,
  description: string,
  timestamp: number,
): string | null {
  if (answer <= 0n) return `answer ${answer} is not positive`
  if (!(updatedAt > 0)) return `updatedAt ${updatedAt} is not positive`
  if (updatedAt > timestamp) return `updatedAt ${updatedAt} after the block's ${timestamp}`
  if (decimals !== feed.decimals) return `decimals ${decimals}, expected ${feed.decimals}`
  const expected = `Coinbase ${stock.ticker}`
  if (description !== expected) return `description '${description}', expected '${expected}'`
  if (referenceUsdPerToken(answer, decimals) === null) return `answer at ${decimals} decimals`
  return null
}

/** The status, the answer in USD and its age, in the order of docs/METRICS.md "The reading". */
function judge(stock: StockInfo, raw: StockRawRead | null, timestamp: number): Verdict {
  const feed = stock.feed
  if (feed === null) return verdict('no-feed')
  if (raw === null) return verdict('unread', 'not read')
  const { answer, updatedAt, decimals, description, oracleMultiplierWad, oraclePaused } = raw
  if (
    answer === null ||
    updatedAt === null ||
    decimals === null ||
    description === null ||
    oracleMultiplierWad === null ||
    oraclePaused === null
  ) {
    const required = { answer, updatedAt, decimals, description, oracleMultiplierWad, oraclePaused }
    const missing = Object.entries(required).filter(([, value]) => value === null)
    return verdict('unread', `not read: ${missing.map(([name]) => name).join(', ')}`)
  }
  const ageKnown = Number.isFinite(updatedAt) && updatedAt > 0 && updatedAt <= timestamp
  const age = ageKnown ? timestamp - updatedAt : null
  if (oraclePaused) return verdict('paused', null, referenceUsdPerToken(answer, decimals), age)
  const invalid = invalidReason(stock, feed, answer, updatedAt, decimals, description, timestamp)
  if (invalid !== null) return verdict('invalid', invalid, null, age)
  const usd = referenceUsdPerToken(answer, decimals)
  const status = isHeld(feed, timestamp, updatedAt) ? 'held' : 'live'
  return verdict(status, null, usd, age)
}

/**
 * A stock's reading at a block from its decoded answers (`raw: null` when the read failed, with
 * `error` saying why). `unread` when a required call's answer is missing; a missing `multiplier()`
 * or `pausedFeatures()` leaves its fields null and changes no status.
 */
export function evaluateStockReading(
  stock: StockInfo,
  raw: StockRawRead | null,
  block: { blockNumber: bigint; timestamp: number },
  error?: string,
): StockReading {
  const { referenceStatus, referenceUsd, feedAgeSeconds, why } = judge(stock, raw, block.timestamp)
  const pausedFeatures =
    raw === null || raw.pausedOrdinals === null ? null : decodePausedFeatures(raw.pausedOrdinals)
  // The chain's error names the failed call; core adds its own account only where it says more.
  const given = error !== undefined && error !== '' ? error : null
  const own = referenceStatus === 'unread' && given !== null ? null : why
  return {
    token: stock.token.address,
    blockNumber: block.blockNumber,
    timestamp: block.timestamp,
    referenceStatus,
    referenceUsd,
    feedAgeSeconds,
    feedRoundId: raw?.roundId ?? null,
    feedAnswer: raw?.answer ?? null,
    feedUpdatedAt: raw?.updatedAt ?? null,
    oracleMultiplierWad: raw?.oracleMultiplierWad ?? null,
    oraclePaused: raw?.oraclePaused ?? null,
    tokenMultiplierWad: raw?.tokenMultiplierWad ?? null,
    pausedFeatures,
    transfersPaused: isTransferPaused(pausedFeatures),
    error: [given, own].filter((part) => part !== null).join('; ') || null,
  }
}

/** A stock of the stock list with its reading at the pass's block. */
export interface StockEntry {
  info: StockInfo
  reading: StockReading
}

export interface PoolReferenceInput {
  pool: Pick<PoolMeta, 'token0' | 'token1' | 'hooks'>
  /** The pool's mid at the snapshot's block, token1 per token0. */
  price: number
  /** The pass's USD prices; only the quote's is used. */
  token0Usd: number | null
  token1Usd: number | null
  /** The snapshot's ±2 % sides in USD. */
  depth2UpUsd: number | null
  depth2DownUsd: number | null
  /** The LP fee the snapshot used, in pips; null when unknown. */
  feePips: number | null
  /** `quoteRouteAvoids(quote's via, every pass pool holding the stock)`. */
  quoteIndependent: boolean
  /** The stock list's stocks by lowercase address, each with its reading at the same block. */
  stocks: ReadonlyMap<Address, StockEntry>
}

const lower = (address: Address): Address => address.toLowerCase() as Address

/** True when either stock's transfers are paused, false when both are known not to be. */
function eitherPaused(a: boolean | null, b: boolean | null): boolean | null {
  if (a === true || b === true) return true
  return a === null || b === null ? null : false
}

/** USD per stock token at the pool's mid, from the quote's USD price only; null when not known. */
function poolUsdOf(input: PoolReferenceInput, stockIsToken0: boolean): number | null {
  if (isHookedPool(input.pool) || !input.quoteIndependent) return null
  const { price } = input
  const quoteUsd = stockIsToken0 ? input.token1Usd : input.token0Usd
  if (!(price > 0) || !Number.isFinite(price) || quoteUsd === null || !(quoteUsd > 0)) return null
  const usd = stockIsToken0 ? price * quoteUsd : quoteUsd / price
  return Number.isFinite(usd) ? usd : null
}

/**
 * A stock pool against its stock's reading (docs/METRICS.md, "The pool's USD price and the
 * deviation"); null when neither token is a stock. In a pool of two stocks the reference is token0's
 * stock's, its deviation null (`stock-pair`) and `transfersPaused` true when either stock's is.
 */
export function poolReference(input: PoolReferenceInput): PoolReference | null {
  const { pool, stocks } = input
  const first = stocks.get(lower(pool.token0.address))
  const second = stocks.get(lower(pool.token1.address))
  const entry = first ?? second
  if (entry === undefined) return null
  const stockPair = first !== undefined && second !== undefined
  const { info, reading } = entry
  const poolUsd = poolUsdOf(input, first !== undefined)
  const base = {
    stock: lower(info.token.address),
    poolUsd,
    referenceUsd: reading.referenceUsd,
    referenceStatus: reading.referenceStatus,
    feedAgeSeconds: reading.feedAgeSeconds,
    transfersPaused: stockPair
      ? eitherPaused(first.reading.transfersPaused, second.reading.transfersPaused)
      : reading.transfersPaused,
  }
  const none = {
    deviationBps: null,
    toleranceBps: null,
    deviationThresholdBps: null,
    feeBps: null,
    withinTolerance: null,
  }
  const reason = (deviationNull: ReferenceNullReason): PoolReference => ({
    ...base,
    ...none,
    deviationNull,
  })

  if (isHookedPool(pool)) return reason('hooked')
  const thinner = thinnerSideUsd(input.depth2UpUsd, input.depth2DownUsd)
  if (thinner === null || thinner < HEALTH_RATING_MIN_SIDE_USD) return reason('thin')
  if (stockPair) return reason('stock-pair')
  if (reading.referenceStatus !== 'live') return reason(reading.referenceStatus)
  // A live reading always has its answer in USD; one without it is no reference.
  if (reading.referenceUsd === null || info.feed === null) return reason('invalid')
  if (poolUsd === null) return reason('quote-unpriced')

  const deviationBps = (poolUsd / reading.referenceUsd - 1) * 10_000
  const { feePips } = input
  // The band and its two parts, published together so that no reader takes one from the others.
  const band =
    feePips === null || !Number.isFinite(feePips)
      ? { toleranceBps: null, deviationThresholdBps: null, feeBps: null }
      : {
          toleranceBps: info.feed.deviationThresholdBps + feePips / 100,
          deviationThresholdBps: info.feed.deviationThresholdBps,
          feeBps: feePips / 100,
        }
  const withinTolerance =
    band.toleranceBps === null ? null : Math.abs(deviationBps) <= band.toleranceBps
  return { ...base, deviationBps, ...band, withinTolerance, deviationNull: null }
}
