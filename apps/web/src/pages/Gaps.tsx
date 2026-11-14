/**
 * `/gaps` (ia-v3 §4.4, docs/design/visual-v4.md §6.5): where demand outruns depth, the pools where
 * market makers are missing. The title section (eyebrow, the lowercase title "gaps" and the answer
 * "48 pools trade 3× their depth or more every day." at its right), then the band with the lead,
 * which states the volume floor, "How the score works" and the List / Table control. The focal
 * ranked gap rows sit in a block over the band's lower edge: 20 rows, "Show all 48" and the rows
 * under 3× behind one disclosure; the table view puts every v2 column in a table sheet instead.
 * Both read the whole feed (every page of it) and the answer counts the API's `meaningful`, so
 * neither stops at a page. `view`, `sort`, `dir` and `rows` live in the URL, replaced, not pushed.
 */
import { GAP_FEED_MIN_VOLUME_USD } from '@depthwatch/core'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Band } from '../components/ui/Band.js'
import { Overlap } from '../components/ui/Block.js'
import { SegmentedControl } from '../components/ui/SegmentedControl.js'
import { EmptyState, SectionError, useDelayedPending } from '../components/ui/States.js'
import { NB, usd } from '../lib/format.js'
import { useGapFeed } from '../lib/useGapFeed.js'
import { GapRows } from './lists/GapRows.js'
import { GapsTable } from './lists/GapsTable.js'
import {
  type GapsState,
  type GapsView,
  gapsAnswer,
  readGapsState,
  writeGapsState,
} from './lists/gapsModel.js'
import { AnswerSkeleton, RowsSkeleton } from './lists/ListSkeleton.js'
import './lists/lists.css'

const VIEWS: ReadonlyArray<{ value: GapsView; label: string }> = [
  { value: 'list', label: 'List' },
  { value: 'table', label: 'Table' },
]

export function Gaps() {
  const [params, setParams] = useSearchParams()
  const state = readGapsState(params)
  const update = (patch: Partial<GapsState>) =>
    setParams((prev) => writeGapsState(prev, patch), { replace: true })
  const gaps = useGapFeed()
  const waiting = !useDelayedPending(gaps.isPending)
  const items = gaps.items
  const meaningful = gaps.data?.meaningful
  const table = state.view === 'table'

  let body: ReactNode
  if (items && gaps.data) {
    if (items.length === 0) {
      body = (
        <EmptyState>
          No pool has {usd(gaps.data.minVolumeUsd)} of 24{NB}h volume yet, so none can be ranked.
        </EmptyState>
      )
    } else if (table) {
      body = (
        <GapsTable
          items={items}
          sort={state.sort}
          dir={state.dir}
          onSort={(key) =>
            update(
              key === state.sort
                ? { dir: state.dir === 'desc' ? 'asc' : 'desc' }
                : { sort: key, dir: 'desc' },
            )
          }
        />
      )
    } else {
      body = (
        <GapRows
          items={items}
          allRows={state.allRows}
          onShowAll={() => update({ allRows: true })}
        />
      )
    }
  } else if (gaps.isError) {
    body = <SectionError what="gaps" onRetry={gaps.refetch} />
  } else {
    body = <RowsSkeleton waiting={waiting} rows={6} label="Loading gaps" header={false} />
  }
  const sheet = table && items && items.length > 0

  return (
    <div className="lists-gaps">
      <title>Liquidity gaps – Depthwatch</title>
      <section className="wrap ttl" aria-labelledby="gaps-title">
        <p className="eyebrow eb-row" data-in>
          <span>Liquidity gaps</span>
          <span>Volume against depth</span>
        </p>
        <div className="ttl-grid">
          <h1 className="title" id="gaps-title" data-rise>
            gaps
          </h1>
          {meaningful !== undefined ? (
            <p className="answer" data-rise>
              {gapsAnswer(meaningful)}
            </p>
          ) : gaps.isError ? null : (
            <AnswerSkeleton waiting={waiting} lines={2} />
          )}
        </div>
      </section>
      <Band label="What a gap is" className="lists-gaps-band">
        <div className="lists-gaps-lead">
          <p className="lead" data-in>
            A gap is a pool that trades far more each day than the liquidity near its price.{' '}
            {/* The feed's floor is core's until the data names it, so the line never reflows. */}
            Pools with at least {usd(gaps.data?.minVolumeUsd ?? GAP_FEED_MIN_VOLUME_USD)} of 24
            {NB}h volume.
          </p>
          <div className="lists-gaps-ctl" data-in>
            <Link className="plink touch-hit" to="/methodology#gaps">
              How the score works
            </Link>
            <SegmentedControl<GapsView>
              label="View"
              options={VIEWS}
              value={state.view}
              onChange={(view) => update({ view })}
              onBand
            />
          </div>
        </div>
      </Band>
      <Overlap label="Ranked gaps">
        <div
          className={`blk blk--over lists-gaps-blk${sheet ? ' blk--flush is-table' : ''}`}
          data-over=""
        >
          {body}
        </div>
      </Overlap>
    </div>
  )
}
