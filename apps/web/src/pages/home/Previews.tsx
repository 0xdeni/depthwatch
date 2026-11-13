/**
 * The two previews under Home's facts (P7, docs/design/visual-v4.md §6.2), at most 3 rows each:
 * - "where liquidity is thin" (7 columns): the count sentence, the three biggest gaps as rows
 *   (pool, "Trades 205× its depth a day", the turnover glyph and the gap score), then "See all
 *   gaps" and the glyph's caption;
 * - "market makers on the record" (5 columns): the mandates' rows (status, name, market maker and
 *   pool, 7 d uptime against its target) and "See all scorecards". Home shows it only once a
 *   mandate is registered; until then the gaps preview spans the whole row (`wide`).
 * The full feeds live on /gaps and /mm.
 */
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { usePoolMetas } from '../../api/hooks.js'
import type {
  GapItem,
  GapsResponse,
  PoolMetaDto,
  PoolSummary,
  ScorecardsResponse,
} from '../../api/types.js'
import { TurnoverGlyph } from '../../components/charts/index.js'
import { blockClass } from '../../components/ui/Block.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { MandateRow } from '../../components/ui/MandateRow.js'
import { SectionError, Skeleton } from '../../components/ui/States.js'
import { pairLabel, poolDesc, poolHref, ratio, score, shortAddress } from '../../lib/format.js'
import { splitPoolId } from '../../lib/scorecard.js'
import { GAPS_QUIET_LINE, gapsTakeaway, KPIS_DEFINITION, mandatesTakeaway } from './copy.js'

/** Rows in each preview (P7: previews hold at most 3 rows and link out). */
export const PREVIEW_ROWS = 3

const GAPS_TITLE = 'where liquidity is thin'
const MM_TITLE = 'market makers on the record'

/** A preview block: the lowercase heading and its one sentence, then the rows and the foot. */
function Preview({
  id,
  title,
  span,
  panel = false,
  takeaway,
  busy = false,
  children,
}: {
  id: string
  title: string
  span: 5 | 7 | 12
  panel?: boolean
  takeaway: ReactNode
  busy?: boolean
  children?: ReactNode
}) {
  return (
    <section
      className={blockClass({ variant: panel ? 'panel' : 'plain', span, className: 'home-pv' })}
      aria-labelledby={id}
      aria-busy={busy || undefined}
    >
      <div className="blk-head">
        <h2 className="h2" id={id}>
          {title}
        </h2>
        {takeaway ? <p className="take">{takeaway}</p> : null}
      </div>
      {children}
    </section>
  )
}

function GapRow({ item }: { item: GapItem }) {
  const pool = item.pool.pool
  const pair = pairLabel(pool.token0, pool.token1)
  const r = ratio(item.gap.turnoverRatio)
  return (
    <li>
      <div className="rl-row home-gap-row">
        <span className="cell-pool">
          <Link
            className="pp rl-link"
            to={poolHref(pool.id)}
            aria-label={`${pair}, ${poolDesc(pool)}: trades ${r} its depth a day, gap score ${score(item.gap.gapScore)}`}
          >
            {pair}
          </Link>
          <span className="pd">{poolDesc(pool)}</span>
        </span>
        <span className="row-say">
          <span className="long">Trades </span>
          {r}
          <span className="long"> its depth a day</span>
        </span>
        <TurnoverGlyph gapScore={item.gap.gapScore} />
      </div>
    </li>
  )
}

/** The sentence, static rows and the foot's line under a preview's heading while it loads (ST1). */
function SkeletonBody({ waiting }: { waiting: boolean }) {
  const cls = waiting ? ' is-waiting' : ''
  return (
    <>
      <ul className={`rowlist is-ruled home-skel-rows${cls}`} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="rl-row">
            <Skeleton height={15} width="40%" />
          </li>
        ))}
      </ul>
      <span className={`blk-foot home-skel-foot${cls}`} aria-hidden="true">
        <Skeleton height={15} width="12ch" />
      </span>
    </>
  )
}

/** The takeaway's line while the preview loads. */
const skeletonTake = (waiting: boolean) => (
  <Skeleton height="1lh" width="28ch" className={waiting ? 'is-waiting' : undefined} />
)

export function GapsPreview({
  gaps,
  meaningful,
  count,
  waiting,
  wide = false,
}: {
  gaps: UseQueryResult<GapsResponse>
  /** The first page's pools trading 3× their depth or more, highest first. */
  meaningful: readonly GapItem[] | undefined
  /** The API's count of those pools over the whole feed. */
  count: number | undefined
  /** Loading for under 300 ms: the skeleton holds its space unseen (M10). */
  waiting: boolean
  /** Alone in its row (no scorecards preview beside it): the full width. */
  wide?: boolean
}) {
  const span = wide ? 12 : 7
  const foot = (caption: boolean) => (
    <div className="blk-foot">
      <Link className="ulink touch-hit" to="/gaps">
        See all gaps
      </Link>
      {caption ? <span className="cap">Gap score 0–100; the tick marks 3× turnover</span> : null}
    </div>
  )
  if (gaps.isError)
    return (
      <Preview id="home-gaps" title={GAPS_TITLE} span={span} takeaway={null}>
        <SectionError what="the gaps" onRetry={() => void gaps.refetch()} />
        {foot(false)}
      </Preview>
    )
  if (!meaningful || count === undefined)
    return (
      <Preview id="home-gaps" title={GAPS_TITLE} span={span} takeaway={skeletonTake(waiting)} busy>
        <SkeletonBody waiting={waiting} />
      </Preview>
    )
  const shown = meaningful.slice(0, PREVIEW_ROWS)
  return (
    <Preview id="home-gaps" title={GAPS_TITLE} span={span} takeaway={gapsTakeaway(count)}>
      {shown.length > 0 ? (
        <ul className="rowlist is-ruled">
          {shown.map((g) => (
            <GapRow key={g.pool.pool.id} item={g} />
          ))}
          {shown.length < PREVIEW_ROWS ? <li className="rl-quiet">{GAPS_QUIET_LINE}</li> : null}
        </ul>
      ) : null}
      {foot(shown.length > 0)}
    </Preview>
  )
}

/** "USDC / AERO" from the observatory's pool, or the short address while it is unknown. */
function poolName(poolId: string, meta: PoolMetaDto | undefined): string {
  if (meta) return pairLabel(meta.token0, meta.token1)
  return shortAddress(splitPoolId(poolId).key)
}

export function MandatesPreview({
  scorecards,
  pools,
  waiting,
}: {
  scorecards: UseQueryResult<ScorecardsResponse>
  /** Every scored pool, for the mandated pools' names. */
  pools: readonly PoolSummary[] | undefined
  waiting: boolean
}) {
  const items = scorecards.data?.items
  const shown = items?.slice(0, PREVIEW_ROWS) ?? []
  const known = new Map(pools?.map((p) => [p.pool.id, p.pool]))
  // Mandated pools that are not scored are looked up one by one (they share the pool page's cache).
  const missing = pools ? shown.map((s) => s.mandate.poolId).filter((id) => !known.has(id)) : []
  const metas = usePoolMetas(missing)
  if (scorecards.isError)
    return (
      <Preview id="home-mm" title={MM_TITLE} span={5} panel takeaway={null}>
        <SectionError what="the scorecards" onRetry={() => void scorecards.refetch()} />
      </Preview>
    )
  if (!items)
    return (
      <Preview id="home-mm" title={MM_TITLE} span={5} panel takeaway={skeletonTake(waiting)} busy>
        <SkeletonBody waiting={waiting} />
      </Preview>
    )
  // Home leaves the block out while no mandate is registered.
  if (items.length === 0) return null
  const words = mandatesTakeaway(items)
  return (
    <Preview
      id="home-mm"
      title={MM_TITLE}
      span={5}
      takeaway={
        <>
          {words.before}
          <Glossary definition={KPIS_DEFINITION} anchor="scorecards">
            KPIs
          </Glossary>
          {words.after}
        </>
      }
    >
      <ol className="rowlist is-ruled">
        {shown.map((s) => (
          <MandateRow
            key={s.mandate.id}
            summary={s}
            where={poolName(
              s.mandate.poolId,
              known.get(s.mandate.poolId) ?? metas.get(s.mandate.poolId),
            )}
          />
        ))}
      </ol>
      <div className="blk-foot">
        <Link className="ulink touch-hit" to="/mm">
          See all scorecards
        </Link>
      </div>
    </Preview>
  )
}
