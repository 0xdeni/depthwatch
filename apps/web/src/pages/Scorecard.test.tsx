import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import {
  createMockClient,
  MOCK_MM_BREACHED_ID,
  MOCK_MM_BREACHED_POOL,
  MOCK_MM_OK_ID,
  MOCK_MM_OK_POOL,
} from '../api/mock.js'
import { MOCK_MM_OWNER_SLIP } from '../api/mockScorecards.js'
import type { ApiClient } from '../api/types.js'
import { poolHref } from '../lib/format.js'

const NOW = 1_760_000_000
const NB = '\u00a0'

afterEach(cleanup)

let search = ''
function LocationProbe() {
  search = useLocation().search
  return null
}

function renderAt(path: string, client: ApiClient = createMockClient({ now: NOW })) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client} mock dataNow={NOW} queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  )
}

function section(name: string): HTMLElement {
  const el = screen.getByRole('heading', { level: 2, name }).closest('section')
  if (!el) throw new Error(`section ${name} not rendered`)
  return el
}

/** Every fact label, in order (the `dt`s of the facts row). */
function factLabels(): string[] {
  const facts = document.querySelector('.sc-facts')
  if (!facts) throw new Error('facts not rendered')
  return [...facts.querySelectorAll('dt')].map((dt) => dt.textContent ?? '')
}

/** Every fact value, in order. */
function factValues(): string[] {
  const facts = document.querySelector('.sc-facts')
  if (!facts) throw new Error('facts not rendered')
  return [...facts.querySelectorAll('dd .num')].map((v) => v.textContent ?? '')
}

async function chart(): Promise<HTMLElement> {
  return screen.findByRole('img', { name: /^Market-maker depth per side over/ })
}

describe('/mm/:id title section and answer (visual-v4 §6.7)', () => {
  it('starts with the back link, the eyebrow, the mandate name, its status chip and the pool', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    const h1 = await screen.findByRole('heading', {
      level: 1,
      name: /^Demo Markets . Slipstream WETH\/AERO$/,
    })
    expect(h1.className).toContain('display')
    const back = document.querySelector('a.back')
    expect(back?.textContent).toBe('Scorecards')
    expect(back?.getAttribute('href')).toBe('/mm')
    expect(document.querySelector('.sc-eb')?.textContent).toMatch(
      /^Scorecard Demo Markets on WETH \/ AERO \(Aerodrome\), Aerodrome Slipstream 0\.3.% dynamic$/,
    )
    // One filled chip, under the title (K5).
    const chips = document.querySelectorAll('.status-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0]?.textContent).toBe('Within KPI')
    const note = document.querySelector('.sc-note') as HTMLElement
    expect(note.textContent).toBe(
      'Measured on the liquidity Demo Markets holds in the WETH / AERO (Aerodrome) pool.',
    )
    expect(within(note).getByRole('link').getAttribute('href')).toBe(poolHref(MOCK_MM_OK_POOL))
  })

  it('answers with what the latest sample says against the per-side KPI', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    expect(
      await screen.findByText('Both sides are within the $50K KPI at the latest sample.'),
    ).toBeTruthy()
    cleanup()
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    const answer = await screen.findByText(/^Both sides are below the \$25K KPI: /)
    expect(answer.className).toContain('answer')
    expect(answer.textContent).toBe(
      `Both sides are below the $25K KPI: $8.81K and $9.01K sit within 2${NB}% of the price.`,
    )
    expect(document.querySelector('.status-chip')?.textContent).toBe('Breached')
  })
})

describe('/mm/:id KPI chart on the band and facts', () => {
  it('draws the latest sample per side against the KPI on the band, with its time', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    const kpi = await screen.findByRole('img', { name: /^Sell side \$8\.81K, below the \$25K KPI/ })
    expect(kpi.closest('.band')).toBeTruthy()
    expect(kpi.getAttribute('aria-label')).toMatch(/Buy side \$9\.01K, below it by/)
    const band = screen.getByRole('region', { name: /^Depth within ±2.% against the KPI, / })
    expect(band.querySelector('.band-ground')).toBeTruthy()
    expect(band.textContent).toMatch(/Shortfall against the KPI: /)
  })

  it('labels each fact with its comparison, the uptime count first', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    expect(factLabels()).toEqual([
      'sell side now, within the $50K KPI',
      'buy side now, within the $50K KPI',
      `samples within KPI in 7${NB}d: uptime 96.4${NB}%, target 95${NB}%`,
    ])
    expect(factValues()[2]).toBe('80 of 83')
    // The facts row is one ink block over the band; "KPI" is a glossary term at rest.
    expect(document.querySelector('.sc-facts')?.closest('.overlap')).toBeTruthy()
    expect(document.querySelector('.sc-facts')?.className).toContain('ink')
    expect(screen.getAllByRole('button', { name: 'KPI' })).toHaveLength(2)
    expect(screen.queryByRole('img', { name: 'Below KPI' })).toBeNull()
  })

  it('marks breached values with a triangle and adds the spread fact', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    expect(factLabels()).toEqual([
      'sell side now, below the $25K KPI',
      'buy side now, below the $25K KPI',
      `samples within KPI in 7${NB}d: uptime 24${NB}%, target 90${NB}%`,
      `spread at $10K now, within the 40.0${NB}bps KPI`,
    ])
    expect(document.querySelector('.sc-facts')?.className).toContain('is-four')
    expect(screen.getAllByRole('img', { name: 'Below KPI' })).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Below target' })).toBeTruthy()
  })

  it('rewrites the facts while scrubbing with the arrow keys, and restores them on Escape', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    const img = await chart()
    act(() => img.focus())
    fireEvent.keyDown(img, { key: 'ArrowLeft' })
    expect(factLabels()[0]).toBe('sell side now, within the $50K KPI')
    fireEvent.keyDown(img, { key: 'ArrowLeft' })
    expect(factLabels()[0]).toBe('sell side then, within the $50K KPI')
    expect(document.querySelector('.scrub-cap')?.textContent).toMatch(/^Within KPI.*UTC$/)
    // Plain words while scrubbing: no glossary buttons move under the pointer.
    expect(screen.queryAllByRole('button', { name: 'KPI' })).toHaveLength(0)
    fireEvent.keyDown(img, { key: 'Escape' })
    expect(factLabels()[0]).toBe('sell side now, within the $50K KPI')
    expect(screen.getAllByRole('button', { name: 'KPI' })).toHaveLength(2)
  })
})

describe('/mm/:id depth over time, the first section', () => {
  it('leads the sheet with the time chart over 7 d, the streak and Show data', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    expect((await chart()).getAttribute('aria-label')).toMatch(/over 7 days against the \$50K KPI/)
    const time = section('depth over time')
    expect(time.closest('.secs')?.querySelector('section')).toBe(time)
    expect(
      within(time).getByText(/^Within KPI for 58 consecutive samples, since 4.Oct, 14:53.UTC\.$/),
    ).toBeTruthy()
    const windows = within(time).getByRole('radiogroup', { name: 'Time window' })
    expect(
      within(windows)
        .getByRole('radio', { name: `7${NB}d` })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(within(time).getByRole('checkbox', { name: 'Whole-pool depth' })).toBeTruthy()
    const showData = within(time).getByRole('button', { name: 'Show data' })
    fireEvent.click(showData, { detail: 0 })
    expect(showData.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('table', { name: 'Samples per UTC day' })).toBeTruthy()
  })

  it('keeps the window in the URL (?window=, replace) and follows it in the sections', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    expect(within(section('uptime')).getByText(/over 7 days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: `24${NB}h` }), { detail: 1 })
    expect(search).toBe('?window=24h')
    expect((await chart()).getAttribute('aria-label')).toMatch(/over 24 hours/)
    expect(
      within(section('uptime')).getByText(
        `12 of 12 samples within KPI over 24 hours (target 95 %).`,
      ),
    ).toBeTruthy()
    expect(within(section('breaches')).getByText('No breaches in 24 hours.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: `7${NB}d` }), { detail: 1 })
    expect(search).toBe('')
  })

  it('reads ?window=30d on load', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}?window=30d`)
    expect((await chart()).getAttribute('aria-label')).toMatch(/over 30 days/)
    expect(screen.getByRole('radio', { name: `30${NB}d` }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(
      within(section('uptime')).getByText(
        `93 of 96 samples within KPI over 30 days (target 95 %).`,
      ),
    ).toBeTruthy()
  })
})

describe('/mm/:id sections', () => {
  it('shows the uptime strip and all three windows behind Details', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    const up = section('uptime')
    expect(
      within(up).getByText(`80 of 83 samples within KPI over 7 days (target 95 %).`),
    ).toBeTruthy()
    expect(
      within(up).getByRole('img', { name: '80 of 83 samples within KPI, 1 not evaluable' }),
    ).toBeTruthy()
    fireEvent.click(within(up).getByRole('button', { name: 'Details' }), { detail: 0 })
    const rows = within(within(up).getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      `24${NB}h1212100${NB}%0`,
      `7${NB}d838096.4${NB}%1`,
      `30${NB}d969396.9${NB}%1`,
    ])
  })

  it('collapses breached samples into episodes, with the raw samples behind Show samples', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    const br = section('breaches')
    expect(
      within(br).getByText(
        `1 breach episode in 7 days, the longest 4 h. Alerts fire after 3 in a row.`,
      ),
    ).toBeTruthy()
    expect(within(br).getByText(`4 h, 3 samples, sell side`)).toBeTruthy()
    expect(within(br).getByText('$42K')).toBeTruthy()
    fireEvent.click(within(br).getByRole('button', { name: 'Show samples' }), { detail: 0 })
    const table = within(br).getByRole('table', { name: 'Breached samples, newest first' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toMatch(/Sell side\$60K\$42K/)
  })

  it('lists three episodes, then "Show all N episodes"', async () => {
    // Every fourth sample of the mock series breached on the sell side: one episode each.
    const base = createMockClient({ now: NOW })
    const client: ApiClient = {
      ...base,
      scorecardSamples: async (id, query) => {
        const res = await base.scorecardSamples(id, query)
        return {
          ...res,
          points: res.points.map((p, i) =>
            i % 4 === 0 ? { ...p, withinKpi: false, breaches: ['depthDown'] } : p,
          ),
        }
      },
    }
    renderAt(`/mm/${MOCK_MM_OK_ID}`, client)
    await chart()
    const br = section('breaches')
    const total = Number(
      /^(\d+) breach episodes/.exec(br.querySelector('.takeaway')?.textContent ?? '')?.[1],
    )
    expect(total).toBeGreaterThan(3)
    expect(br.querySelectorAll('.sc-ep-row')).toHaveLength(3)
    const more = within(br).getByRole('button', { name: `Show all ${total} episodes` })
    fireEvent.click(more, { detail: 0 })
    expect(br.querySelectorAll('.sc-ep-row')).toHaveLength(total)
  })

  it('reads the ongoing episode of the breached mandate', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    const br = section('breaches')
    expect(within(br).getByText(`36 h, ongoing, 19 samples, both sides`)).toBeTruthy()
    expect(within(br).queryByRole('button', { name: /^Show all/ })).toBeNull()
  })

  it('reads the worst moments against the KPI, with the block in Details', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    const worst = section('worst moments')
    expect(within(worst).getByText('Lowest buy-side depth')).toBeTruthy()
    expect(within(worst).getByText('Lowest sell-side depth')).toBeTruthy()
    expect(within(worst).getByText('Widest spread')).toBeTruthy()
    expect(within(worst).getByText(`37.4 bps`)).toBeTruthy()
    // The time's tooltip carries the block; Details carries it too (P6: never hover-only).
    const time = within(worst).getAllByRole('button', { name: /UTC$|ago$/ })[0]
    if (!time) throw new Error('no time term')
    act(() => time.focus())
    expect(screen.getByRole('tooltip').textContent).toMatch(/^Block 36,087,456, /)
    fireEvent.click(within(worst).getByRole('button', { name: 'Details' }), { detail: 0 })
    expect(within(worst).getAllByText('36,087,456').length).toBeGreaterThan(0)
  })

  it('keeps the measured spread behind the time row when the mandate has no spread KPI', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    expect(screen.queryByRole('heading', { level: 2, name: 'spread' })).toBeNull()
    const time = section('depth over time')
    fireEvent.click(within(time).getByRole('button', { name: 'Show measured spread' }), {
      detail: 0,
    })
    expect(within(time).getByText('This mandate has no spread KPI.')).toBeTruthy()
    expect(within(time).getByText('Market-maker spread at $10K')).toBeTruthy()
    expect(within(time).getByText('Whole-pool spread at $10K')).toBeTruthy()
  })

  it('shows the spread series at once when the mandate has a spread KPI', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    const spread = section('spread')
    expect(within(spread).getByText(`KPI: at most 40.0 bps at $10K.`)).toBeTruthy()
    expect(within(spread).getByText('Market-maker spread at $10K')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show measured spread' })).toBeNull()
    // The KPI is a dashed line on the market maker's spread only, labelled in the right pad.
    await waitFor(() => expect(spread.querySelectorAll('.sm-ref')).toHaveLength(1))
    expect(within(spread).getByText('KPI 40.0')).toBeTruthy()
  })

  it('previews the API badge, copies the snippets and hides the code behind Show code', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    const embed = section('embed badge')
    expect(await within(embed).findByTestId('badge-preview')).toBeTruthy()
    expect(within(embed).getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
    expect(within(embed).getByRole('button', { name: 'Copy Markdown' })).toBeTruthy()
    expect(within(embed).getByText('Cached for 5 minutes.')).toBeTruthy()
    expect(
      within(embed).getByText(
        'Show the live status on a project page. The badge is the API’s own SVG.',
      ),
    ).toBeTruthy()
    expect(within(embed).queryByText('Badge URL')).toBeNull()
    fireEvent.click(within(embed).getByRole('button', { name: 'Show code' }), { detail: 0 })
    expect(within(embed).getByText('Badge URL')).toBeTruthy()
    expect(
      within(embed).getByText(new RegExp(`/api/mm/${MOCK_MM_OK_ID}/badge\\.svg$`)),
    ).toBeTruthy()
  })

  it('lists the mandate: addresses on Basescan with copy, KPIs, attribution, alerts', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    const about = section('mandate')
    // Always open from 840 px (CSS); jsdom sees the phone disclosure, so open it.
    fireEvent.click(within(about).getByRole('button', { name: 'Mandate details' }), { detail: 0 })
    const address = within(about).getByRole('link', { name: '0x00000000…0000b1' })
    expect(address.getAttribute('href')).toBe(`https://basescan.org/address/${MOCK_MM_OWNER_SLIP}`)
    expect(
      within(about).getByRole('button', { name: `Copy address ${MOCK_MM_OWNER_SLIP}` }),
    ).toBeTruthy()
    const text = about.textContent ?? ''
    expect(text).toContain(`$50K per side within ±2${NB}%`)
    expect(text).toContain('2 positions')
    expect(text).toContain(`Share of in-band liquidity30${NB}%`)
    expect(text).toContain('After 3 breached samples, no webhook')
    expect(text).toContain('Mock mirror of the demo Slipstream mandate')
    expect(text).toMatch(/Registered\d+.Aug, \d\d:\d\d.UTC, active/)
  })

  it('keeps the breached mandate pool linked from the Mandate list', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    const about = section('mandate')
    fireEvent.click(within(about).getByRole('button', { name: 'Mandate details' }), { detail: 0 })
    expect(
      within(about).getByRole('link', { name: 'USDC / AERO (Aerodrome)' }).getAttribute('href'),
    ).toBe(poolHref(MOCK_MM_BREACHED_POOL))
  })
})

describe('/mm/:id not found', () => {
  it('says what was not found, shows the id and links to the scorecards', async () => {
    renderAt('/mm/no-such-mandate')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'scorecard not found' }),
    ).toBeTruthy()
    expect(document.title).toBe('Scorecard not found – Depthwatch')
    expect(screen.getByText('no-such-mandate')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse scorecards' }).getAttribute('href')).toBe('/mm')
    expect(screen.getByRole('link', { name: 'How scorecards work' }).getAttribute('href')).toBe(
      '/methodology#scorecards',
    )
  })
})
