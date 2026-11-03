/**
 * Shared domain types for Depthwatch.
 *
 * Conventions (see DESIGN.md):
 * - Addresses are lowercase `0x…` strings. Native ETH (Uniswap v4 currency0 == address(0)) is NATIVE_ETH.
 * - Raw token amounts are `bigint` in the token's smallest unit. Human numbers are `number`.
 * - `price` always means "token1 per token0", decimal-adjusted (human) unless the name says otherwise.
 * - Fees are in pips (1e-6): 500 = 0.05 %, 3000 = 0.30 %. Aerodrome v2 and Aero v2 fees (bps) are ×100.
 * - Pool ids are `${dex}:${address|poolId}` and unique across DEXes.
 */

export type Address = `0x${string}`
export type Hex = `0x${string}`

export const NATIVE_ETH: Address = '0x0000000000000000000000000000000000000000'
export const BASE_CHAIN_ID = 8453 as const

export type Dex =
  | 'uniswap-v3'
  | 'uniswap-v4'
  | 'aerodrome-v2'
  | 'aerodrome-slipstream'
  | 'aero-v2'
  | 'aero-slipstream'
export const DEXES: readonly Dex[] = [
  'uniswap-v3',
  'uniswap-v4',
  'aerodrome-v2',
  'aerodrome-slipstream',
  'aero-v2',
  'aero-slipstream',
]

export type PoolKind = 'concentrated' | 'constant-product' | 'stable-swap'

export interface TokenInfo {
  address: Address
  symbol: string
  name: string
  decimals: number
}

export interface PoolMeta {
  /** `${dex}:${address}` for address-keyed pools, `${dex}:${poolId}` for Uniswap v4. */
  id: string
  dex: Dex
  kind: PoolKind
  /** Pool contract address; null for Uniswap v4 (singleton PoolManager). */
  address: Address | null
  /** Uniswap v4 PoolId (bytes32); null otherwise. */
  poolId: Hex | null
  token0: TokenInfo
  token1: TokenInfo
  /** LP fee in pips (1e-6) as last read: at discovery, then by every snapshot (`hasDynamicFee`). */
  feePips: number
  /** Tick spacing for concentrated pools; null otherwise. */
  tickSpacing: number | null
  /** Aerodrome v2 and Aero v2 stable (x³y + xy³) pools. */
  stable: boolean
  /**
   * Uniswap v4: the hooks address (zero without a hook). Aero Slipstream: the pool's swap hook when
   * not the reviewed one or charging each block's first swap an initial fee, else null. Only a
   * non-zero address is `hooked` (`isHookedPool`): null and the zero address mean no hook.
   */
  hooks: Address | null
  createdAtBlock: bigint
}

/** One initialized tick of a concentrated-liquidity pool. */
export interface TickData {
  index: number
  liquidityNet: bigint
  liquidityGross: bigint
}

/** Uniswap v4 protocol fee per swap direction, in pips (each at most 1 000 = 0.1 %). */
export interface ProtocolFeePips {
  zeroForOne: number
  oneForZero: number
}

interface StateBase {
  blockNumber: bigint
  /** Unix seconds of the block. */
  timestamp: number
}

export interface ConcentratedState extends StateBase {
  kind: 'concentrated'
  sqrtPriceX96: bigint
  tick: number
  /** Liquidity active at the current tick. */
  liquidity: bigint
  /** LP fee in pips (Uniswap v4: slot0 `lpFee`); the fee shown for the pool. */
  feePips: number
  /**
   * Uniswap v4 only: the protocol fee of each swap direction in pips (slot0 `protocolFee`). A swap
   * is charged `v4SwapFeePips(protocolFee, feePips)`, not `feePips`. Absent (Uniswap v3,
   * Slipstream: their protocol share is cut from the LP fee, not added to it) means 0.
   */
  protocolFeePips?: ProtocolFeePips
  tickSpacing: number
  /** Initialized ticks sorted ascending. Must cover [tickLowerBound, tickUpperBound]. */
  ticks: TickData[]
  /** Below this tick the tick list is not guaranteed complete. */
  tickLowerBound: number
  /** Above this tick the tick list is not guaranteed complete. */
  tickUpperBound: number
}

export interface ConstantProductState extends StateBase {
  kind: 'constant-product'
  reserve0: bigint
  reserve1: bigint
  feePips: number
}

export interface StableSwapState extends StateBase {
  kind: 'stable-swap'
  reserve0: bigint
  reserve1: bigint
  decimals0: number
  decimals1: number
  feePips: number
}

export type PoolState = ConcentratedState | ConstantProductState | StableSwapState

export type SwapDirection = 'zeroForOne' | 'oneForZero'

export interface SwapResult {
  direction: SwapDirection
  amountIn: bigint
  amountOut: bigint
  /** Portion of amountIn taken as fee: the LP fee, plus the protocol fee on Uniswap v4. */
  feePaid: bigint
  /**
   * Exact input: true when the full amountIn was consumed. Swap to price: true when the target
   * price was reached; a zero-liquidity range inside the known ticks is crossed at no cost, as on
   * chain, so only the edge of the known tick range (or a pool that cannot move) leaves it false.
   */
  complete: boolean
  /** Concentrated pools only. */
  sqrtPriceAfterX96?: bigint
  tickAfter?: number
}

export interface DepthSide {
  /** Raw amount of the input token required to move the price by `pct`. */
  amountIn: bigint
  /** Raw amount of the output token received along the way. */
  amountOut: bigint
  /**
   * False when the walk ended at the edge of the known tick range before the target price, or the
   * pool cannot move (amounts are then totals to that point). A target past a zero-liquidity
   * range inside the known ticks is reached, at the amounts of the last range with liquidity.
   */
  reached: boolean
}

export interface DepthLevel {
  /** Percent move of price (token1 per token0): 1, 2, 5. */
  pct: number
  /** Price moves UP by pct: buyers of token0 pay token1. amountIn is token1, amountOut is token0. */
  up: DepthSide
  /** Price moves DOWN by pct: sellers of token0 receive token1. amountIn is token0, amountOut is token1. */
  down: DepthSide
}

export interface DepthLevelUsd {
  pct: number
  /** USD value of token1 absorbed on the way up; null when token1 has no USD price. */
  upUsd: number | null
  /** USD value of token0 absorbed on the way down; null when token0 has no USD price. */
  downUsd: number | null
  /** upUsd + downUsd when both known, else whichever is known, else null. */
  totalUsd: number | null
}

export interface SpreadPoint {
  notionalUsd: number
  /**
   * (buyAvgPrice − sellAvgPrice) / mid × 10 000, fees included. Null when infeasible (incomplete
   * leg, no output, a leg's price impact above `SPREAD_MAX_LEG_IMPACT_BPS`) or unpriced; a feasible
   * spread is therefore at most 10 000.
   */
  spreadBps: number | null
  feasible: boolean
  buyAvgPrice: number | null
  sellAvgPrice: number | null
}

export interface Position {
  owner: Address
  tickLower: number
  tickUpper: number
  liquidity: bigint
  tokenId: bigint | null
}

export interface OwnerConcentration {
  /** Owners with a positive share of in-band liquidity. */
  count: number
  /** Shares are out of the owners' total weight (the indexed positions only). */
  top1Share: number
  top3Share: number
  /** Herfindahl–Hirschman index over owner shares, 0..1. */
  hhi: number
  /**
   * Σ owner weights / the pool's whole in-band weight, 0..1 (clamped): how much of the pool the
   * indexed owners account for. A custodian's positions (a Slipstream gauge) count as uncovered.
   * Null (unknown) only in a snapshot stored before coverage was recorded.
   */
  coverage: number | null
}

export interface ConcentrationMetrics {
  /** Half-width of the price band around mid used for the computation, in percent (default 5). */
  bandPct: number
  /** HHI over liquidity-weighted tick ranges inside the band, 0..1. 1 = all liquidity in a single range. */
  rangeHhi: number
  /** Share of in-band liquidity-weight that sits in the currently active tick range, 0..1. */
  activeRangeShare: number
  /** Null when positions were not indexed for this pool. */
  owners: OwnerConcentration | null
}

export interface PersistenceMetrics {
  windowHours: number
  samples: number
  depthUsdMedian: number | null
  depthUsdP10: number | null
  depthUsdMin: number | null
  /**
   * p10 / median, clamped to 0..1; 0 when the median is 0. Null (unknown) when samples < 3 or the
   * samples span less than `PERSISTENCE_MIN_COVERAGE` of the window.
   */
  stability: number | null
  /**
   * Share of samples where depth ≥ 50 % of the window median; 0 when the median is 0. Null under
   * the same conditions as `stability`.
   */
  uptime: number | null
}

export interface HealthComponents {
  depth: number
  spread: number
  concentration: number
  persistence: number
}

export const HEALTH_MAX: Readonly<HealthComponents> = Object.freeze({
  depth: 35,
  spread: 25,
  concentration: 20,
  persistence: 20,
})

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'

/**
 * Why a pool has no grade (docs/METRICS.md, "Rated and unrated pools"), tested in this order:
 * `hooked` for a pool with a hook (`isHookedPool`; not modelled: no depth, spread or concentration),
 * `unpriced` when a side's USD depth is unknown, `one-sided` when the deeper side holds the rating
 * floor and the thinner does not, `thin` when neither does.
 */
export type UnratedReason = 'hooked' | 'unpriced' | 'one-sided' | 'thin'

/**
 * What the concentration component was scored from (docs/METRICS.md, "Concentration (max 20)"):
 * owner shares covering at least `OWNER_COVERAGE_MIN` of the in-band liquidity, the range HHI of a
 * concentrated pool, or the neutral midpoint.
 */
export type ConcentrationBasis = 'owners' | 'ranges' | 'neutral'

export interface HealthScore {
  /** 0..100. Present for unrated pools too. */
  total: number
  /** Null when the pool is unrated. */
  grade: HealthGrade | null
  /** True when both ±2 % sides are known and the thinner one holds `HEALTH_RATING_MIN_SIDE_USD`. */
  rated: boolean
  /** Null when rated. */
  unratedReason: UnratedReason | null
  /**
   * Basis of the concentration component. Null only for a score stored before the basis was
   * recorded, until the next `score` run replaces it.
   */
  concentrationBasis: ConcentrationBasis | null
  components: HealthComponents
  /** Human-readable caveats, e.g. "persistence neutral: fewer than 3 samples". */
  notes: string[]
}

export interface HealthInputs {
  /** `depthUsd[pct = 2].upUsd`: USD of token1 that lifts the price 2 %; null when unpriced. */
  depth2UpUsd: number | null
  /** `depthUsd[pct = 2].downUsd`: USD of token0 that pushes the price 2 % down; null when unpriced. */
  depth2DownUsd: number | null
  spread10kBps: number | null
  ownerTop1Share: number | null
  /** `concentration.owners.coverage`; null when owners are unknown or stored without coverage. */
  ownerCoverage: number | null
  rangeHhi: number | null
  /** The pool's kind: a reserve pool's `rangeHhi = 1` holds by construction and is not scored. */
  poolKind: PoolKind
  persistence: PersistenceMetrics | null
  /** A pool with a hook (`isHookedPool`): unrated with reason `hooked`. Default false. */
  hooked?: boolean
}

export interface GapMetrics {
  volume24hUsd: number | null
  depth2Usd: number | null
  /** volume24hUsd / depth2Usd. Null when either is unknown or depth is 0. */
  turnoverRatio: number | null
  /** 0..100, see docs/METRICS.md. */
  gapScore: number | null
}

export interface SwapEvent {
  poolId: string
  blockNumber: bigint
  logIndex: number
  txHash: Hex
  /** Signed as emitted: positive = token flowed into the pool. */
  amount0: bigint
  amount1: bigint
  /** Unix seconds; filled when the block timestamp is known. */
  timestamp: number | null
}

export interface VolumeBucket {
  poolId: string
  /** Unix seconds, aligned to the hour. */
  hourStart: number
  volumeToken0: bigint
  volumeToken1: bigint
  volumeUsd: number | null
  swapCount: number
}

export interface PoolSnapshot {
  poolId: string
  blockNumber: bigint
  timestamp: number
  /** token1 per token0, human. */
  price: number
  token0Usd: number | null
  token1Usd: number | null
  tvlUsd: number | null
  /** Concentrated: active liquidity L. Others: 0n. */
  activeLiquidity: bigint
  depth: DepthLevel[]
  depthUsd: DepthLevelUsd[]
  spreads: SpreadPoint[]
  concentration: ConcentrationMetrics | null
  /**
   * |price / (token0Usd / token1Usd) − 1| × 10 000 (`priceDeviationBps`, docs/METRICS.md "Stale
   * quotes"); null when a token has no USD price, and in snapshots stored before the field existed.
   */
  priceDeviationBps: number | null
  /** LP fee in pips its depth and spread used (v4: the LP fee); null when stored before schema 7. */
  feePips: number | null
}

/**
 * An edge of the price graph (docs/METRICS.md, "USD prices"). A pool edge carries its ±2 % depth
 * sides and `derivePrices` weighs it in USD when it reaches it from a settled token:
 * `min(upToken1 × token1Usd, downToken0 × token0Usd)`, so a pool empty on one side is no route. An
 * edge without sides (the ETH ↔ WETH wrap edge) has a fixed `weight` instead.
 */
export interface PriceEdge {
  token0: Address
  token1: Address
  /** token1 per token0, human. */
  price: number
  /** Human token1 that pushes the price up by 2 % (the up side's input). */
  upToken1?: number
  /** Human token0 that pushes the price down by 2 % (the down side's input). */
  downToken0?: number
  /** Fixed weight (USD) of an edge without sides; ignored when the sides are given. */
  weight?: number
  source: string
}

export interface DerivedPrice {
  usd: number
  /** Pool ids / sources walked from the anchor. */
  via: string[]
  /** Bottleneck weight along the path, USD (Infinity for anchors). */
  weight: number
}

/** The per-swap limits of the trade switch (`maxUsd` in USD, `maxSlippageBps` in whole bps). */
export interface TradeLimits {
  maxUsd: number
  maxSlippageBps: number
}

/**
 * The trade switch (core `trade/flags.ts`): `features.trade` of the static bundle and `trade` of
 * `data/flags.json`. A block that is missing or not exactly this shape reads as off.
 */
export interface TradeFlags extends TradeLimits {
  /** False keeps the swap off on every venue, whatever `venues` lists. */
  enabled: boolean
  /** DEX ids the swap is on for, without repeats; empty when off. */
  venues: Dex[]
}

/** The optional `features` block of the static bundle; `data/flags.json` is exactly this. */
export interface FeatureFlags {
  trade: TradeFlags
}

/** Price levels (percent) and spread notionals (USD) computed for every snapshot. */
export const DEPTH_LEVELS_PCT: readonly number[] = [1, 2, 5]
export const SPREAD_NOTIONALS_USD: readonly number[] = [1_000, 10_000, 100_000, 1_000_000]
export const CONCENTRATION_BAND_PCT = 5
