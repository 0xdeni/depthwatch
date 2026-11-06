/**
 * Wire shapes of every `/api` response (DESIGN.md "API (apps/api)").
 *
 * These are the JSON bodies as the dashboard receives them: every bigint of the shared core types
 * is a decimal string on the wire, which `Jsonified<T>` from core expresses. `apps/web` mirrors
 * these types; keep them additive.
 */
import type {
  ConcentrationBasis,
  Dex,
  Excursion,
  FeatureFlags,
  GapMetrics,
  HealthGrade,
  HealthScore,
  Jsonified,
  MmSample,
  PersistenceMetrics,
  PoolSnapshot,
  PublicMandate,
  PublicScorecardSummary,
  UnratedReason,
} from '@depthwatch/core'
import type { StockPoolRow, StockSummary } from './stockDto.js'
import type { LabelledPool, LabelledToken } from './tokenLabels.js'

/**
 * A token as every response carries it: `TokenInfo` plus `label`, core's `tokenLabel` over the
 * tokens of scored pools (the symbol, or "SYMBOL (name)" / "SYMBOL (0x3f5b…a4ee)" when another
 * address shares it). The address is the identity; the label is for display.
 */
export type TokenDto = LabelledToken
/** `PoolMeta` with labelled tokens (`TokenDto`). */
export type PoolMetaDto = Jsonified<LabelledPool>
export type PoolSnapshotDto = Jsonified<PoolSnapshot>

/** Error body of every non-2xx response. */
export interface ErrorResponse {
  error: string
  /**
   * Present on 400 validation errors: one entry per failed query parameter, or per problem of a
   * rejected registration body (`POST /api/mm`), where `path` is the offending field when the
   * problem names one and `(body)` otherwise.
   */
  issues?: Array<{ path: string; message: string }>
}

/**
 * `GET /api/health`. Never throws; `ok` is false (status 503) when the database is unreadable
 * (zero counts) or, with `?maxAge=<seconds>`, when `snapshotAgeSeconds` is null or above it
 * (counts filled, `error` starts with `stale: `).
 */
export interface HealthResponse {
  ok: boolean
  poolCount: number
  trackedCount: number
  /** Unix seconds of the newest snapshot; null before the first snapshot. */
  latestSnapshotAt: number | null
  /**
   * Unix seconds of the newest score; null before the first one. A pass stores its snapshots
   * first and its scores last, so the data that read scores (health, gap, 24 h volume) are new
   * once this moves, not when `latestSnapshotAt` does.
   */
  latestScoredAt: number | null
  /** The server's clock minus `latestSnapshotAt`; null before the first snapshot. */
  snapshotAgeSeconds: number | null
  /** Block number of the newest snapshot as a decimal string; null before the first snapshot. */
  latestBlock: string | null
  /**
   * Where the data comes from: `demo` when the server runs over the synthetic demo world
   * (`depthwatch demo`, `export --demo`), `live` otherwise. The dashboard shows the demo banner
   * and names the synthetic world as the data source when it is `demo`.
   */
  source: DataSource
  /** Set when `ok` is false. */
  error?: string
}

/** What the served data is: the synthetic demo world or the configured (mainnet) database. */
export type DataSource = 'demo' | 'live'

/** Totals for one DEX (one row per `DEXES` entry, in that order). */
export interface DexStatsDto {
  dex: Dex
  /** Pools discovered. */
  pools: number
  /** Pools the pipeline snapshots and scores. */
  tracked: number
  /** Pools with a score row. */
  scored: number
  /** Scored pools that are rated: both ±2 % sides known, the thinner one at least $5,000. */
  rated: number
  /**
   * Sum of ±2 % depth (USD) over scored pools, stale quotes (`PoolSummary.staleQuote`) and pools
   * unrated `transfers-paused` left out.
   */
  depth2Usd: number
  /** Scored pools with a known ±2 % depth, not stale, not paused: the ones `depth2Usd` sums. */
  depthKnownPools: number
  /** Sum of 24 h volume (USD) over scored pools with a known volume; null when none has one. */
  volume24hUsd: number | null
  /** Median health total over rated pools only; null when none is rated. */
  medianHealth: number | null
}

/** `GET /api/stats` */
export interface StatsResponse {
  byDex: DexStatsDto[]
  /** The same totals over every DEX. */
  totals: Omit<DexStatsDto, 'dex'>
}

export interface PoolHealthSummary {
  /** 0..100; present for unrated pools too. */
  total: number
  /** Null when the pool is not rated. */
  grade: HealthGrade | null
  rated: boolean
  /** Why there is no grade; null when rated. */
  unratedReason: UnratedReason | null
  /**
   * What the concentration component stands on (`HealthScore.concentrationBasis`): `owners`,
   * `ranges` (the range HHI: owners not indexed or covering under 90 %) or `neutral`; null for a
   * score stored before the basis was recorded.
   */
  concentrationBasis: ConcentrationBasis | null
}

/**
 * One row of the pools table (DESIGN.md `PoolSummary`). Only scored pools are summarised, so
 * `health` is always present; every other null means "not measured (yet)".
 */
export interface PoolSummary {
  pool: PoolMetaDto
  /** token1 per token0, human, from the latest snapshot. */
  price: number | null
  tvlUsd: number | null
  /** Total (up + down) depth at ±2 % in USD, as used by the score. */
  depth2Usd: number | null
  /**
   * USD of token1 that lifts the price 2 % (buy side), from the newest snapshot's ±2 % level
   * (`depthUsd[pct = 2].upUsd`); null when token1 has no USD price or the pool has no snapshot.
   */
  depth2UpUsd: number | null
  /**
   * USD of token0 that pushes the price down 2 % (sell side), `depthUsd[pct = 2].downUsd` of the
   * same snapshot; null when token0 has no USD price or the pool has no snapshot.
   */
  depth2DownUsd: number | null
  spread10kBps: number | null
  /**
   * The newest snapshot's `priceDeviationBps` (docs/METRICS.md, "Stale quotes"); null when a token
   * has no USD price, the pool has no snapshot or the snapshot predates the measure.
   */
  priceDeviationBps: number | null
  /** Core's `isStaleQuote(priceDeviationBps)`: left out of the stats' depth sums, last on depth. */
  staleQuote: boolean
  health: PoolHealthSummary
  gapScore: number | null
  volume24hUsd: number | null
  /**
   * The largest LP's share of the newest snapshot's in-band liquidity, where its owners describe
   * the pool (core's `poolOwnerTop1Share`: owners in the band covering at least 90 % of it); null
   * otherwise (owners not indexed, none in the band, or covering less).
   */
  ownerTop1Share: number | null
  /** Unix seconds of the latest snapshot; null when the pool was never snapshotted. */
  updatedAt: number | null
}

/** `GET /api/pools` */
export interface PoolsResponse {
  items: PoolSummary[]
  /** Scored pools matching the filters, ignoring limit/offset. */
  total: number
}

/** `GET /api/pools/:id`. Score fields are null for pools that are discovered but not scored. */
export interface PoolDetail {
  pool: PoolMetaDto
  tracked: boolean
  latest: PoolSnapshotDto | null
  score: HealthScore | null
  gap: GapMetrics | null
  persistence24h: PersistenceMetrics | null
  persistence7d: PersistenceMetrics | null
  /** The score's 24 h volume (docs/METRICS.md); null until the pool is scored. */
  volume24hUsd: number | null
  /** Unix seconds the score was computed; null when unscored. */
  scoredAt: number | null
}

export type HistoryWindow = '24h' | '7d'

/**
 * One snapshot of the history series. Scores are stored only for the latest state, so `health`
 * is recomputed per snapshot with core's `computeHealthScore` (see `history.ts`).
 */
export interface HistoryPoint {
  timestamp: number
  price: number
  depth2Usd: number | null
  spread10kBps: number | null
  tvlUsd: number | null
  /** Liquidity Health Score total (0..100) at this snapshot. */
  health: number
  /** `PoolSnapshot.feePips`: the LP fee (pips) this snapshot used; null when stored before it. */
  feePips: number | null
}

/** `GET /api/pools/:id/history?window=`. The window ends at the pool's newest snapshot. */
export interface HistoryResponse {
  window: HistoryWindow
  /** Unix seconds, inclusive bounds of the series. */
  from: number
  to: number
  points: HistoryPoint[]
}

/** One entry of the gaps feed: the pool summary plus its gap metrics. */
export interface GapItem {
  pool: PoolSummary
  gap: GapMetrics
}

/** `GET /api/gaps` */
export interface GapsResponse {
  items: GapItem[]
  /** Pools in the whole feed at this floor, ignoring limit/offset. */
  total: number
  /**
   * Pools in the whole feed trading 3× their ±2 % depth or more (core's `isMeaningfulGap`),
   * ignoring limit/offset.
   */
  meaningful: number
  /** Volume floor applied (USD, default 10 000). */
  minVolumeUsd: number
}

/** `GET /api/tokens/:address` */
export interface TokenDetail {
  token: TokenDto
  /** Derived USD price; null when the token is unreachable from the stable anchors. */
  usd: number | null
  /** Pool ids / sources the USD price was derived through (empty for anchors or unpriced). */
  via: string[]
  /** Unix seconds the price was derived; null when unpriced. */
  priceUpdatedAt: number | null
  /** Scored pools containing the token, with their latest summary. */
  pools: PoolSummary[]
  /** Scored pools containing the token, ignoring limit/offset. */
  total: number
  /** Every discovered pool containing the token, scored or not. */
  poolCount: number
  /**
   * `depth2Usd` summed over every scored pool containing the token with a known depth, no stale
   * quote and transfers not paused, ignoring limit/offset (docs/METRICS.md, "A token's depth"); null
   * when none has one.
   */
  depth2UsdTotal: number | null
  /** Its scored pools with a known depth, not stale, not paused: the ones `depth2UsdTotal` sums. */
  depthKnownPools: number
}

// ---------------------------------------------------------------------------------------------
// Tokenized stocks (docs/design/stocks-api.md §1; the rows are in stockDto.ts)
// ---------------------------------------------------------------------------------------------

/**
 * `GET /api/stocks`: every stock of the stored stock list, with pools or not, by
 * `depth2BuyUsd + depth2SellUsd` descending (unknown last), then ticker.
 */
export interface StocksResponse {
  items: StockSummary[]
}

/**
 * `GET /api/stocks/:token`: the stock's summary plus every scored pool of it, the counted pools
 * first, then the larger thinner side (unknown last), then the pool id.
 */
export type StockDetail = StockSummary & { pools: StockPoolRow[] }

// ---------------------------------------------------------------------------------------------
// Market-maker scorecards (docs/design/scorecards.md §6)
// ---------------------------------------------------------------------------------------------

/**
 * A registered mandate as the API shows it: the stored fields except `alertWebhookUrl`, which is
 * a bearer secret and never leaves the database; `alertWebhookConfigured` says whether one is set.
 */
export type MandateDto = Jsonified<PublicMandate>
/** One scorecard sample; `blockNumber` is a decimal string. */
export type MmSampleDto = Jsonified<MmSample>
export type ExcursionDto = Jsonified<Excursion>
/** Core `ScorecardSummary` on the wire: public mandate, latest sample, uptime windows, worst, streak. */
export type ScorecardSummaryDto = Jsonified<PublicScorecardSummary>

/** `GET /api/mm?pool=&active=`: active mandates first, then by name. */
export interface ScorecardsResponse {
  items: ScorecardSummaryDto[]
}

/**
 * `GET /api/mm/:id`: the scorecard plus the observatory's own row for the mandated pool, null
 * until that pool is scored (or when the mandate points at a pool the observatory never saw).
 */
export type ScorecardDetail = ScorecardSummaryDto & { pool: PoolSummary | null }

export type SampleWindow = '24h' | '7d' | '30d'

/**
 * `GET /api/mm/:id/samples?window=&limit=`: the mandate's samples inside the window, ascending by
 * time. `from`/`to` are inclusive unix-second bounds ending at the server's clock; when more than
 * `limit` samples fall inside the window the newest `limit` are returned.
 */
export interface SamplesResponse {
  window: SampleWindow
  from: number
  to: number
  points: MmSampleDto[]
}

/** `DELETE /api/mm/:id`: the mandate and its stored samples / alerts are gone. */
export interface DeleteMandateResponse {
  id: string
  deleted: true
  /** Samples removed together with the mandate. */
  samplesDeleted: number
  /** Alert records removed together with the mandate. */
  alertsDeleted: number
}

// ---------------------------------------------------------------------------------------------
// Static bundle (docs/design/web-v2.md §4)
// ---------------------------------------------------------------------------------------------

/**
 * Everything the static dashboard (`VITE_STATIC=1`) reads, exported by `depthwatch export` through
 * the real API (`createApp(db, { now }).request(...)` per route), so the static site shows exactly
 * what the server would at `generatedAt`. `apps/web/src/api/types.ts` mirrors it.
 */
export interface StaticBundle {
  v: 1
  /** Unix seconds: the clock the API answered with. */
  generatedAt: number
  source: DataSource
  /**
   * The exporter's note on the data (`depthwatch export --note`): coverage, pipeline, caveats.
   * The static dashboard shows it in the "About this snapshot" popover of a `live` bundle; absent
   * when no note was given (demo exports carry none).
   */
  note?: string
  /**
   * The trade switch (`depthwatch export` from DEPTHWATCH_TRADE, docs/DEPLOY.md "Trade switch"),
   * also written next to the bundle as `flags.json`. Absent from bundles exported before it, which
   * read as off; `parseTradeFlags` reads it, failing closed.
   */
  features?: FeatureFlags
  health: HealthResponse
  stats: StatsResponse
  /** Every scored pool (all pages of `/api/pools`, default order: health desc). */
  pools: PoolSummary[]
  /** `/api/pools/:id` per pool of `pools`; key = pool id. */
  poolDetails: Record<string, PoolDetail>
  /** `/api/pools/:id/history` per pool of `pools`, both windows. */
  history: Record<string, { '24h': HistoryResponse; '7d': HistoryResponse }>
  /** The full `/api/gaps` feed at the default volume floor. */
  gaps: GapItem[]
  gapsMinVolumeUsd: number
  /**
   * `/api/tokens/:address` of every token in `pools`, key = lowercase address, with `pools`
   * holding every scored pool of the token (default order: depth desc). Tokens the API answers
   * 404 for are absent.
   */
  tokens: Record<string, TokenDetail>
  /** `/api/mm`: every mandate, active and inactive. */
  scorecards: ScorecardSummaryDto[]
  /** `/api/mm/:id` per mandate; key = mandate id. */
  scorecardDetails: Record<string, ScorecardDetail>
  /** `/api/mm/:id/samples` per mandate and window (default limit). */
  samples: Record<string, { '24h': SamplesResponse; '7d': SamplesResponse; '30d': SamplesResponse }>
  /** `/api/mm/:id/badge.svg` per mandate: the SVG text. */
  badges: Record<string, string>
  /**
   * `/api/stocks`: every stored stock. Absent from bundles exported before the stock routes,
   * which the static dashboard reads as no stock (`{ items: [] }`).
   */
  stocks?: StockSummary[]
  /**
   * `/api/stocks/:token` per stock of `stocks`; key = lowercase address. Absent from older
   * bundles, where every stock is `stock not found`.
   */
  stockDetails?: Record<string, StockDetail>
}
