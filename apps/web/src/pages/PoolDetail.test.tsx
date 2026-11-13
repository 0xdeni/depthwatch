import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { createMockClient, MOCK_MM_OK_ID, MOCK_MM_OK_POOL } from '../api/mock.js'
import type { ApiClient } from '../api/types.js'
import { FIRST_VIEW_MS, firstViewSteps } from '../lib/firstView.js'
import { NB } from '../lib/format.js'
import { mmHref } from '../lib/scorecard.js'
import { facts, loaded, NOW, renderPool, url, V3_WETH_USDC } from './pool/testing.js'

afterEach(cleanup)

/** The band's region, named by its eyebrow heading. */
const band = () =>
  screen.getByRole('region', { name: `Depth to move the price, measured at ±1, 2 and 5${NB}%` })
const factLabels = () => [...facts().querySelectorAll('dt')].map((d) => d.textContent)

describe('Pool page: the title section and the band (visual-v4 §6.4)', () => {
  it('leads with the back link, the eyebrow, the pair with token links and the answer', async () => {
    renderPool(V3_WETH_USDC)
    const h1 = await loaded()
    expect(h1.className).toContain('title')
    const title = screen.getByRole('region', { name: 'WETH / USDC' })
    expect(within(title).getByRole('link', { name: 'Pools' }).getAttribute('href')).toBe('/pools')
    const eyebrow = title.querySelector('.eyebrow')
    expect([...(eyebrow?.children ?? [])].map((s) => s.textContent)).toEqual([
      'Uniswap v3',
      `0.05${NB}% fee`,
    ])
    const tokenLinks = within(h1).getAllByRole('link')
    expect(tokenLinks.map((a) => a.getAttribute('href'))).toEqual([
      expect.stringMatching(/^\/tokens\/0x/),
      expect.stringMatching(/^\/tokens\/0x/),
    ])
    // The answer sits in the title section, beside the pair.
    expect(title.querySelector('.answer')?.textContent).toMatch(
      /^It takes \$[\d.]+[KM] of buying to lift WETH 2\s% and \$[\d.]+[KM] of selling to push it down\.$/,
    )
  })

  it('names the tab after the pair, the DEX and the fee, and an unknown pool as not found', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    expect(document.title).toBe(`WETH / USDC, Uniswap v3 0.05${NB}% – Depthwatch`)
    cleanup()
    renderPool('uniswap-v3:0x0000000000000000000000000000000000000001')
    await screen.findByRole('heading', { level: 1, name: 'pool not found' })
    expect(document.title).toBe('Pool not found – Depthwatch')
  })

  it('draws the mirrored curve on the band, with its numbers behind Show data', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const region = band()
    expect(region.querySelector('.band-ground')).toBeTruthy()
    const curve = region.querySelector('.cv svg[role="img"]')
    expect(curve?.getAttribute('aria-label')).toBeTruthy()
    expect(curve?.getAttribute('tabindex')).toBe('0')
    fireEvent.click(within(region).getByRole('button', { name: 'Show data' }), { detail: 0 })
    const table = await within(region).findByRole('table', { name: 'Depth per level and side' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual([
      `±1${NB}%`,
      `±2${NB}%`,
      `±5${NB}%`,
    ])
    // On the band the table sits in a surface block, never on Blue.
    expect(table.closest('.band-data')).toBeTruthy()
  })

  it('flips the price, and the button names the other direction', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const flip = screen.getByRole('button', { name: 'Show price in WETH' })
    const before = document.querySelector('.pool-price')?.textContent ?? ''
    expect(before).toMatch(/^1\sWETH = [\d,.]+\sUSDC$/)
    fireEvent.click(flip, { detail: 0 })
    expect(screen.getByRole('button', { name: 'Show price in USDC' })).toBeTruthy()
    expect(document.querySelector('.pool-price')?.textContent).toMatch(/^1\sUSDC = 0\.\d+\sWETH$/)
  })

  it('builds the page once with the first view, every step over by 450 ms', async () => {
    const { container } = renderPool(V3_WETH_USDC)
    await loaded()
    const steps = firstViewSteps(container, false)
    const of = (el: Element | null) => steps.filter((s) => s.el === el)
    expect(of(band().querySelector('.band-ground'))).toHaveLength(1)
    expect(of(screen.getByRole('heading', { level: 1 }))[0]?.keyframes[0]).toMatchObject({
      opacity: 0,
    })
    expect(of(document.querySelector('.pool-answer'))).toHaveLength(1)
    expect(of(facts())).toHaveLength(1)
    expect(steps.filter((s) => s.el.matches('[data-area]'))).toHaveLength(1)
    expect(steps.filter((s) => s.el.matches('[data-pt]')).length).toBe(6)
    for (const s of steps) expect(s.delay + s.duration).toBeLessThanOrEqual(FIRST_VIEW_MS)
    const reduced = firstViewSteps(container, true)
    for (const s of reduced) expect(Object.keys(s.keyframes[0] ?? {})).toEqual(['opacity'])
  })
})

describe('Pool page: the facts row over the band (visual-v4 §6.4, §5.6)', () => {
  it('states four facts, value first, each label carrying its comparison', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const row = facts()
    expect(row.classList.contains('ink')).toBe(true)
    expect(row.closest('.overlap')).toBeTruthy()
    const stats = await createMockClient({ now: NOW }).stats()
    const median = Math.floor(stats.totals.medianHealth ?? 0)
    await waitFor(() =>
      expect(factLabels()[0]).toBe(`health; the median rated pool scores${NB}${median}`),
    )
    expect(factLabels().slice(1)).toEqual([
      'spread at $10K, a round trip',
      expect.stringMatching(/^traded in 24\sh, [\d.]+× the depth within\s2\s%$/),
      expect.stringMatching(/^TVL, of which (\d+|under 1)\s% sits within\s2\s%$/),
    ])
    expect(within(row).getByRole('img', { name: /^Grade [A-F]$/ })).toBeTruthy()
  })

  it('adds the gap callout for a pool that trades 3× its depth, with the way to the gaps', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const note = await waitFor(() => {
      const el = facts().querySelector('.facts-note')
      if (!el?.textContent?.includes('one of')) throw new Error('callout not counted yet')
      return el
    })
    expect(note.textContent).toMatch(
      /^Liquidity gap: one of \d+ pools that trade 3× their depth or more a day\. See all gaps$/,
    )
    expect(
      within(note as HTMLElement)
        .getByRole('link', { name: 'See all gaps' })
        .getAttribute('href'),
    ).toBe('/gaps')
  })
})

describe('Pool page: loading (ST1)', () => {
  it('shows the title block from a loaded list at once, with the skeleton laid out', async () => {
    const base = createMockClient({ now: NOW })
    const list = await base.pools({ limit: 200 })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['pools', { limit: 200 }], list)
    const client: ApiClient = { ...base, pool: () => new Promise(() => undefined) }
    render(
      <Providers client={client} mock queryClient={queryClient}>
        <MemoryRouter initialEntries={[`/pools/${encodeURIComponent(V3_WETH_USDC)}`]}>
          <AppRoutes />
        </MemoryRouter>
      </Providers>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'WETH / USDC' })).toBeTruthy()
    expect(document.querySelector('.pool-price')?.textContent).toMatch(/^1\sWETH = [\d,.]+\sUSDC$/)
    // The blocks hold the final sizes from the first frame, unpainted for the first 300 ms: on
    // the band, the legend row, the 340 px curve and its foot row.
    const skeleton = document.querySelector<HTMLElement>('[role="status"].skel-stack')
    expect(skeleton?.getAttribute('aria-label')).toBe('Loading pool')
    expect(skeleton?.style.visibility).toBe('hidden')
    expect(skeleton?.closest('.band')).toBeTruthy()
    const heights = [...(skeleton?.querySelectorAll<HTMLElement>('.skel') ?? [])].map(
      (el) => el.style.height,
    )
    expect(heights).toContain('340px')
    expect(document.querySelector('.pool-skel-facts')?.closest('.overlap')).toBeTruthy()
  })
})

describe('Pool page: sections', () => {
  it('orders the sections and puts Details in each heading', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual([
      `Depth to move the price, measured at ±1, 2 and 5${NB}%`,
      'health',
      'cost to trade',
      'who provides it',
      'over time',
      'about this pool',
    ])
    // One sections sheet, a row per section; About is a panel after it.
    const sheet = document.querySelector('.secs')
    expect(sheet?.querySelectorAll(':scope > section.sec')).toHaveLength(4)
    expect(screen.getByRole('region', { name: 'about this pool' }).classList).toContain(
      'blk--panel',
    )
    const health = screen.getByRole('region', { name: 'health' })
    fireEvent.click(within(health).getByRole('button', { name: 'Details' }), { detail: 0 })
    const table = within(health).getByRole('table', { name: 'Health components' })
    expect(within(table).getByText(/^Total, grade [A-F]$/)).toBeTruthy()
  })

  it('keeps the window in the URL and starts from it', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const time = screen.getByRole('region', { name: 'over time' })
    const week = within(time).getByRole('radio', { name: `7${NB}d` })
    act(() => {
      fireEvent.click(week, { detail: 0 })
    })
    expect(url.search).toBe('?window=7d')
    expect(week.getAttribute('aria-checked')).toBe('true')
    cleanup()
    renderPool(V3_WETH_USDC, { query: '?window=7d' })
    await loaded()
    const again = screen.getByRole('region', { name: 'over time' })
    expect(
      within(again)
        .getByRole('radio', { name: `7${NB}d` })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('lists the mandates on the pool, each linking to its scorecard', async () => {
    renderPool(MOCK_MM_OK_POOL)
    const region = await screen.findByRole('region', { name: 'mandates on this pool' })
    const link = within(region).getAllByRole('link')[0]
    expect(link?.getAttribute('href')).toBe(mmHref(MOCK_MM_OK_ID))
    expect(within(region).getByText('Within KPI')).toBeTruthy()
  })
})
