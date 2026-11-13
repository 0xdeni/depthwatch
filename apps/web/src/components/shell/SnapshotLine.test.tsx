/**
 * The shell over a published live snapshot (docs/design/web-v2.md §4, visual-v4.md §5.1): the
 * snapshot line at the top of the banner, with the data's time, its age on the reader's clock and
 * how often the site is updated, at every width; freshness named by its block, then the data's
 * time and age, with a grey dot that turns Tan past 8 hours; the footer's source; no "… ago" in
 * the pages themselves; and, while the static build loads, an empty line in the same place. A
 * copy exported without a schedule states none and is never late. Without a snapshot the demo and
 * live shells stay as they were.
 */
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../../App.js'
import { createMockClient } from '../../api/mock.js'
import { createPendingClient } from '../../api/pending.js'
import type { StaticSnapshot } from '../../api/static.js'
import { ageText, isStale, STALE_AFTER_S, UPDATE_CADENCE, UPDATE_CLAUSE } from './dataAge.js'
import { DEFAULT_SNAPSHOT_NOTE, noteParagraphs, snapshotFacts } from './SnapshotLine.js'

const NOW = 1_760_000_000
const NB = '\u00a0'
const SNAPSHOT: StaticSnapshot = {
  // 9 Oct 2025, 08:40 UTC; exported 20 minutes later.
  at: NOW - 800,
  exportedAt: NOW + 400,
  block: '53063332',
  note: 'The 492 largest pools by TVL.\n\n  Volume covers the last 24 h.  ',
  updates: 'several-times-a-day',
}
/** The same copy, exported once without a schedule. */
const ONCE: StaticSnapshot = { ...SNAPSHOT, updates: null }
const AT = `9${NB}Oct${NB}2025, 08:40${NB}UTC`

/** Sets the reader's clock `hours` (and two minutes) after the snapshot was read. */
function readerClock(hours: number) {
  vi.setSystemTime((SNAPSHOT.at + hours * 3600 + 120) * 1000)
}

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  vi.useFakeTimers({ toFake: ['Date'] })
  readerClock(5)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderAt(
  path: string,
  opts: { snapshot?: StaticSnapshot; demo?: boolean; connecting?: boolean } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const client = createMockClient({ now: NOW })
  return render(
    <Providers
      client={opts.connecting ? createPendingClient(new Promise(() => {})) : client}
      mock={false}
      demo={opts.demo}
      dataNow={opts.demo ? NOW : undefined}
      snapshot={opts.snapshot}
      connecting={opts.connecting}
      staticBuild
      queryClient={queryClient}
    >
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('snapshot line', () => {
  it('gives the data’s UTC time, its age and how often the site is updated, in the banner', () => {
    renderAt('/methodology', { snapshot: SNAPSHOT })
    const line = screen.getByRole('note', { name: 'Data source' })
    expect(line.closest('header')).toBe(screen.getByRole('banner'))
    expect(line.querySelector('.snap-wide')?.textContent).toBe(
      `Data from ${AT}, 5${NB}h ago. Updated several times a day.`,
    )
    // Below 840 px the shorter sentence shows, and the link reads "About"; it keeps the schedule
    // down to 375 px, giving up the clock time for it below 440 px (shell.css).
    const narrow = line.querySelector('.snap-narrow')
    expect(narrow?.textContent).toBe(
      `Data from 08:40${NB}UTC, 5${NB}h ago, updated several times a day`,
    )
    expect(narrow?.querySelector('.snap-clock')?.textContent).toBe(`08:40${NB}UTC, `)
    expect(narrow?.querySelector('.snap-often')?.textContent).toBe(`, ${UPDATE_CLAUSE}`)
    expect(narrow?.querySelector('.snap-day')).toBeNull()
    expect(`${UPDATE_CLAUSE[0]?.toUpperCase()}${UPDATE_CLAUSE.slice(1)}.`).toBe(UPDATE_CADENCE)
    expect(line.textContent).not.toMatch(/every 3|three hours|not live/i)
    const about = within(line).getByRole('button', { name: 'About this snapshot' })
    expect(about.className).toBe('quiet-link touch-hit')
    expect(about.querySelector('.snap-more')?.textContent).toBe(' this snapshot')
    expect(line.textContent).not.toMatch(/demo|mock/i)
  })

  it('states no schedule for a copy exported without one, and drops its day below 360 px', () => {
    renderAt('/methodology', { snapshot: ONCE })
    const line = screen.getByRole('note', { name: 'Data source' })
    expect(line.querySelector('.snap-wide')?.textContent).toBe(`Data from ${AT}, 5${NB}h ago.`)
    expect(line.querySelector('.snap-narrow')?.textContent).toBe(
      `Data from 9${NB}Oct, 08:40${NB}UTC, 5${NB}h ago`,
    )
    expect(line.querySelector('.snap-day')?.textContent).toBe(`9${NB}Oct, `)
    expect(line.textContent).not.toMatch(/updated|several/i)
  })

  it('keeps the age current on the reader’s clock', async () => {
    renderAt('/methodology', { snapshot: SNAPSHOT })
    const wide = () => document.querySelector('.snap-wide')?.textContent
    expect(wide()).toContain(`5${NB}h ago`)
    readerClock(30)
    // Coming back to the tab reads the clock again (so does the minute timer).
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(wide()).toContain(`30${NB}h ago`)
    expect(ageText(30)).toBe(`1${NB}min ago`)
    expect(ageText(59 * 60)).toBe(`59${NB}min ago`)
    expect(ageText(47 * 3600 + 3599)).toBe(`47${NB}h ago`)
    expect(ageText(3 * 86_400 + 5)).toBe(`3${NB}d ago`)
    expect(ageText(-60)).toBe(`1${NB}min ago`)
    expect(UPDATE_CADENCE).toBe('Updated several times a day.')
  })

  it('holds its place with an empty line while the static build loads its data', () => {
    renderAt('/methodology', { connecting: true })
    const banner = screen.getByRole('banner')
    const line = banner.firstElementChild as HTMLElement
    expect(line.className).toBe('demo-line')
    expect(line.getAttribute('aria-hidden')).toBe('true')
    expect(line.textContent).toBe('')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('opens the note in paragraphs with the block and the export time', () => {
    renderAt('/methodology', { snapshot: SNAPSHOT })
    fireEvent.click(screen.getByRole('button', { name: 'About this snapshot' }), { detail: 1 })
    const pop = screen.getByRole('dialog', { name: 'About this snapshot' })
    expect([...pop.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'The 492 largest pools by TVL.',
      'Volume covers the last 24 h.',
      `Read at block 53,063,332. Exported 9${NB}Oct${NB}2025, 09:00${NB}UTC.`,
    ])
  })

  it('explains the copy without a note, and leaves out an unknown block', () => {
    expect(noteParagraphs('a\n\n\n b \n\n')).toEqual(['a', 'b'])
    expect(snapshotFacts({ ...SNAPSHOT, block: null })).toBe(
      `Exported 9${NB}Oct${NB}2025, 09:00${NB}UTC.`,
    )
    renderAt('/methodology', { snapshot: { ...SNAPSHOT, note: null } })
    fireEvent.click(screen.getByRole('button', { name: 'About this snapshot' }), { detail: 1 })
    const pop = screen.getByRole('dialog', { name: 'About this snapshot' })
    expect(pop.querySelector('p')?.textContent).toBe(DEFAULT_SNAPSHOT_NOTE)
  })
})

describe('freshness and footer of a snapshot', () => {
  it('shows a grey circle and the block, named by its words, the data’s time and its age', async () => {
    renderAt('/methodology', { snapshot: SNAPSHOT })
    const fresh = await screen.findByRole('button', { name: /^Block [\d,]+, data from / })
    expect(fresh.textContent).toMatch(/^Block \d{1,3}(,\d{3})+$/)
    expect(fresh.getAttribute('aria-label')).toBe(
      `${fresh.textContent}, data from ${AT}, 5${NB}h ago`,
    )
    expect(fresh.querySelector('.fresh-dot')?.className).toBe('fresh-dot is-snapshot')
    expect(fresh.getAttribute('title')).toMatch(/^Block [\d,]+, [\d,]+ of [\d,]+ pools tracked, /)
    fireEvent.click(fresh, { detail: 0 })
    const pop = screen.getByRole('dialog', { name: 'Data freshness' })
    expect([...pop.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Data from',
      'Block',
      'Pools tracked',
      'Exported',
    ])
    expect([...pop.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
      `${AT}, 5${NB}h ago`,
      expect.stringMatching(/^\d{1,3}(,\d{3})+$/),
      expect.stringMatching(/^[\d,]+ of [\d,]+$/),
      `9${NB}Oct${NB}2025, 09:00${NB}UTC`,
    ])
    expect(pop.textContent).toContain(UPDATE_CADENCE)
    expect(
      within(screen.getByRole('contentinfo')).getByText('Data: a Base mainnet snapshot'),
    ).toBeTruthy()
  })

  it('turns the dot Tan once the data is more than 8 hours old', async () => {
    readerClock(9)
    renderAt('/methodology', { snapshot: SNAPSHOT })
    const fresh = await screen.findByRole('button', { name: /^Block [\d,]+, data from / })
    expect(fresh.querySelector('.fresh-dot')?.className).toBe('fresh-dot is-snapshot is-stale')
    expect(fresh.getAttribute('aria-label')).toMatch(new RegExp(`9${NB}h ago$`))
    expect(isStale(SNAPSHOT.at, SNAPSHOT.at + STALE_AFTER_S)).toBe(false)
    expect(isStale(SNAPSHOT.at, SNAPSHOT.at + STALE_AFTER_S + 1)).toBe(true)
  })

  it('keeps a copy without a schedule grey however old, and claims none in the popover', async () => {
    readerClock(30)
    renderAt('/methodology', { snapshot: ONCE })
    const fresh = await screen.findByRole('button', { name: /^Block [\d,]+, data from / })
    expect(fresh.querySelector('.fresh-dot')?.className).toBe('fresh-dot is-snapshot')
    fireEvent.click(fresh, { detail: 0 })
    const pop = screen.getByRole('dialog', { name: 'Data freshness' })
    expect(pop.textContent).not.toContain(UPDATE_CADENCE)
    expect(pop.querySelector('p.small')?.textContent).toBe(
      'This copy keeps the data it was exported with.',
    )
  })

  it('dates the pools caption, with its year, instead of aging it', async () => {
    renderAt('/pools', { snapshot: SNAPSHOT })
    await screen.findByRole('table', { name: 'Pools' })
    const main = screen.getByRole('main')
    expect(main.textContent).toMatch(/[Uu]pdated \d+\u00a0\w{3}\u00a0\d{4}, \d\d:\d\d\u00a0UTC/)
    expect(main.textContent).not.toMatch(/\bago\b/)
  })

  it('keeps the demo shell unchanged when there is no snapshot', async () => {
    renderAt('/methodology', { demo: true })
    expect(screen.getByRole('note', { name: 'Data source' }).textContent).toMatch(
      /^Demo data: a synthetic week of Base/,
    )
    expect(document.querySelector('.snap-text')).toBeNull()
    expect(
      await screen.findByRole('button', { name: /^Block [\d,]+, updated 1\u00a0min ago$/ }),
    ).toBeTruthy()
    expect(
      within(screen.getByRole('contentinfo')).getByText('Data: a synthetic demo world'),
    ).toBeTruthy()
  })
})
