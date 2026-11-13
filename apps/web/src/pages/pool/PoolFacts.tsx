/**
 * The Pool facts row (docs/design/visual-v4.md §6.4, §5.6): one ink block stacked over the band's
 * lower edge, value first and the comparison in the label (P4): health with its grade, "the
 * median rated pool scores 61"; spread at $10K, a round trip, in percent with the dollars and bps
 * it comes to under it ("0.18 %", "about $18 (17.8 bps)"); 24 h volume, "14× the depth within
 * 2 %"; TVL, "of which 10 % sits within 2 %". Four columns from 1024 px, 2 × 2 on phones. When the
 * pool trades 3× its depth a day or more, the gap callout follows under a Gray 80 rule with "See
 * all gaps" (TB9). Unknown values are "—" with the reason on hover, focus or tap (D6).
 */
import { Link } from 'react-router-dom'
import { useGaps, useStats } from '../../api/hooks.js'
import type { PoolDetail } from '../../api/types.js'
import { MEANINGFUL_GAP_TURNOVER } from '../../components/charts/TurnoverGlyph.js'
import { Overlap } from '../../components/ui/Block.js'
import { Fact, FactsRow } from '../../components/ui/Fact.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { NotRatedChip } from '../../components/ui/GradeGlyph.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { cantAbsorb, roundTripCost, score, usd } from '../../lib/format.js'
import { tvlReason } from '../../lib/poolsTable.js'
import { unratedDetail } from '../../lib/rating.js'
import { GAP_FEED } from '../../lib/useGapFeed.js'
import {
  gapCallout,
  healthFactSuffix,
  spreadAt,
  tvlFactLabel,
  volumeFactLabel,
} from './poolText.js'

function GapNote({ detail }: { detail: PoolDetail }) {
  const gaps = useGaps(GAP_FEED)
  const turnover = detail.gap?.turnoverRatio ?? null
  if (turnover === null || turnover < MEANINGFUL_GAP_TURNOVER) return null
  // The count is the API's over the whole feed; the first page shows the pool is in it.
  const items = gaps.data?.items ?? []
  const listed = items.some((g) => g.pool.pool.id === detail.pool.id)
    ? (gaps.data?.meaningful ?? null)
    : null
  return (
    <>
      {gapCallout(turnover, listed, MEANINGFUL_GAP_TURNOVER)}{' '}
      <Link className="ulink touch-hit" to="/gaps">
        See all gaps
      </Link>
    </>
  )
}

export function PoolFacts({ detail }: { detail: PoolDetail }) {
  const stats = useStats()
  const { score: health, latest, pool, gap } = detail
  const spread10k = latest ? spreadAt(latest.spreads, 10_000) : null
  const cost10k = roundTripCost(spread10k, 10_000)
  // No spread on a priced pool: it "can't absorb" the trade (null, or more than a trade can pay).
  // A hooked pool has no spread at all: it is not modelled.
  const hooked = health?.unratedReason === 'hooked'
  const spreadUnabsorbed =
    latest !== null && health?.unratedReason !== 'unpriced' && !hooked && spread10k === null
  const gapOn = gap?.turnoverRatio != null && gap.turnoverRatio >= MEANINGFUL_GAP_TURNOVER
  const depth2 = latest?.depthUsd.find((d) => d.pct === 2)?.totalUsd
  return (
    <Overlap label="Facts" className="pool-facts-wrap">
      <FactsRow
        layout="pool"
        label="Pool facts"
        className="pool-facts"
        note={gapOn ? <GapNote detail={detail} /> : undefined}
      >
        <Fact
          value={
            health ? (
              health.rated ? (
                score(health.total)
              ) : (
                <NotRatedChip reason={health.unratedReason} size="fact" />
              )
            ) : (
              <Unknown reason="Not scored yet: scores appear after the pool’s first snapshots." />
            )
          }
          grade={health?.rated ? health.grade : null}
          gradeBasis={health?.concentrationBasis}
          label={
            <>
              <Glossary
                definition="One score from 0 to 100, built from depth, spread, concentration and persistence."
                anchor="health"
              >
                health
              </Glossary>
              {healthFactSuffix(stats.data?.totals.medianHealth)}
            </>
          }
        />
        <Fact
          value={
            spreadUnabsorbed ? (
              <span className="fv-words">{cantAbsorb(10_000)}</span>
            ) : cost10k === null ? (
              <Unknown
                reason={
                  hooked
                    ? unratedDetail('hooked')
                    : 'No spread: a token in this pool has no USD price.'
                }
              />
            ) : (
              <>
                {cost10k.percent}{' '}
                <span className="fv-sub">
                  about {cost10k.dollars} ({cost10k.bps})
                </span>
              </>
            )
          }
          label="spread at $10K, a round trip"
        />
        <Fact
          value={
            detail.volume24hUsd === null ? (
              <Unknown reason="No priced swaps were indexed in the last 24 hours." />
            ) : (
              usd(detail.volume24hUsd)
            )
          }
          label={volumeFactLabel(gap?.turnoverRatio)}
        />
        <Fact
          value={
            latest?.tvlUsd == null ? <Unknown reason={tvlReason(pool.dex)} /> : usd(latest.tvlUsd)
          }
          label={tvlFactLabel(depth2, latest?.tvlUsd ?? null)}
        />
      </FactsRow>
    </Overlap>
  )
}
