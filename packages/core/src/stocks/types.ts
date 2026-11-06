/**
 * Tokenized stocks (docs/METRICS.md, "Reference deviation", "Stock tradability" and "Stock
 * aggregates"; docs/design/stocks.md §2). The chain package reads each stock's answers at a block
 * (`StockRawRead`); core judges them (`StockReading`), sets each stock pool against its stock's
 * reading (`PoolReference`) and sums a stock's pools (`StockAggregate`).
 *
 * Not an oracle: `referenceUsd` is Chainlink's answer passed on with its status and age, `poolUsd`
 * one pool's own mid in dollars; nothing here is an aggregate stock price.
 */

import type { Address, Dex, TokenInfo } from '../types.js'

/**
 * A reading's status, tested in the order `no-feed`, `unread`, `paused`, `invalid`, `held`, `live`
 * (docs/METRICS.md, "The reading"). Only a `live` reading is compared with a pool.
 */
export type ReferenceStatus = 'live' | 'held' | 'paused' | 'invalid' | 'unread' | 'no-feed'

/** A B20 token's pausable features; the B20 ordinals are TRANSFER 0, MINT 1, BURN 2, SEIZE 3. */
export type PausableFeature = 'transfer' | 'mint' | 'burn' | 'seize'

/** The features by B20 ordinal: `PAUSABLE_FEATURES[ordinal]`. */
export const PAUSABLE_FEATURES: readonly PausableFeature[] = Object.freeze([
  'transfer',
  'mint',
  'burn',
  'seize',
])

/**
 * Why a pool has no deviation, the first that applies: `hooked`, `thin`, `stock-pair`, the
 * reading's status when it is not `live`, `quote-unpriced` (docs/METRICS.md, "The pool's USD price
 * and the deviation").
 */
export type ReferenceNullReason =
  | 'hooked'
  | 'thin'
  | 'stock-pair'
  | Exclude<ReferenceStatus, 'live'>
  | 'quote-unpriced'

/** Why a stock has no deviation: its deepest pool's reason, or `no-pool` without a deepest pool. */
export type StockDeviationNull = ReferenceNullReason | 'no-pool'

/** A stock's Chainlink feed as the stock list records it. */
export interface StockFeedInfo {
  /** The feed proxy (`StockFeed.feed` in the chain package), read with `latestRoundData()`. */
  address: Address
  decimals: number
  /** Chainlink's heartbeat while the market is open (86,400 s for the ten); none off-hours. */
  heartbeatSeconds: number
  /** The move, in bps, that makes the feed publish a round while open (50 for the ten). */
  deviationThresholdBps: number
  /** '24/5': US equity sessions, held through the weekly close; '24/7': no weekly close. */
  hours: '24/5' | '24/7'
}

/** A stock of the stock list. `ticker` is the one in the feed's `description()`, "Coinbase <ticker>". */
export interface StockInfo {
  token: TokenInfo
  ticker: string
  /** Null when the stock list records no feed for the stock (`no-feed`). */
  feed: StockFeedInfo | null
}

/**
 * Decoded answers at one block; a null field is a call that failed, reverted or did not decode.
 * The four required calls are `latestRoundData()` (`roundId`, `answer`, `updatedAt`), `decimals()`,
 * `description()` and the oracle registry's `getOracleParams(stock)` (`oracleMultiplierWad` and
 * `oraclePaused`, both or none); the token's own `multiplier()` and `pausedFeatures()` change no
 * status.
 */
export interface StockRawRead {
  roundId: bigint | null
  answer: bigint | null
  /** Unix seconds of the feed's latest round. */
  updatedAt: number | null
  decimals: number | null
  description: string | null
  oracleMultiplierWad: bigint | null
  oraclePaused: boolean | null
  tokenMultiplierWad: bigint | null
  /** `pausedFeatures()`: B20 ordinals, a set. */
  pausedOrdinals: number[] | null
}

/** One stock judged at one snapshot block (docs/METRICS.md, "The reading"). */
export interface StockReading {
  token: Address
  blockNumber: bigint
  /** Unix seconds of the block (`T`). */
  timestamp: number
  referenceStatus: ReferenceStatus
  /** `answer / 10^decimals`, USD per stock token; null unless `live`, `held` or `paused`. */
  referenceUsd: number | null
  /** `T − updatedAt`, whole seconds; null without a feed, after a failed call, or for a bad `updatedAt`. */
  feedAgeSeconds: number | null
  feedRoundId: bigint | null
  feedAnswer: bigint | null
  feedUpdatedAt: number | null
  oracleMultiplierWad: bigint | null
  oraclePaused: boolean | null
  /** The token's own `multiplier()` (shares per token, WAD); never applied to the answer. */
  tokenMultiplierWad: bigint | null
  /** `pausedFeatures()` decoded, in ordinal order; null when the call failed. */
  pausedFeatures: PausableFeature[] | null
  /** `pausedFeatures` holds `transfer`; null when unknown (unknown is not a pause). */
  transfersPaused: boolean | null
  /** The failed call, or why the reading is `invalid`; null otherwise. */
  error: string | null
}

/** A stock pool set against its stock's reading at the snapshot's block. Holds no bigint. */
export interface PoolReference {
  /** The pool's stock; token0's when both tokens are stocks (`stock-pair`). */
  stock: Address
  /** USD per stock token at the pool's mid, from the quote's USD price only. */
  poolUsd: number | null
  referenceUsd: number | null
  referenceStatus: ReferenceStatus
  feedAgeSeconds: number | null
  /** `(poolUsd / referenceUsd − 1) × 10,000`, signed: positive when the pool is above the feed. */
  deviationBps: number | null
  /** `deviationThresholdBps + feeBps`; null when the fee is unknown. */
  toleranceBps: number | null
  /** The feed's deviation threshold, the first part of `toleranceBps`; null when it is null. */
  deviationThresholdBps: number | null
  /** The pool's LP fee at the snapshot's block, `feePips / 100`: the second part; null when it is. */
  feeBps: number | null
  /** `|deviationBps| ≤ toleranceBps`; null when either is null. */
  withinTolerance: boolean | null
  /** Why there is no deviation; null when there is one. */
  deviationNull: ReferenceNullReason | null
  /** The stock's transfers are paused (either stock's, in a pool of two); null when unknown. */
  transfersPaused: boolean | null
}

/** One pool of a stock as the pool lists show it: its newest snapshot and score. */
export interface StockPoolInput {
  poolId: string
  dex: Dex
  token0: Address
  token1: Address
  tvlUsd: number | null
  /** The pool's own ±2 % levels (token1 per token0), in USD. */
  depth2UpUsd: number | null
  depth2DownUsd: number | null
  /** The $10k round-trip spread under the cap (`feasibleSpreadBps`); null when infeasible. */
  spread10kBps: number | null
  staleQuote: boolean
  volume24hUsd: number | null
  /** The snapshot's reference; null when it has none (stored before schema version 8). */
  reference: PoolReference | null
  /**
   * A newer reading of the pool's stock (of either, in a pool of two) than the snapshot finds its
   * transfers paused (`newerReadingPauses`); absent or false otherwise. The snapshot step's pools
   * are at their readings' block, so only the API, which pairs newest snapshots with newest
   * readings, sets it.
   */
  pausedByNewerReading?: boolean
}

/** A stock's pools on one DEX. Shares are 0..1. */
export interface StockVenue {
  dex: Dex
  poolCount: number
  /** Σ (buyUsd + sellUsd) over the venue's pools in the depth sums; null when none is. */
  depth2Usd: number | null
  depthShare: number | null
  /** Σ of the venue's known 24 h volumes; null when none is known. */
  volume24hUsd: number | null
  volumeShare: number | null
}

/** One stock across every pool that trades it (docs/METRICS.md, "Stock aggregates"). */
export interface StockAggregate {
  token: Address
  poolCount: number
  /** Σ known TVL; a lower bound while a Uniswap v4 pool's is unknown. */
  tvlUsd: number | null
  tvlKnownPools: number
  /** Σ of the stock's buy sides (the quote as input) over the counted pools with both sides known. */
  depth2BuyUsd: number | null
  /** Σ of the stock's sell sides (the stock as input) over the same pools. */
  depth2SellUsd: number | null
  sidesKnownPools: number
  /** The lowest feasible $10k spread among the counted pools. */
  spread10kBps: number | null
  spread10kPoolId: string | null
  /** Σ known 24 h volume, counted pools or not. */
  volume24hUsd: number | null
  volumeKnownPools: number
  /** One row per DEX holding a pool of the stock, in `DEXES` order. */
  venues: StockVenue[]
  /** The pool in the depth sums with the largest thinner side. */
  deepestPoolId: string | null
  deviationBps: number | null
  withinTolerance: boolean | null
  deviationNull: StockDeviationNull | null
}

/** What the snapshot step stores with each reading (stocks.md §5): the pass's own pools at that block. */
export type StockPassDepth = Pick<
  StockAggregate,
  | 'depth2BuyUsd'
  | 'depth2SellUsd'
  | 'sidesKnownPools'
  | 'deepestPoolId'
  | 'deviationBps'
  | 'withinTolerance'
  | 'deviationNull'
>
