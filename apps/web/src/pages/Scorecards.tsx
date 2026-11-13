/**
 * Scorecards (`/mm`, ia-v3 §4.5, docs/design/visual-v4.md §6.6): "Which market makers are meeting
 * their mandates?" The title section (eyebrow, the lowercase title "scorecards" and the answer at
 * its right: "1 of 2 mandates is within its KPIs right now.", or that none is registered); then
 * the band with the lead and, when there are mandates, the filter (All / Active / Inactive,
 * `?active=`) and the List / Table view (`?view=`), both written to the URL with replace. Over the
 * band's lower edge sits one block: the mandate rows (status word, name, market maker and pool,
 * 7 d uptime with its bullet, and the 7 d strip on desktop), the table with every v2 column, or,
 * with no mandate, one destination block that explains how a scorecard is checked. With no mandate
 * a server's lead adds how one is registered; a static copy, which has neither the API nor the
 * CLI, does not, and while it loads a bundle built with no mandate it already shows that page
 * (`lib/shipped.ts`). The nav lists this page only once a mandate exists (`useNavItems`);
 * Methodology links to it.
 */
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useDataNow, useIsStatic, useSnapshot } from '../api/context.js'
import { usePoolMetas, useScorecards } from '../api/hooks.js'
import type { ScorecardsQuery } from '../api/types.js'
import { Band } from '../components/ui/Band.js'
import { Overlap } from '../components/ui/Block.js'
import { Button } from '../components/ui/Button.js'
import { SegmentedControl } from '../components/ui/SegmentedControl.js'
import {
  EmptyState,
  Refetch,
  SectionError,
  Skeleton,
  SkeletonGroup,
  useDelayedPending,
} from '../components/ui/States.js'
import { count } from '../lib/format.js'
import { shippedMandates, shippedSnapshot } from '../lib/shipped.js'
import { useIsPhone } from '../lib/useMediaQuery.js'
import { HowItWorks, MandateRows, STRIP_LIMIT } from './mm/MandateRows.js'
import { MandatesTable } from './mm/MandatesTable.js'
import { listAnswer, noMandates } from './mm/mmText.js'
import './mm/mm.css'

type ActiveFilter = 'all' | 'active' | 'inactive'
type View = 'list' | 'table'

const FILTERS: ReadonlyArray<{ value: ActiveFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]
const VIEWS: ReadonlyArray<{ value: View; label: string }> = [
  { value: 'list', label: 'List' },
  { value: 'table', label: 'Table' },
]

export const SCORECARD_LEAD =
  'A scorecard checks the depth a market maker promised against what is onchain at every snapshot.'

/** `?active=true|false` → the filter; anything else means all (v2's parameter, unchanged). */
export function readFilter(value: string | null): ActiveFilter {
  if (value === 'true') return 'active'
  if (value === 'false') return 'inactive'
  return 'all'
}

function toQuery(filter: ActiveFilter): ScorecardsQuery {
  if (filter === 'all') return {}
  return { active: filter === 'active' }
}

export function Scorecards() {
  const [params, setParams] = useSearchParams()
  const filter = readFilter(params.get('active'))
  const view: View = params.get('view') === 'table' ? 'table' : 'list'
  const all = useScorecards({})
  const shown = useScorecards(toQuery(filter))
  const items = shown.data?.items
  const pools = usePoolMetas(items?.map((s) => s.mandate.poolId) ?? [])
  const phone = useIsPhone()
  const now = useDataNow()
  const snapshot = useSnapshot() !== undefined
  // A static copy has no API and no CLI, so it never says how to register a mandate.
  const howToAdd = !useIsStatic()
  const waiting = useDelayedPending(all.isPending || shown.isPending)
  const total = all.data?.items.length
  // No mandate: known, or, while a static build loads, what the bundle it was built with says
  // (`lib/shipped.ts`), so that page is drawn from the first frame and nothing moves.
  const none = total === 0 || (all.isPending && shippedMandates() === false)
  const answer = all.data
    ? listAnswer(all.data.items, snapshot)
    : none
      ? noMandates(shippedSnapshot() === true)
      : null

  const write = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === null) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  const setFilter = (f: ActiveFilter) =>
    write('active', f === 'all' ? null : f === 'active' ? 'true' : 'false')

  const caption =
    items && total !== undefined
      ? items.length === total
        ? `${count(total)} ${total === 1 ? 'mandate' : 'mandates'}`
        : `Showing ${count(items.length)} of ${count(total)} mandates`
      : ''

  let body: ReactNode
  if (all.isError || shown.isError) {
    body = (
      <div className="blk blk--over" data-over="">
        <SectionError
          what="scorecards"
          onRetry={() => {
            void all.refetch()
            void shown.refetch()
          }}
        />
      </div>
    )
  } else if (none) {
    body = <HowItWorks />
  } else if (!items || total === undefined) {
    body = (
      <div className="blk blk--over" data-over="" aria-busy="true">
        <SkeletonGroup label="Loading scorecards" hidden={!waiting}>
          {[0, 1].map((i) => (
            <Skeleton key={i} height={64} />
          ))}
        </SkeletonGroup>
      </div>
    )
  } else if (!items.length) {
    body = (
      <div className="blk blk--over" data-over="">
        <p className="cap mml-caption" aria-live="polite">
          {caption}
        </p>
        <EmptyState action={<Button onClick={() => setFilter('all')}>Show all mandates</Button>}>
          No {filter === 'inactive' ? 'inactive' : 'active'} mandates.
        </EmptyState>
      </div>
    )
  } else if (view === 'table') {
    body = (
      <div className="blk blk--over blk--flush mml-sheet" data-over="">
        <p className="tbl-caption" aria-live="polite">
          {caption}
        </p>
        <Refetch busy={shown.isFetching && shown.isPlaceholderData}>
          <MandatesTable items={items} pools={pools} now={now} />
        </Refetch>
      </div>
    )
  } else {
    body = (
      <div className="blk blk--over" data-over="">
        <p className="cap mml-caption" aria-live="polite">
          {caption}
        </p>
        <Refetch busy={shown.isFetching && shown.isPlaceholderData}>
          <MandateRows items={items} pools={pools} strips={!phone && items.length <= STRIP_LIMIT} />
        </Refetch>
      </div>
    )
  }

  return (
    <div className="mml">
      <title>Scorecards – Depthwatch</title>
      <section className="wrap ttl" aria-labelledby="mml-title">
        <p className="eyebrow eb-row" data-in="">
          <span>Scorecards</span> <span>Market makers on Base</span>
        </p>
        <div className="ttl-grid">
          <h1 className="title" id="mml-title" data-rise="">
            scorecards
          </h1>
          {answer !== null ? (
            <p className="answer" data-rise="">
              {answer}
            </p>
          ) : all.isError ? null : (
            <SkeletonGroup label="Loading the answer" hidden={!waiting} className="mml-skel-answer">
              <Skeleton height="1.08em" width="90%" />
              <Skeleton height="1.08em" width="60%" />
            </SkeletonGroup>
          )}
        </div>
      </section>
      <Band label="How scorecards work" className="mml-band">
        <div className="mml-lead-row">
          <p className="lead" data-in="">
            {SCORECARD_LEAD}
            {total === 0 && howToAdd ? (
              <>
                {' '}
                Mandates are added with <code>depthwatch mm register</code> or{' '}
                <code>POST /api/mm</code>.
              </>
            ) : null}
          </p>
          {total ? (
            <div className="mml-ctl" data-in="">
              <Link className="plink touch-hit" to="/methodology#scorecards">
                How scorecards work
              </Link>
              <SegmentedControl
                label="Mandates"
                options={FILTERS}
                value={filter}
                onChange={(f) => setFilter(f)}
                onBand
              />
              <SegmentedControl
                label="View"
                options={VIEWS}
                value={view}
                onChange={(v) => write('view', v === 'list' ? null : v)}
                onBand
              />
            </div>
          ) : null}
        </div>
      </Band>
      <Overlap label="Mandates">{body}</Overlap>
    </div>
  )
}
