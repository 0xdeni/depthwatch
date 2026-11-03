/**
 * Pool (`/pools/:id`, ia-v3 §4.3, docs/design/visual-v4.md §6.4): "Is this pool deep and healthy
 * enough, and on which side is it thin?" The title section (back link, eyebrow, the pair and its
 * price line at left, the answer at right), then the band with the focal mirrored depth curve and
 * its Show data, the facts row as an ink block over the band's lower edge (with the gap callout),
 * the sections sheet in a fixed order (health, cost to trade, trade in this pool when the trade
 * switch allows it, who provides it, over time with `?window=7d`, mandates on this pool) and
 * about this pool as a panel. Every number is read as the
 * API stored it and only formatted here.
 */
import { isStaleQuote } from '@depthwatch/core'
import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { isNotFound } from '../api/errors.js'
import { usePool } from '../api/hooks.js'
import type { HistoryWindow, PoolDetail as PoolDetailDto } from '../api/types.js'
import { BackLink } from '../components/ui/BackLink.js'
import { SectionsSheet } from '../components/ui/Section.js'
import { NotFoundState, SectionError, useDelayedPending } from '../components/ui/States.js'
import { pairLabel } from '../lib/format.js'
import { cachedPoolSummary } from '../routeData.js'
import { OverTime } from './pool/OverTime.js'
import { PoolAbout } from './pool/PoolAbout.js'
import { PoolBand } from './pool/PoolBand.js'
import { PoolFacts } from './pool/PoolFacts.js'
import { PoolMandates } from './pool/PoolMandates.js'
import { CostSection, HealthSection, WhoSection } from './pool/PoolSections.js'
import { PoolSkeleton } from './pool/PoolSkeleton.js'
import { PoolTitle } from './pool/PoolTitle.js'
import { poolAnswer } from './pool/poolText.js'
import { TradeSection } from './pool/TradeSection.js'
import './pool/pool.css'

function decodePoolId(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function PoolView({
  detail,
  win,
  onWindow,
}: {
  detail: PoolDetailDto
  win: HistoryWindow
  onWindow: (w: HistoryWindow) => void
}) {
  const { pool, latest } = detail
  const pair = pairLabel(pool.token0, pool.token1)
  return (
    <div className="pool">
      <title>{`${pair} – Depthwatch`}</title>
      <PoolTitle
        pool={pool}
        spot={latest?.price ?? null}
        staleDeviationBps={
          latest && isStaleQuote(latest.priceDeviationBps) ? latest.priceDeviationBps : undefined
        }
        answer={
          <p className="answer pool-answer" data-rise="">
            {poolAnswer(detail)}
          </p>
        }
      />
      <PoolBand detail={detail} />
      <PoolFacts detail={detail} />
      <div className="wrap pool-rest">
        <SectionsSheet>
          <HealthSection detail={detail} />
          <CostSection detail={detail} />
          {/* Keyed: another pool's page ends this one's swap and closes its panel. */}
          <TradeSection key={pool.id} detail={detail} />
          <WhoSection detail={detail} />
          <OverTime detail={detail} window={win} onWindow={onWindow} />
          <PoolMandates pool={pool} />
        </SectionsSheet>
        <PoolAbout detail={detail} />
      </div>
    </div>
  )
}

export function PoolDetail() {
  const { id: rawId = '' } = useParams()
  const id = decodePoolId(rawId)
  const pool = usePool(id)
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const win: HistoryWindow = params.get('window') === '7d' ? '7d' : '24h'
  const showSkeleton = useDelayedPending(pool.isPending)

  const onWindow = (w: HistoryWindow) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (w === '24h') next.delete('window')
        else next.set('window', w)
        return next
      },
      { replace: true },
    )

  let content: ReactNode
  if (pool.data) {
    content = <PoolView detail={pool.data} win={win} onWindow={onWindow} />
  } else if (pool.isError && isNotFound(pool.error)) {
    content = (
      <NotFoundState
        title="pool not found"
        message="Depthwatch does not track this pool, or the link is wrong."
        id={id}
      />
    )
  } else if (pool.isError) {
    content = (
      <section className="wrap ttl pool-ttl" aria-label="Pool">
        <BackLink to="/pools" label="Pools" />
        <div className="pool-error">
          <SectionError what="this pool" onRetry={() => void pool.refetch()} />
        </div>
      </section>
    )
  } else {
    // The title section from a list that already holds this pool, so it never waits (ST1).
    content = <PoolSkeleton visible={showSkeleton} summary={cachedPoolSummary(qc, id)} />
  }
  return content
}
