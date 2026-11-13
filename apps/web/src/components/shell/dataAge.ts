/**
 * How old a published snapshot is on the reader's own clock (docs/design/visual-v4.md §5.1). The
 * data's time is fixed, but how long after the export a page is opened, or how long it stays open,
 * is not: the age is counted from the device clock, read again every minute and whenever the tab
 * comes back into view, so it never goes stale on screen. Every other time on the pages stays
 * absolute (`SNAPSHOT_CLOCK`).
 */
import { useEffect, useState } from 'react'
import { NB } from '../../lib/format.js'

/**
 * Past this age a snapshot whose publisher replaces it several times a day (the bundle's
 * `updates`) is late: its freshness dot turns Tan. A copy that states no schedule is never late.
 */
export const STALE_AFTER_S = 8 * 3600

/**
 * The publisher's schedule (the bundle's `updates`, `depthwatch export --updates`), in the
 * snapshot line and the freshness popover: as a sentence, and as the clause of the line's shorter
 * sentence. A copy exported without it states no schedule.
 */
export const UPDATE_CADENCE = 'Updated several times a day.'
export const UPDATE_CLAUSE = 'updated several times a day'

/** "1 min ago", "5 h ago" under 48 h, then "3 d ago"; whole units, rounded down. */
export function ageText(seconds: number): string {
  const s = Math.max(0, seconds)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}${NB}min ago`
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}${NB}h ago`
  return `${Math.floor(s / 86_400)}${NB}d ago`
}

/** Whether data read at `at` is older than `STALE_AFTER_S` at `now` (unix seconds). */
export function isStale(at: number, now: number): boolean {
  return now - at > STALE_AFTER_S
}

/** The reader's clock in unix seconds, read again every minute and when the tab is shown again. */
export function useWallClock(): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const tick = () => setNow(Date.now() / 1000)
    const timer = window.setInterval(tick, 60_000)
    const onShow = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [])
  return now
}
