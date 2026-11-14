/**
 * Methodology (ia-v3 §4.8, docs/design/visual-v4.md §6.9): the title "method" and the provenance
 * answer, the band's lead, the seven metric blocks (the first three over the band) that jump to
 * their sections, one anchored section per metric with its formula behind "Show formula", the
 * schematics, "On this page" (disclosure below 1200 px, sticky list from 1200 px), instant
 * in-page jumps that never count as route changes, and the hash router's hrefs.
 */
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, type NavigateFunction, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, AppRoutes, Providers } from '../App.js'
import { createMockClient } from '../api/mock.js'
import { pickCurrent } from './docs/useAnchors.js'
import { METHODOLOGY_ANSWER, SECTIONS, WIDE_QUERY } from './Methodology.js'

const NB = ' '
const ANCHORS = ['depth', 'spread', 'concentration', 'persistence', 'health', 'gaps', 'scorecards']
const REPO = 'https://github.com/0xdeni/depthwatch'

let hash = ''
let navigate: NavigateFunction = () => undefined
function Probe() {
  hash = useLocation().hash
  navigate = useNavigate()
  return null
}

let scrolled: string[] = []
const original = Element.prototype.scrollIntoView
beforeEach(() => {
  scrolled = []
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id)
  }
})
afterEach(() => {
  cleanup()
  Element.prototype.scrollIntoView = original
  Reflect.deleteProperty(window, 'matchMedia')
  window.location.hash = ''
})

/** Matches the 1200 px query, as a desktop viewport would. */
function wide() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === WIDE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={createMockClient({ now: 1_760_000_000 })} mock queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Probe />
      </MemoryRouter>
    </Providers>,
  )
}

const main = () => screen.getByRole('main')
const section = (id: string) => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`no #${id}`)
  return el
}

describe('Methodology: answer, band and metric blocks', () => {
  it('answers where every number comes from, then indexes the seven metrics as blocks', () => {
    renderAt('/methodology')
    const h1 = within(main()).getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('method')
    expect(h1.className).toContain('title')
    expect(within(main()).getByText(METHODOLOGY_ANSWER).className).toContain('answer')
    const band = screen.getByRole('region', { name: 'Metrics' })
    expect(band.textContent).toBe(
      'Seven metrics, each defined once in docs/METRICS.md and computed once in packages/core.',
    )
    const index = screen.getByRole('region', { name: 'Metric index' })
    expect(index.id).toBe('index')
    const blocks = within(index).getAllByRole('link')
    expect(blocks.map((a) => a.querySelector('h2')?.textContent)).toEqual([
      'depth',
      'spread',
      'concentration',
      'persistence',
      'health',
      'gaps',
      'scorecards',
    ])
    expect(blocks.map((a) => a.getAttribute('href'))).toEqual(
      ANCHORS.map((id) => `/methodology#${id}`),
    )
    // Each block is one destination; the first three stack over the band.
    expect(blocks.every((a) => a.className.includes('is-dest'))).toBe(true)
    expect(blocks.map((a) => a.className.includes('blk--over'))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ])
    expect([...index.querySelectorAll('.take')].map((d) => d.textContent)).toEqual([
      `Dollars it takes to move the price 1, 2 or 5${NB}%, on each side.`,
      'What a round trip of $1K, $10K, $100K or $1M costs, fees included.',
      'How much of the liquidity near the price one LP or one range holds.',
      'Whether the depth is still there from one snapshot to the next.',
      'One score from 0 to 100, and a grade from A to F for pools deep enough to be rated.',
      'Pools that trade far more each day than the liquidity near their price.',
      'A market maker’s promised depth, checked at every snapshot.',
    ])
    expect(main().textContent).toContain('a missing value means unknown, never zero')
  })

  it('keeps middle dots, arrows and "we" out of the page copy (CP2, CP6)', () => {
    renderAt('/methodology')
    const text = main().textContent ?? ''
    expect(text).not.toMatch(/ · |→/)
    expect(text).not.toMatch(/\b[Ww]e\b/)
  })
})

describe('Methodology: sections', () => {
  it('has one anchored section per metric, in the contract order, then USD prices and Reproduce any number', () => {
    renderAt('/methodology')
    expect(SECTIONS.map((s) => s.id)).toEqual(ANCHORS)
    const ids = [...main().querySelectorAll('section.doc-sec')].map((s) => s.id)
    expect(ids).toEqual([...ANCHORS, 'usd-prices', 'reproduce'])
    for (const id of ANCHORS) {
      const h2 = within(section(id)).getByRole('heading', { level: 2 })
      // Section headings are lowercase words; acronyms and symbols keep their case.
      expect(h2.textContent).toBe(SECTIONS.find((s) => s.id === id)?.title)
      expect(h2.textContent?.replace('LP', 'lp')).toBe(h2.textContent?.toLowerCase())
    }
  })

  it('links the scorecards section to the scorecards page, which the nav lists only with mandates', () => {
    renderAt('/methodology')
    // With no mandate the nav and Home leave the page out: this link keeps it reachable.
    const link = within(section('scorecards')).getByRole('link', { name: 'scorecards page' })
    expect(link.getAttribute('href')).toBe('/mm')
  })

  it('keeps each formula behind Show formula, collapsed by default (L2)', () => {
    renderAt('/methodology')
    for (const id of ANCHORS) {
      const button = within(section(id)).getByRole('button', { name: 'Show formula' })
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(section(id).querySelector('pre')).toBeNull()
      fireEvent.click(button, { detail: 0 })
      expect(button.getAttribute('aria-expanded')).toBe('true')
    }
    const formula = (id: string) => section(id).querySelector('pre')?.textContent ?? ''
    expect(formula('depth')).toContain('totalUsd = upUsd + downUsd')
    expect(formula('spread')).toContain('spreadBps = (buyAvg − sellAvg) / mid × 10 000')
    expect(formula('spread')).toContain('for N in {$1K, $10K, $100K, $1M}')
    expect(formula('concentration')).toContain('rangeHhi = sum of share_i²')
    expect(formula('persistence')).toContain('stability = clamp(p10 / median, 0, 1)')
    expect(formula('health')).toContain('35 × clamp((log10(2 × min(up, down)) − 3) / 3, 0, 1)')
    expect(formula('health')).toContain('both sides known and min(up, down) ≥ $5K')
    expect(formula('health')).toContain('A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F')
    expect(formula('gaps')).toContain('gapScore = 100 × clamp(log10(turnover) / 2, 0, 1)')
    expect(formula('gaps')).toContain('volume24hUsd ≥ $10,000')
    expect(formula('scorecards')).toContain('uptime(W) = within KPI / evaluable samples')
    for (const id of ANCHORS) expect(formula(id)).not.toMatch(/[√Σ∈→·]/)
  })

  it('measures the spread up to $1M and says a gap ranks turnover, not fee income', () => {
    renderAt('/methodology')
    expect(section('spread').textContent).toContain('It is measured at $1K, $10K, $100K and $1M')
    expect(section('spread').textContent).toContain(
      'The fee of every Slipstream pool, Aerodrome or Aero, is read at each snapshot',
    )
    expect(section('spread').textContent).toContain('marked “dynamic”')
    expect(section('concentration').textContent).toContain(
      'Aerodrome v2 and Aero v2 pools are one full-range position by construction.',
    )
    const gaps = section('gaps').textContent ?? ''
    expect(gaps).toContain('It ranks turnover, not fee income')
    expect(gaps).toContain('fee tier')
    expect(gaps).not.toMatch(/earns the most fees/)
  })

  it('says an empty stretch costs nothing to cross and when a depth side runs out', () => {
    renderAt('/methodology')
    const depth = section('depth').textContent ?? ''
    expect(depth).toContain(
      'A stretch with no liquidity costs nothing to cross, as it does onchain',
    )
    expect(depth).toContain('When the target lies past the liquidity the snapshot read')
    expect(depth).not.toMatch(/marked exhausted/)
  })

  it('states the USD price convention: $1 stablecoin anchors, not an oracle', () => {
    renderAt('/methodology')
    const prices = section('usd-prices')
    const h2 = within(prices).getByRole('heading', { level: 2 })
    expect(h2.textContent).toBe('USD prices')
    const text = prices.textContent ?? ''
    expect(text).toContain('USDC, USDbC, DAI and USDT count as $1 by convention')
    expect(text).toContain('Aerodrome’s AERO and Aero’s AERO are two tokens with one symbol')
    expect(text).toContain('a valuation convention for depth and volume, not an oracle')
    const button = within(prices).getByRole('button', { name: 'Show formula' })
    fireEvent.click(button, { detail: 0 })
    const formula = prices.querySelector('pre')?.textContent ?? ''
    expect(formula).toContain('min(up × token1Usd, down × token0Usd)')
    expect(formula).not.toMatch(/[√Σ∈→·]/)
    // A convention, not one of the seven metric blocks.
    const index = screen.getByRole('region', { name: 'Metric index' })
    expect(within(index).queryByRole('link', { name: /^USD prices/ })).toBeNull()
  })

  it('says which pools are graded, with the reasons that leave one without a grade', () => {
    renderAt('/methodology')
    const health = section('health').textContent ?? ''
    expect(health).toContain('Not rated')
    expect(health).toContain(
      'too thin to rate, too thin on one side, no USD price, a hooked pool that is not modelled, or transfers paused',
    )
    expect(health).toContain('at least $5K')
    expect(health).toContain('median health on Home and in the stats counts rated pools only')
  })

  it('says which depth stays out of the totals: a stale price and a paused stock’s pool', () => {
    renderAt('/methodology')
    const depth = section('depth').textContent ?? ''
    expect(depth).toContain('is marked “Stale price”')
    expect(depth).toContain('so it stays out of the totals and sorts last by depth')
    expect(depth).toContain(
      'A pool of a tokenized stock whose transfers are paused stays out of the totals too',
    )
  })

  it('draws a schematic where it explains faster than prose, and none elsewhere', () => {
    renderAt('/methodology')
    const figured = ANCHORS.filter((id) => section(id).querySelector('figure'))
    expect(figured).toEqual(['depth', 'persistence', 'health', 'gaps', 'scorecards'])
    for (const id of figured) {
      expect(section(id).querySelector('figcaption')?.textContent).toMatch(/\.$/)
    }
    expect(within(section('depth')).getByRole('img', { name: /mirrored depth curve/ })).toBeTruthy()
    expect(
      within(section('persistence')).getByRole('img', { name: /10th percentile/ }),
    ).toBeTruthy()
    expect(within(section('scorecards')).getByRole('img', { name: /KPI line/ })).toBeTruthy()
  })

  it('draws the depth schematic like the Pool curve: flat areas, ringed points, no filled band', () => {
    renderAt('/methodology')
    const img = within(section('depth')).getByRole('img', { name: /mirrored depth curve/ })
    // The ±2 % band is two dashed rules, so no side mark sits on a filled well (§2.4).
    expect([...img.querySelectorAll('.curve-band')].map((e) => e.tagName)).toEqual(['line', 'line'])
    expect(img.querySelectorAll('path.doc-area')).toHaveLength(2)
    const pts = [...img.querySelectorAll('rect.doc-pt')]
    expect(pts).toHaveLength(6)
    expect(pts.every((r) => r.getAttribute('width') === '12' && r.getAttribute('rx') === '3')).toBe(
      true,
    )
    // Each Yellow ring carries its ink edge; the sell points need none.
    expect(img.querySelectorAll('rect.doc-pt-edge')).toHaveLength(3)
  })

  it('shows the weighted health bar and the grade bands read from core', () => {
    renderAt('/methodology')
    const health = section('health')
    expect(within(health).getByRole('img', { name: /^Depth 30\.2 of 35, Spread/ })).toBeTruthy()
    expect(
      within(health).getByRole('img', {
        name: 'Grades by total score: A from 80, B from 65, C from 50, D from 35, F below 35.',
      }),
    ).toBeTruthy()
    const ticks = [...health.querySelectorAll('.doc-grades .doc-tick')].map((t) => t.textContent)
    expect(ticks).toEqual(['0', '35', '50', '65', '80', '100'])
  })

  it('maps turnover to the gap score on core’s log scale', () => {
    renderAt('/methodology')
    const scale = within(section('gaps')).getByRole('img', { name: /^Gap score by turnover/ })
    expect(scale.getAttribute('aria-label')).toBe(
      'Gap score by turnover: 1× scores 0, 3× scores 24, 10× scores 50, 100× or more scores 100.',
    )
    expect([...scale.querySelectorAll('.doc-tick')].map((t) => t.textContent)).toEqual([
      '1×',
      '3×',
      '10×',
      '100×',
      '0',
      '50',
      '100',
    ])
  })

  it('ends with how to reproduce any number, linking the documents and the repository', () => {
    renderAt('/methodology')
    const end = section('reproduce')
    const href = (name: string) => within(end).getByRole('link', { name }).getAttribute('href')
    expect(href('repository')).toBe(REPO)
    expect(href('METRICS.md')).toBe(`${REPO}/blob/main/docs/METRICS.md`)
    expect(href('SCORECARDS.md')).toBe(`${REPO}/blob/main/docs/SCORECARDS.md`)
  })
})

describe('Methodology: On this page', () => {
  const outline = [...ANCHORS, 'usd-prices', 'reproduce'].map((id) => `/methodology#${id}`)

  it('is a disclosure under the answer below 1200 px', () => {
    renderAt('/methodology')
    expect(screen.queryByRole('navigation', { name: 'On this page' })).toBeNull()
    const button = screen.getByRole('button', { name: 'On this page' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button, { detail: 0 })
    const nav = screen.getByRole('navigation', { name: 'On this page' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(outline)
    expect(within(nav).getAllByRole('link').at(-1)?.textContent).toBe('Reproduce any number')
  })

  it('is a list in the left column from 1200 px, marking the current section', () => {
    wide()
    renderAt('/methodology')
    expect(screen.queryByRole('button', { name: 'On this page' })).toBeNull()
    const nav = screen.getByRole('navigation', { name: 'On this page' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual(outline)
    expect(links.filter((a) => a.getAttribute('aria-current') === 'location')).toHaveLength(1)
  })

  it('picks the last section whose top passed the line, or the last one at the end', () => {
    const tops = [
      ['depth', -400],
      ['spread', 80],
      ['gaps', 600],
    ] as const
    expect(pickCurrent(tops, 104, false)).toBe('spread')
    expect(pickCurrent([['depth', 300]], 104, false)).toBeNull()
    expect(pickCurrent(tops, 104, true)).toBe('gaps')
  })
})

describe('Methodology: in-page jumps', () => {
  it('scrolls to the section named by the hash on arrival', () => {
    renderAt('/methodology#health')
    expect(scrolled).toEqual(['health'])
  })

  it('jumps in place: the hash is pushed, the click never reaches the shell as a route change', () => {
    renderAt('/methodology')
    const index = screen.getByRole('region', { name: 'Metric index' })
    const block = (name: string) =>
      within(index).getByRole('link', { name: new RegExp(`^${name} `) })
    // A pointer click: default prevented (no view transition), scrolled, focus left alone.
    expect(fireEvent.click(block('gaps'), { detail: 1 })).toBe(false)
    expect(hash).toBe('#gaps')
    expect(scrolled).toEqual(['gaps'])
    expect(document.activeElement).not.toBe(main())
    // A keyboard click: focus moves to the section's heading, not to <main>.
    fireEvent.click(block('health'), { detail: 0 })
    expect(hash).toBe('#health')
    expect(document.activeElement).toBe(within(section('health')).getByRole('heading'))
    // Clicking the current anchor again scrolls without a new history entry.
    fireEvent.click(block('health'), { detail: 1 })
    expect(scrolled).toEqual(['gaps', 'health', 'health'])
    // Back keeps the shell's restored position instead of snapping to the section.
    act(() => navigate(-1))
    expect(hash).toBe('#gaps')
    expect(scrolled).toEqual(['gaps', 'health', 'health'])
  })

  it('leaves modified clicks to the browser (new tab, new window)', () => {
    renderAt('/methodology')
    const link = within(screen.getByRole('region', { name: 'Metric index' })).getByRole('link', {
      name: /^depth /,
    })
    link.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(link, { detail: 1, metaKey: true })
    expect(hash).toBe('')
    expect(scrolled).toEqual([])
  })
})

describe('Methodology: static build (hash router)', () => {
  it('keeps every anchor inside the hash route', async () => {
    window.location.hash = '#/methodology'
    render(<App client={createMockClient({ now: 1_760_000_000 })} mock={false} staticBuild />)
    const index = await screen.findByRole('region', { name: 'Metric index' })
    expect(
      within(index)
        .getByRole('link', { name: /^depth / })
        .getAttribute('href'),
    ).toBe('#/methodology#depth')
  })
})
