import { describe, expect, it } from 'vitest'
import {
  NEW_YORK_EDT_OFFSET_SECONDS as EDT,
  NEW_YORK_EST_OFFSET_SECONDS as EST,
  newYorkOffsetSeconds,
  weeklyCloseAt,
} from './hours.js'

const HOUR = 3_600
/** Unix seconds of an ISO time in UTC. */
const utc = (iso: string): number => Date.parse(iso) / 1000

/** New York's clock at a Unix time, from the platform's time-zone data. */
const newYork = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'shortOffset',
})

function clock(t: number): { weekday: string; hms: string; offset: string } {
  const parts = Object.fromEntries(
    newYork.formatToParts(new Date(t * 1000)).map((p) => [p.type, p.value]),
  )
  return {
    weekday: parts.weekday ?? '',
    hms: `${parts.hour}:${parts.minute}:${parts.second}`,
    offset: parts.timeZoneName ?? '',
  }
}

/** In `[Friday 20:00, Sunday 20:00)` on New York's clock, read from `Intl`. */
function inCloseByIntl(t: number): boolean {
  const { weekday, hms } = clock(t)
  return (
    (weekday === 'Fri' && hms >= '20:00:00') ||
    weekday === 'Sat' ||
    (weekday === 'Sun' && hms < '20:00:00')
  )
}

describe('newYorkOffsetSeconds: the US daylight-saving rule', () => {
  it('changes at the second Sunday of March 07:00 UTC and the first Sunday of November 06:00 UTC', () => {
    for (const [change, before, after] of [
      ['2026-03-08T07:00:00Z', EST, EDT],
      ['2026-11-01T06:00:00Z', EDT, EST],
      ['2027-03-14T07:00:00Z', EST, EDT],
      ['2027-11-07T06:00:00Z', EDT, EST],
    ] as const) {
      expect(newYorkOffsetSeconds(utc(change) - 1)).toBe(before)
      expect(newYorkOffsetSeconds(utc(change))).toBe(after)
    }
    expect(newYorkOffsetSeconds(utc('2026-01-01T00:00:00Z'))).toBe(EST)
    expect(newYorkOffsetSeconds(utc('2026-07-04T12:00:00Z'))).toBe(EDT)
    expect(newYorkOffsetSeconds(utc('2027-12-31T23:59:59Z'))).toBe(EST)
  })
})

describe('weeklyCloseAt: [Friday 20:00, Sunday 20:00) America/New_York', () => {
  it('a summer close: Saturday 00:00 to Monday 00:00 UTC, 48 h, both sides of each edge', () => {
    const close = { start: utc('2026-07-11T00:00:00Z'), end: utc('2026-07-13T00:00:00Z') }
    expect(weeklyCloseAt(close.start - 1)).toBeNull() // Friday 19:59:59 EDT
    expect(weeklyCloseAt(close.start)).toEqual(close)
    expect(weeklyCloseAt(utc('2026-07-12T12:00:00Z'))).toEqual(close)
    expect(weeklyCloseAt(close.end - 1)).toEqual(close) // Sunday 19:59:59 EDT
    expect(weeklyCloseAt(close.end)).toBeNull()
    expect(close.end - close.start).toBe(48 * HOUR)
  })

  it('a winter close: Saturday 01:00 to Monday 01:00 UTC, 48 h', () => {
    const close = { start: utc('2027-01-09T01:00:00Z'), end: utc('2027-01-11T01:00:00Z') }
    expect(weeklyCloseAt(close.start - 1)).toBeNull()
    expect(weeklyCloseAt(utc('2027-01-09T00:30:00Z'))).toBeNull() // Friday 19:30 EST
    expect(weeklyCloseAt(close.start)).toEqual(close)
    expect(weeklyCloseAt(utc('2027-01-11T00:30:00Z'))).toEqual(close) // Sunday 19:30 EST
    expect(weeklyCloseAt(close.end - 1)).toEqual(close)
    expect(weeklyCloseAt(close.end)).toBeNull()
  })

  it('49 h across the end of daylight time on 2026-11-01, the repeated hour inside', () => {
    const close = { start: utc('2026-10-31T00:00:00Z'), end: utc('2026-11-02T01:00:00Z') }
    expect(close.end - close.start).toBe(49 * HOUR)
    expect(weeklyCloseAt(close.start - 1)).toBeNull() // Friday 2026-10-30 19:59:59 EDT
    expect(weeklyCloseAt(close.start)).toEqual(close)
    expect(weeklyCloseAt(utc('2026-11-01T05:30:00Z'))).toEqual(close) // 01:30 EDT
    expect(weeklyCloseAt(utc('2026-11-01T06:30:00Z'))).toEqual(close) // 01:30 EST, again
    expect(weeklyCloseAt(utc('2026-11-02T00:00:00Z'))).toEqual(close) // Sunday 19:00 EST
    expect(weeklyCloseAt(close.end - 1)).toEqual(close)
    expect(weeklyCloseAt(close.end)).toBeNull()
  })

  it('47 h across the start of daylight time on 2027-03-14, the skipped hour inside', () => {
    const close = { start: utc('2027-03-13T01:00:00Z'), end: utc('2027-03-15T00:00:00Z') }
    expect(close.end - close.start).toBe(47 * HOUR)
    expect(weeklyCloseAt(utc('2027-03-13T00:59:59Z'))).toBeNull() // Friday 19:59:59 EST
    expect(weeklyCloseAt(close.start)).toEqual(close)
    expect(weeklyCloseAt(utc('2027-03-14T06:59:59Z'))).toEqual(close) // 01:59:59 EST
    expect(weeklyCloseAt(utc('2027-03-14T07:00:00Z'))).toEqual(close) // 03:00:00 EDT
    expect(weeklyCloseAt(close.end - 1)).toEqual(close) // Sunday 19:59:59 EDT
    expect(weeklyCloseAt(close.end)).toBeNull()
    expect(weeklyCloseAt(utc('2027-03-15T00:30:00Z'))).toBeNull() // Sunday 20:30 EDT
  })

  it('is null on weekdays and for a time that is not finite', () => {
    expect(weeklyCloseAt(utc('2026-11-04T15:00:00Z'))).toBeNull() // Wednesday
    expect(weeklyCloseAt(utc('2026-11-06T23:59:59Z'))).toBeNull() // Friday 18:59:59 EST
    expect(weeklyCloseAt(utc('2026-11-03T03:00:00Z'))).toBeNull() // Monday 22:00 EST
    expect(weeklyCloseAt(Number.NaN)).toBeNull()
    expect(weeklyCloseAt(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('agrees with Intl.DateTimeFormat (America/New_York) every 5 minutes over 2026 and 2027', () => {
    const from = utc('2026-01-01T00:00:00Z')
    const to = utc('2028-01-01T00:00:00Z')
    const mismatches: number[] = []
    const starts = new Set<number>()
    for (let t = from; t < to; t += 300) {
      const close = weeklyCloseAt(t)
      if ((close !== null) !== inCloseByIntl(t)) mismatches.push(t)
      const offset = newYorkOffsetSeconds(t) === EDT ? 'GMT-4' : 'GMT-5'
      if (offset !== clock(t).offset) mismatches.push(t)
      if (close !== null) {
        if (!(close.start <= t && t < close.end)) mismatches.push(t)
        starts.add(close.start)
      }
    }
    expect(mismatches).toEqual([])
    // One close a week, each opening and closing at 20:00 New York time.
    expect(starts.size).toBe(104)
    for (const start of starts) {
      const close = weeklyCloseAt(start)
      if (close === null) throw new Error('no close at its own start')
      expect(clock(close.start)).toMatchObject({ weekday: 'Fri', hms: '20:00:00' })
      expect(clock(close.end)).toMatchObject({ weekday: 'Sun', hms: '20:00:00' })
      expect(clock(close.start - 1)).toMatchObject({ weekday: 'Fri', hms: '19:59:59' })
      expect([47, 48, 49]).toContain((close.end - close.start) / HOUR)
    }
    const lengths = [...starts].map((s) => {
      const close = weeklyCloseAt(s)
      return close === null ? 0 : (close.end - close.start) / HOUR
    })
    // 2026: 49 h on 2026-11-01, 47 h on 2026-03-08; 2027: 47 h on 2027-03-14, 49 h on 2027-11-07.
    expect(lengths.filter((h) => h === 47)).toHaveLength(2)
    expect(lengths.filter((h) => h === 49)).toHaveLength(2)
  })
})
