/**
 * The snapshot line (docs/design/visual-v4.md §5.1, web-v2.md §4): in the demo line's slot, at the
 * top of the banner landmark, a static build of a `live` bundle says when its data was read (UTC,
 * with the year, since it may be read much later), how long ago that is on the reader's clock
 * (`dataAge.ts`) and, when its publisher states one (`updates`), how often the site is updated.
 * Below 840 px a shorter sentence keeps it on one line without the year: with the schedule it
 * drops the day, then below 440 px the clock time, and below 375 px the schedule instead (the
 * popovers keep all of it); without, it drops the day below 360 px. "About this snapshot" opens
 * the exporter's note (`depthwatch export --note`) with the block and the export time. While the
 * static build is still loading its data, an empty line of the same height holds the slot, so
 * nothing below it moves when the text arrives.
 */
import type { StaticSnapshot } from '../../api/static.js'
import { clockTime, dated, day, group, NB } from '../../lib/format.js'
import { Popover } from '../ui/Popover.js'
import { ageText, UPDATE_CADENCE, UPDATE_CLAUSE, useWallClock } from './dataAge.js'

/** Shown in the popover when the bundle was exported without `--note`. */
export const DEFAULT_SNAPSHOT_NOTE =
  'Every number was read from Base mainnet by the Depthwatch pipeline and exported to this static copy.'

/** The note's paragraphs: a blank line separates two. */
export function noteParagraphs(note: string): string[] {
  return note
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

/** "Read at block 53,063,332. Exported 25 Oct 2026, 08:16 UTC." (no block before any snapshot). */
export function snapshotFacts(snapshot: StaticSnapshot): string {
  const exported = `Exported ${dated(snapshot.exportedAt)}.`
  return snapshot.block === null ? exported : `Read at block ${group(snapshot.block)}. ${exported}`
}

/** The slot of the data line while the static build loads its bundle: no words, same height. */
export function DataLinePlaceholder() {
  return (
    <div className="demo-line" aria-hidden="true">
      <div className="wrap demo-inner" />
    </div>
  )
}

/** The sentence below 840 px; shell.css hides its parts by width. */
function NarrowText({ snapshot, since }: { snapshot: StaticSnapshot; since: string }) {
  const clock = `${clockTime(snapshot.at)}${NB}UTC, `
  if (snapshot.updates === null)
    return (
      <span className="snap-narrow">
        Data from <span className="snap-day">{`${day(snapshot.at)}, `}</span>
        {clock}
        {since}
      </span>
    )
  return (
    <span className="snap-narrow">
      Data from <span className="snap-clock">{clock}</span>
      {since}
      <span className="snap-often">{`, ${UPDATE_CLAUSE}`}</span>
    </span>
  )
}

export function SnapshotLine({ snapshot }: { snapshot: StaticSnapshot }) {
  const since = ageText(useWallClock() - snapshot.at)
  const paragraphs =
    snapshot.note === null ? [DEFAULT_SNAPSHOT_NOTE] : noteParagraphs(snapshot.note)
  return (
    <div className="demo-line" role="note" aria-label="Data source">
      <div className="wrap demo-inner">
        <span className="snap-text">
          <span className="snap-wide">
            {`Data from ${dated(snapshot.at)}, ${since}.`}
            {snapshot.updates === null ? null : ` ${UPDATE_CADENCE}`}
          </span>
          <NarrowText snapshot={snapshot} since={since} />
        </span>
        <Popover
          label="About this snapshot"
          triggerLabel="About this snapshot"
          trigger={
            <>
              About<span className="snap-more"> this snapshot</span>
            </>
          }
          triggerClassName="quiet-link touch-hit"
          className="pop-note"
        >
          {paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p className="pop-meta">{snapshotFacts(snapshot)}</p>
        </Popover>
      </div>
    </div>
  )
}
