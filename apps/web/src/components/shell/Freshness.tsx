/**
 * Data freshness (docs/design/visual-v4.md §5.1, ia-v3 §3.2): pushed to the right of the app bar,
 * an 8 px circle and the eyebrow "Block 53,069,244" in a 40 px button (the dot alone, as a 44 × 44
 * target, on phones). Never a square. Its popover gives the snapshot time, the block and "492 of
 * 580" pools tracked. The button's accessible name starts with its visible words ("Block
 * 53,069,244, updated 2 min ago"), so it can be called by what it shows. Live data from a server
 * has a Green dot. A published snapshot is not live, so its dot is grey, and, when its publisher
 * replaces it several times a day (the bundle's `updates`), Tan once the data is more than 8 hours
 * old on the reader's clock (`dataAge.ts`); its name and popover give the data's time and that
 * age, and the popover the publisher's schedule. When the API is unreachable it reads "Offline" with a Red triangle, and the
 * popover adds the error and Retry. Values swap with no animation and are not announced.
 */
import { useDataNow, useIsConnecting, useSnapshot } from '../../api/context.js'
import { errorText } from '../../api/errors.js'
import { useHealth } from '../../api/hooks.js'
import type { StaticSnapshot } from '../../api/static.js'
import type { HealthResponse } from '../../api/types.js'
import { ago, count, dated, full, group } from '../../lib/format.js'
import { Button } from '../ui/Button.js'
import { Popover } from '../ui/Popover.js'
import { ageText, isStale, UPDATE_CADENCE, useWallClock } from './dataAge.js'

function tracked(data: HealthResponse): string {
  return `${count(data.trackedCount)} of ${count(data.poolCount)}`
}

/** "Block 53,069,244, 492 of 580 pools tracked, 25 Oct 2026, 11:30 UTC" (the native tooltip). */
function summary(data: HealthResponse, at: number | null): string {
  return [
    data.latestBlock ? `Block ${group(data.latestBlock)}` : null,
    `${tracked(data)} pools tracked`,
    at === null ? null : dated(at),
  ]
    .filter(Boolean)
    .join(', ')
}

/** The button's visible words: "Block 53,069,244", or "No snapshot yet". */
function visibleText(data: HealthResponse): string {
  return data.latestBlock ? `Block ${group(data.latestBlock)}` : 'No snapshot yet'
}

/** The circle's class: Green for live data, grey for a snapshot, Tan for a late one. */
type Dot = 'live' | 'snapshot' | 'stale'

/** The trigger: the circle and the block as an eyebrow, or the words before any snapshot. */
function BlockTrigger({ data, dot }: { data: HealthResponse; dot: Dot }) {
  const tone = dot === 'live' ? '' : dot === 'stale' ? ' is-snapshot is-stale' : ' is-snapshot'
  return (
    <>
      <span className={`fresh-dot${tone}`} aria-hidden="true" />
      <span className={data.latestBlock ? 'eyebrow fresh-text' : 'fresh-text'}>
        {visibleText(data)}
      </span>
    </>
  )
}

/**
 * The freshness of a published snapshot: the data's time and its age on the reader's clock, a grey
 * dot, and a Tan one past `STALE_AFTER_S` when its publisher states a schedule (`updates`).
 */
function SnapshotFreshness({ data, snapshot }: { data: HealthResponse; snapshot: StaticSnapshot }) {
  const { at, exportedAt } = snapshot
  const scheduled = snapshot.updates !== null
  const now = useWallClock()
  const since = ageText(now - at)
  return (
    <Popover
      label="Data freshness"
      triggerClassName="fresh"
      triggerLabel={`${visibleText(data)}, data from ${dated(at)}, ${since}`}
      triggerTitle={summary(data, at)}
      trigger={
        <BlockTrigger data={data} dot={scheduled && isStale(at, now) ? 'stale' : 'snapshot'} />
      }
    >
      <p className="eyebrow">Snapshot</p>
      <dl className="pop-dl">
        <div>
          <dt>Data from</dt>
          <dd>{`${dated(at)}, ${since}`}</dd>
        </div>
        <div>
          <dt>Block</dt>
          <dd className="mono">{group(data.latestBlock)}</dd>
        </div>
        <div>
          <dt>Pools tracked</dt>
          <dd>{tracked(data)}</dd>
        </div>
        <div>
          <dt>Exported</dt>
          <dd>{dated(exportedAt)}</dd>
        </div>
      </dl>
      <p className="small t2">
        {scheduled
          ? `${UPDATE_CADENCE} This page keeps the data it loaded: reload it to get the latest.`
          : 'This copy keeps the data it was exported with.'}
      </p>
    </Popover>
  )
}

export function Freshness() {
  const health = useHealth()
  const now = useDataNow()
  const snapshot = useSnapshot()
  const connecting = useIsConnecting()
  const data = health.data
  const offline = health.isError || (data !== undefined && !data.ok)

  // Booting on a slow API: the slot says so in words, with no status dot.
  if (!data && !health.isError && connecting)
    return <span className="fresh is-connecting">Connecting…</span>
  if (!data && !health.isError) return <span className="fresh" aria-hidden="true" />

  if (snapshot && data && !offline) return <SnapshotFreshness data={data} snapshot={snapshot} />

  if (offline) {
    const reason = health.isError
      ? errorText(health.error)
      : (data?.error ?? 'The API reports a problem.')
    return (
      <Popover
        label="Data freshness"
        triggerClassName="fresh is-offline"
        triggerLabel="Offline: data freshness"
        trigger={
          <>
            <svg className="fresh-off" viewBox="0 0 8 8" aria-hidden="true">
              <path d="M4 .5L7.8 7.5H.2z" fill="currentColor" />
            </svg>
            <span className="fresh-text">Offline</span>
          </>
        }
      >
        <p>Unable to reach the API: {reason}</p>
        <div className="pop-actions">
          <Button onClick={() => void health.refetch()} loading={health.isFetching}>
            Retry
          </Button>
        </div>
      </Popover>
    )
  }

  if (!data) return null
  const at = data.latestSnapshotAt
  const updated = at === null ? 'No snapshot yet' : ago(at, now)
  return (
    <Popover
      label="Data freshness"
      triggerClassName="fresh"
      triggerLabel={at === null ? visibleText(data) : `${visibleText(data)}, updated ${updated}`}
      triggerTitle={summary(data, at)}
      trigger={<BlockTrigger data={data} dot="live" />}
    >
      <dl className="pop-dl">
        <div>
          <dt>Updated</dt>
          <dd>{updated}</dd>
        </div>
        <div>
          <dt>Block</dt>
          <dd className="mono">{group(data.latestBlock)}</dd>
        </div>
        <div>
          <dt>Pools tracked</dt>
          <dd>{tracked(data)}</dd>
        </div>
        <div>
          <dt>Snapshot</dt>
          <dd>{full(at)}</dd>
        </div>
      </dl>
    </Popover>
  )
}
