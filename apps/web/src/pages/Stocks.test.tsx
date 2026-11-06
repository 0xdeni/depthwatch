/**
 * Stocks (`/stocks`, docs/design/stocks-api.md §3, §6) over the mock client: one row per stock in
 * the API's order, every status in words and "Transfers paused", Chainlink's answer with its age,
 * the deepest pool's deviation with its band or "—" with the reason, the eligibility line and the
 * valuation label; no link or button offers a buy, a trade or a swap. Then an empty stock list and
 * a failed request.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { ApiError } from '../api/errors.js'
import { createMockClient } from '../api/mock.js'
import type { ApiClient } from '../api/types.js'
import { ELIGIBILITY_LINE, VALUATION_LABEL } from '../lib/stockText.js'
import { expectNoTradeControls } from '../testing/noTrade.js'

const NOW = 1_760_000_000
const nb = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ')

afterEach(cleanup)

function renderAt(path: string, client: ApiClient = createMockClient({ now: NOW })) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client} mock queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.stk-list > li')]

describe('Stocks', () => {
  it('lists every stock in the API’s order, each linking to its page', async () => {
    renderAt('/stocks')
    const h1 = await screen.findByRole('heading', { level: 1, name: 'stocks' })
    expect(h1).toBeTruthy()
    await screen.findByText('NVDAc')
    expect(rows().map((r) => r.querySelector('.rl-link')?.textContent)).toEqual([
      'NVDAc',
      'AMZNc',
      'AAPLc',
      'COINc',
      'METAc',
      'MSFTc',
      'TSLAc',
    ])
    const link = screen.getByRole('link', { name: 'NVDAc, NVIDIA Corporation' })
    expect(link.getAttribute('href')).toBe('/stocks/0xb26e766461630000000000000000000000000000')
    expect(nb(document.querySelector('.answer')?.textContent)).toBe(
      '7 tokenized stocks, 4 of them with scored pools. The deepest, NVDAc, holds $606K within 2 % of its pools’ prices.',
    )
  })

  it('says every status in words, and Transfers paused beside a live feed', async () => {
    renderAt('/stocks')
    await screen.findByText('NVDAc')
    const status = (i: number) =>
      [...(rows()[i]?.querySelectorAll('.status') ?? [])].map((s) => s.textContent)
    expect(rows().map((_, i) => status(i))).toEqual([
      ['Live'],
      ['Off-hours'],
      ['Paused'],
      ['No feed'],
      ['Invalid'],
      ['Unread'],
      ['Live', 'Transfers paused'],
    ])
  })

  it('gives Chainlink’s answer with its age and the deviation with its band, or why there is none', async () => {
    renderAt('/stocks')
    await screen.findByText('NVDAc')
    const [nvda, amzn, , coin] = rows()
    const text = (el: HTMLElement | undefined) => nb(el?.textContent)
    expect(text(nvda)).toContain('$199.50Chainlink’s answer30 min old')
    expect(text(nvda)).toContain(
      '+25.06 bpsDeepest pool from the feedwithin the feed’s 0.5 % band plus the pool’s fee',
    )
    expect(text(nvda)).toContain('Aero Slipstream 84 %, 2 more')
    expect(
      nb(
        within(nvda as HTMLElement)
          .getByRole('img', { name: /^Depth by DEX: / })
          .getAttribute('aria-label'),
      ),
    ).toBe('Depth by DEX: Aero Slipstream 84 %, Uniswap v3 15 %, Uniswap v4 under 1 %')
    // Held: no deviation, its answer still published with its age.
    expect(text(amzn)).toContain('$220.00Chainlink’s answer28 h old')
    expect(text(amzn)).toContain('Off-hours')
    const dev = amzn?.querySelector('.stk-dev [role="img"]')
    expect(dev?.getAttribute('aria-label')).toMatch(/^Unknown: Off-hours: the feed holds/)
    // No pool: one line instead of the depth, spread and deviation.
    expect(text(coin)).toContain('No scored pool holds this stock')
    expect(coin?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Unknown: Not published while the reading is No feed.',
    )
  })

  it('carries the eligibility line and the valuation label, and no trade control', async () => {
    renderAt('/stocks')
    await screen.findByText('NVDAc')
    const band = screen.getByRole('region', { name: 'Who these markets are for' })
    expect(within(band).getByText(ELIGIBILITY_LINE)).toBeTruthy()
    expect(
      within(band).getByRole('link', { name: 'How a deviation is measured' }).getAttribute('href'),
    ).toMatch(/docs\/METRICS\.md#reference-deviation$/)
    expect(screen.getByText(VALUATION_LABEL)).toBeTruthy()
    expect(within(screen.getByRole('contentinfo')).getByText(ELIGIBILITY_LINE)).toBeTruthy()
    expectNoTradeControls()
  })

  it('says so when the stock list is empty, and offers a retry when the request fails', async () => {
    const base = createMockClient({ now: NOW })
    renderAt('/stocks', { ...base, stocks: async () => ({ items: [] }) })
    expect(await screen.findByText(/No tokenized stock is stored yet/)).toBeTruthy()
    expect(nb(document.querySelector('.answer')?.textContent)).toBe(
      'No tokenized stock is in the stock list yet.',
    )
    cleanup()
    renderAt('/stocks', {
      ...base,
      stocks: async () => {
        throw new ApiError(500, 'boom')
      },
    })
    expect(await screen.findByText(/Unable to load stocks/)).toBeTruthy()
  })
})
