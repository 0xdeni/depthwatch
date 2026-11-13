/**
 * Scorecard (`/mm/:id`, ia-v3 §4.6, docs/design/visual-v4.md §6.7): "Is this market maker meeting
 * its mandate right now, and how reliably?" The title section (back link, eyebrow, the mandate's
 * name with its status chip, and the answer: what the latest sample says against the per-side
 * KPI); the band with the KPI chart of that sample; the facts row over the band's edge (both
 * sides now, the 7 d uptime as a count, the spread with a spread KPI); then one sections sheet:
 * depth over time (with the 24 h / 7 d / 30 d control, `?window=`, 7 d by default), uptime,
 * breaches, worst moments, spread and the embed badge; then the Mandate panel. One 30 d samples
 * request serves every window. Every number is read as core stored it.
 */
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useDataNow } from '../api/context.js'
import { isNotFound } from '../api/errors.js'
import { useScorecard, useScorecardSamples } from '../api/hooks.js'
import type { SampleWindow, ScorecardDetail } from '../api/types.js'
import { BackLink } from '../components/ui/BackLink.js'
import { SectionsSheet } from '../components/ui/Section.js'
import { NotFoundState, SectionError, useDelayedPending } from '../components/ui/States.js'
import { cachedScorecard } from '../routeData.js'
import { readWindow, scorecardAnswer } from './mm/mmText.js'
import { ScorecardFacts, type Scrub } from './mm/ScorecardFacts.js'
import { ScorecardFocal } from './mm/ScorecardFocal.js'
import { EmbedSection, MandateAbout, SpreadSection } from './mm/ScorecardMore.js'
import { BreachesSection, UptimeSection, WorstSection } from './mm/ScorecardSections.js'
import { ScorecardSkeleton } from './mm/ScorecardSkeleton.js'
import { type SamplesState, TimeSection } from './mm/ScorecardTime.js'
import { ScorecardTitle } from './mm/ScorecardTitle.js'
import './mm/mm.css'

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function ScorecardView({
  detail,
  samples,
  win,
  onWindow,
}: {
  detail: ScorecardDetail
  samples: SamplesState
  win: SampleWindow
  onWindow: (w: SampleWindow) => void
}) {
  const now = useDataNow()
  const [instant, setInstant] = useState(false)
  const [scrub, setScrub] = useState<Scrub | null>(null)
  const data = samples.data
  const series = { points: data?.points, to: data?.to, win }
  return (
    <div className="sc">
      <title>{`${detail.mandate.name} – Depthwatch`}</title>
      <ScorecardTitle
        detail={detail}
        answer={
          <p className="answer sc-answer" data-rise="">
            {scorecardAnswer(detail, now)}
          </p>
        }
      />
      <ScorecardFocal detail={detail} />
      <ScorecardFacts detail={detail} scrub={scrub} />
      <div className="wrap sc-rest">
        <SectionsSheet>
          <TimeSection
            detail={detail}
            samples={samples}
            win={win}
            now={now}
            instant={instant}
            onInstant={setInstant}
            onWindow={(w, keyboard) => {
              setInstant(keyboard)
              onWindow(w)
            }}
            onScrub={setScrub}
          />
          <UptimeSection detail={detail} {...series} />
          <BreachesSection
            {...series}
            now={now}
            alertAfter={detail.mandate.alertAfterSamples}
            onRetry={samples.isError ? () => void samples.refetch() : undefined}
          />
          <WorstSection detail={detail} now={now} />
          <SpreadSection detail={detail} instant={instant} {...series} />
          <EmbedSection detail={detail} />
        </SectionsSheet>
        <MandateAbout detail={detail} now={now} />
      </div>
    </div>
  )
}

export function Scorecard() {
  const { id: rawId = '' } = useParams()
  const id = decodeId(rawId)
  const scorecard = useScorecard(id)
  const samples = useScorecardSamples(id, '30d')
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const win = readWindow(params.get('window'))
  const showSkeleton = useDelayedPending(scorecard.isPending)

  const onWindow = (w: SampleWindow) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (w === '7d') next.delete('window')
        else next.set('window', w)
        return next
      },
      { replace: true },
    )

  let content: ReactNode
  if (scorecard.data) {
    content = (
      <ScorecardView detail={scorecard.data} samples={samples} win={win} onWindow={onWindow} />
    )
  } else if (scorecard.isError && isNotFound(scorecard.error)) {
    content = (
      <>
        <title>Scorecard not found – Depthwatch</title>
        <NotFoundState
          title="scorecard not found"
          message="No market-maker mandate is registered under this id, or the link is wrong."
          id={id}
          links={{
            primary: { to: '/mm', label: 'Browse scorecards' },
            secondary: { to: '/methodology#scorecards', label: 'How scorecards work' },
          }}
        />
      </>
    )
  } else if (scorecard.isError) {
    content = (
      <section className="wrap ttl sc-ttl" aria-label="Scorecard">
        <BackLink to="/mm" label="Scorecards" />
        <div className="sc-error">
          <SectionError what="this scorecard" onRetry={() => void scorecard.refetch()} />
        </div>
      </section>
    )
  } else {
    // The title section from the scorecards list and the pool's summary, so it never waits (ST1).
    content = <ScorecardSkeleton visible={showSkeleton} cached={cachedScorecard(qc, id)} />
  }
  return content
}
