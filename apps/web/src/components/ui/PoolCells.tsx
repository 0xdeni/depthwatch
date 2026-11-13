/**
 * The pools table's cells (docs/design/visual-v4.md §5.8), shared by Pools, Token and the Gaps
 * table: health is the truncated score in a 2ch column (N6) plus the grade glyph, depth the 84 × 20
 * row glyph plus the value 16 px apart (and the "Stale price" chip for a stale quote), and an
 * unknown value is "—" with its reason (D6). Formatting only: every value comes from the API.
 */
import type { PoolSummary } from '../../api/types.js'
import {
  ago,
  bps,
  cantAbsorb,
  price,
  SPREAD_UNABSORBED_BPS,
  score,
  shareOf,
  usd,
} from '../../lib/format.js'
import { basePrice } from '../../lib/orient.js'
import { type PoolsSortKey, tvlReason, UNKNOWN_REASON } from '../../lib/poolsTable.js'
import { unratedDetail, unratedShort } from '../../lib/rating.js'
import { STALE_PRICE, staleQuoteDetail } from '../../lib/staleQuote.js'
import { RowDepthGlyph } from '../charts/RowDepthGlyph.js'
import { Glossary } from './Glossary.js'
import { NotRatedChip, RatingGlyph } from './GradeGlyph.js'
import { Unknown } from './Unknown.js'

/**
 * The chip of a stale quote (docs/METRICS.md, "Stale quotes"): neutral, "Stale price", and how far
 * the pool's price is from the market on hover, focus or tap.
 */
export function StaleQuoteChip({ deviationBps }: { deviationBps: number | null }) {
  return (
    <span className="grade tone-none is-stale">
      <Glossary definition={staleQuoteDetail(deviationBps)} anchor="depth">
        {STALE_PRICE}
      </Glossary>
    </span>
  )
}

/** Why a depth or spread is unknown: a hooked pool is not modelled, otherwise a price is missing. */
function missingReason(p: PoolSummary, fallback: string): string {
  return p.health.unratedReason === 'hooked' ? unratedDetail('hooked') : fallback
}

/**
 * Health: the truncated score, then the grade glyph, the order of the pool page's fact; or for a
 * pool with no grade the "Not rated" chip alone: its total is not a grade, so the row does not
 * show it as one. `marked`: the grade's concentration basis differs from the one the table's
 * Health header states (`HealthBasis`), so the glyph carries the "*".
 */
export function HealthCell({
  health,
  marked = false,
}: {
  health: PoolSummary['health']
  marked?: boolean
}) {
  if (!health.rated || health.grade === null) {
    return (
      <span className="td-health">
        <NotRatedChip reason={health.unratedReason} />
      </span>
    )
  }
  return (
    <span className="td-health">
      <span className="n">{score(health.total)}</span>
      <RatingGlyph health={health} marked={marked} />
    </span>
  )
}

export function DepthCell({ pool, max }: { pool: PoolSummary; max: number }) {
  return (
    <span className="td-depth">
      <RowDepthGlyph sell={pool.depth2DownUsd} buy={pool.depth2UpUsd} max={max} />
      <span>{metricCell(pool, 'depth')}</span>
      {pool.staleQuote ? <StaleQuoteChip deviationBps={pool.priceDeviationBps} /> : null}
    </span>
  )
}

/** The $10K spread of a priced pool: basis points, or where it would be, "Can’t absorb $10K". */
function spreadText(v: number | null): string {
  return v !== null && Math.round(Math.abs(v)) < SPREAD_UNABSORBED_BPS ? bps(v) : cantAbsorb(10_000)
}

export type CellKey = PoolsSortKey | 'price' | 'updated'

/**
 * Why a pool's value in this column is "—" (D6), or null when the column shows a value. A null
 * spread is "—" only for a pool with no USD price or a hooked pool (not modelled); otherwise the
 * pool cannot absorb $10K.
 */
export function unknownReason(p: PoolSummary, key: CellKey): string | null {
  switch (key) {
    case 'health':
      // The total of a pool with no grade is not a grade: the chip beside it says so.
      return p.health.rated ? null : unratedShort(p.health.unratedReason)
    case 'depth':
      return p.depth2Usd === null ? missingReason(p, UNKNOWN_REASON.depth) : null
    case 'spread': {
      const reason = p.health.unratedReason
      return p.spread10kBps === null && (reason === 'unpriced' || reason === 'hooked')
        ? missingReason(p, UNKNOWN_REASON.spread)
        : null
    }
    case 'volume':
      return p.volume24hUsd === null ? UNKNOWN_REASON.volume : null
    case 'gap':
      return p.gapScore === null ? UNKNOWN_REASON.gap : null
    case 'tvl':
      return p.tvlUsd === null ? tvlReason(p.pool.dex) : null
    case 'top':
      return p.ownerTop1Share === null ? UNKNOWN_REASON.top : null
    case 'price':
      return p.price === null ? UNKNOWN_REASON.price : null
    case 'updated':
      return p.updatedAt === null ? UNKNOWN_REASON.updated : null
  }
}

/** The value of one metric of a pool, as its column (and the phone row) shows it. */
export function metricCell(p: PoolSummary, key: CellKey, now = 0) {
  const why = unknownReason(p, key)
  if (why !== null) return <Unknown reason={why} />
  switch (key) {
    case 'health':
      return score(p.health.total)
    case 'depth':
      return usd(p.depth2Usd)
    case 'spread':
      return spreadText(p.spread10kBps)
    case 'volume':
      return usd(p.volume24hUsd)
    case 'gap':
      return score(p.gapScore)
    case 'tvl':
      return usd(p.tvlUsd)
    case 'top':
      return shareOf(p.ownerTop1Share)
    case 'price':
      // From the pool's base token (N2): cbBTC / USDC's 0.00001522 reads 65,712.95.
      return price(basePrice(p.price))
    case 'updated':
      return ago(p.updatedAt, now)
  }
}
