/**
 * The weekly close of a 24/5 stock feed (docs/METRICS.md, "Off-hours"): `[Friday 20:00, Sunday
 * 20:00)` America/New_York, a fixed rule in pure code rather than a maintained calendar (holidays
 * fall to the age part of the held rule).
 *
 * New York is on UTC−4 from the second Sunday of March at 07:00 UTC to the first Sunday of November
 * at 06:00 UTC and on UTC−5 otherwise (the US daylight-saving rule since 2007), so no time-zone data
 * is needed: a close begins at Saturday 00:00 or 01:00 UTC and lasts 48 h, 49 h across November's
 * change and 47 h across March's. Every time is Unix seconds.
 */

const HOUR = 3_600
const DAY = 86_400

/** New York's offset from UTC in seconds while on daylight time (EDT, UTC−4). */
export const NEW_YORK_EDT_OFFSET_SECONDS = -4 * HOUR
/** New York's offset from UTC in seconds while on standard time (EST, UTC−5). */
export const NEW_YORK_EST_OFFSET_SECONDS = -5 * HOUR

/** 0 = Sunday … 6 = Saturday for a day count since 1970-01-01, a Thursday. */
function weekdayOfDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7
}

/** Unix seconds of 00:00 UTC on the n-th Sunday (1-based) of a month (0-based) of a year. */
function nthSundayUtc(year: number, month: number, n: number): number {
  const firstDay = Date.UTC(year, month, 1) / 1000 / DAY
  const toSunday = (7 - weekdayOfDay(firstDay)) % 7
  return (firstDay + toSunday + (n - 1) * 7) * DAY
}

/**
 * New York's offset from UTC at `timestamp`: `NEW_YORK_EDT_OFFSET_SECONDS` from the second Sunday
 * of March at 07:00 UTC to the first Sunday of November at 06:00 UTC, else
 * `NEW_YORK_EST_OFFSET_SECONDS`.
 */
export function newYorkOffsetSeconds(timestamp: number): number {
  const year = new Date(timestamp * 1000).getUTCFullYear()
  const daylightFrom = nthSundayUtc(year, 2, 2) + 7 * HOUR
  const daylightTo = nthSundayUtc(year, 10, 1) + 6 * HOUR
  return timestamp >= daylightFrom && timestamp < daylightTo
    ? NEW_YORK_EDT_OFFSET_SECONDS
    : NEW_YORK_EST_OFFSET_SECONDS
}

/**
 * The UTC instant of a New York wall-clock time (seconds since 1970-01-01 00:00 on New York's
 * clock). Only for times the clock neither skips nor repeats, as 20:00 never is.
 */
function wallToUtc(wall: number): number {
  const daylight = wall - NEW_YORK_EDT_OFFSET_SECONDS
  return newYorkOffsetSeconds(daylight) === NEW_YORK_EDT_OFFSET_SECONDS
    ? daylight
    : wall - NEW_YORK_EST_OFFSET_SECONDS
}

/** A weekly close: `start ≤ t < end`, Unix seconds. */
export interface WeeklyClose {
  /** Friday 20:00 New York time. */
  start: number
  /** The Sunday after, 20:00 New York time. */
  end: number
}

/**
 * The weekly close holding `timestamp`, `[Friday 20:00, Sunday 20:00)` on New York's clock, or null
 * when `timestamp` lies outside every close (or is not finite).
 */
export function weeklyCloseAt(timestamp: number): WeeklyClose | null {
  if (!Number.isFinite(timestamp)) return null
  const wall = timestamp + newYorkOffsetSeconds(timestamp)
  const day = Math.floor(wall / DAY)
  // Days since the Friday that opens this week's close: Friday 0, Saturday 1, Sunday 2, … Thursday 6.
  const sinceFriday = (weekdayOfDay(day) + 2) % 7
  const opens = (day - sinceFriday) * DAY + 20 * HOUR
  const intoClose = wall - opens
  if (intoClose < 0 || intoClose >= 2 * DAY) return null
  return { start: wallToUtc(opens), end: wallToUtc(opens + 2 * DAY) }
}
