/**
 * Stock (`/stocks/:token`, docs/design/stocks-api.md §3, §6) over the mock client: a live stock
 * with its pools inside and outside the band and one too thin to compare, a held stock with the
 * off-hours explanation, a stock whose transfers are paused (the banner, no pool in the sums), a
 * stock without a feed, the eligibility line, and a stock not on the list. No link or button
 * offers a buy, a trade or a swap.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { createMockClient, MOCK_STOCK_POOLS } from '../api/mock.js'
import type { StockDetail } from '../api/stockTypes.js'
import type { ApiClient } from '../api/types.js'
import { ELIGIBILITY_LINE, VALUATION_LABEL } from '../lib/stockText.js'
import { expectNoTradeControls } from '../testing/noTrade.js'

const NOW = 1_760_000_000
const client = createMockClient({ now: NOW })
const { items } = await client.stocks()
const address = (ticker: string) =>
  items.find((s) => s.stock.ticker === ticker)?.stock.token.address ?? ''
const nb = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ')

afterEach(cleanup)

function renderAt(path: string, edit?: (detail: StockDetail) => StockDetail) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const base = createMockClient({ now: NOW })
  const api: ApiClient = edit ? { ...base, stock: async (a) => edit(await base.stock(a)) } : base
  return render(
    <Providers client={api} mock queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

const facts = () => nb(document.querySelector('.stk-facts')?.textContent)
const band = () => screen.getByRole('region', { name: 'Reference' })
const poolRows = () => [...document.querySelectorAll<HTMLTableRowElement>('.stk-pools tbody tr')]

describe('Stock: a live stock', () => {
  it('names the stock, its status and Chainlink’s answer with its age at the block', async () => {
    renderAt(`/stocks/${address('NVDA')}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'NVDAc' })).toBeTruthy()
    expect(screen.getByText('NVIDIA Corporation')).toBeTruthy()
    expect(document.querySelector('.stk-ttl .status-chip')?.textContent).toBe('Live')
    expect(nb(document.querySelector('.answer')?.textContent)).toBe(
      'NVDAc’s pools hold $303K on the buy side and $303K on the sell side within 2 % of their prices, across 3 pools.',
    )
    const ref = nb(band().textContent)
    expect(ref).toContain('$199.50')
    expect(ref).toContain('Chainlink’s answer, 30 min old at block 36,123,456')
    expect(ref).toContain('The feed’s latest round was 30 min old')
    expect(within(band()).getByText(ELIGIBILITY_LINE)).toBeTruthy()
  })

  it('gives the deepest pool’s deviation with its band, and the valuation label', async () => {
    renderAt(`/stocks/${address('NVDA')}`)
    await screen.findByRole('heading', { level: 1, name: 'NVDAc' })
    // Each fact is its label (the term), then its value.
    expect(facts()).toContain('buy side within 2 %, across 3 pools$303K')
    expect(facts()).toContain('best $10K round trip, in USDC / NVDAc, Aero Slipstream30.0 bps')
    expect(facts()).toContain(
      'USDC / NVDAc, Aero Slipstream from Chainlink’s answer, within the feed’s 0.5 % band plus the pool’s 0.05 % fee+25.06 bps',
    )
    expect(facts()).toContain(VALUATION_LABEL)
  })

  it('lists its pools in the API’s order, each with its deviation, band and pool link', async () => {
    renderAt(`/stocks/${address('NVDA')}`)
    await screen.findByRole('heading', { level: 1, name: 'NVDAc' })
    const [aero, weth, thin] = poolRows()
    expect(nb(aero?.textContent)).toContain(
      '+25.06 bpswithin the feed’s 0.5 % band plus the pool’s 0.05 % fee',
    )
    expect(nb(weth?.textContent)).toContain(
      '−125.31 bpsoutside the feed’s 0.5 % band plus the pool’s 0.3 % fee',
    )
    expect(nb(thin?.textContent)).toContain('—Too thin to compare')
    // `thin` says the side is not known to hold $5,000, not a figure no one measured.
    expect(nb(thin?.querySelector('[role="img"]')?.getAttribute('aria-label'))).toBe(
      'Unknown: Too thin to compare: the pool’s thinner side within 2 % is not known to hold $5K (it holds less, or a side has no dollar value), a price no one need correct.',
    )
    const links = poolRows().map((r) => r.querySelector('a')?.getAttribute('href'))
    expect(links).toEqual([
      `/pools/${encodeURIComponent(MOCK_STOCK_POOLS.nvdaUsdcAero)}`,
      `/pools/${encodeURIComponent(MOCK_STOCK_POOLS.nvdaWethV3)}`,
      `/pools/${encodeURIComponent(MOCK_STOCK_POOLS.nvdaUsdcV4)}`,
    ])
    expect(nb(document.querySelector('#s-venues')?.closest('section')?.textContent)).toContain(
      'Aero Slipstream holds 84 % of the depth that counts.',
    )
    const about = nb(document.querySelector('.sec-about')?.textContent)
    expect(about).toContain('1 token = 1.000538 shares')
    expect(about).toContain('8 decimals, a 24 h heartbeat, a 0.5 % deviation threshold, 24/5 hours')
    expect(
      document
        .querySelector(`.sec-about a[href="https://basescan.org/address/${address('NVDA')}"]`)
        ?.getAttribute('target'),
    ).toBe('_blank')
    expectNoTradeControls()
  })
})

describe('Stock: held, paused, without a feed, not found', () => {
  it('explains a held feed and computes no deviation', async () => {
    renderAt(`/stocks/${address('AMZN')}`)
    await screen.findByRole('heading', { level: 1, name: 'AMZNc' })
    expect(document.querySelector('.stk-ttl .status-chip')?.textContent).toBe('Off-hours')
    expect(nb(band().textContent)).toMatch(
      /The feed holds its value from \d+ \w+, \d\d:\d\d UTC, 28 h ago: its market is closed for the weekend or a holiday, or the feed stopped\. The pools are the only market now; no deviation is computed\./,
    )
    expect(facts()).toContain('deepest pool from Chainlink’s answer: Off-hours')
    expect(poolRows().map((r) => nb(r.textContent).includes('—Off-hours'))).toEqual([true, true])
  })

  it('banners paused transfers and leaves the stock’s pools out of the sums', async () => {
    renderAt(`/stocks/${address('TSLA')}`)
    await screen.findByRole('heading', { level: 1, name: 'TSLAc' })
    const chips = [...document.querySelectorAll('.stk-ttl .status-chip')].map((c) => c.textContent)
    expect(chips).toEqual(['Live', 'Transfers paused'])
    expect(within(band()).getByRole('note').textContent).toBe(
      'Transfers of TSLAc are paused: every swap in its pools reverts. Their depth is shown as measured and left out of the totals.',
    )
    expect(nb(document.querySelector('.answer')?.textContent)).toBe(
      'TSLAc’s transfers are paused: every swap in its pool reverts, so no depth of it counts.',
    )
    expect(facts()).toContain('deepest pool from Chainlink’s answer: No pool')
    const [row] = poolRows()
    // Its deviation is kept: it describes the pool's price, though no swap can use it.
    expect(nb(row?.textContent)).toContain('+40.16 bps')
    expect(nb(row?.textContent)).toContain('Transfers pausedleft out of the sums')
  })

  it('says where each pool stands in the sums from the API’s counted and sides', async () => {
    // As the API answers a counted pool with an unpriced side, and a hooked pool (tracked through
    // --pool, so unrated `hooked`) whose snapshot found the stock's transfers paused.
    renderAt(`/stocks/${address('NVDA')}`, (d) => {
      const [aero, weth, thin] = d.pools
      if (!aero || !weth || !thin?.reference) throw new Error('the mock lost an NVDAc pool')
      const hooked = {
        ...thin,
        counted: false,
        pool: { ...thin.pool, health: { ...thin.pool.health, unratedReason: 'hooked' as const } },
        reference: { ...thin.reference, transfersPaused: true },
      }
      return { ...d, sidesKnownPools: 1, pools: [aero, { ...weth, depth2BuyUsd: null }, hooked] }
    })
    await screen.findByRole('heading', { level: 1, name: 'NVDAc' })
    expect(nb(document.querySelector('#s-pools')?.closest('section')?.textContent)).toContain(
      '3 scored pools, 1 in the depth sums.',
    )
    const sums = poolRows().map((r) => nb(r.lastElementChild?.textContent))
    expect(sums).toEqual([
      'Counted',
      'Counted, one side unpriced: not in the depth sums',
      'Transfers pausedleft out of the sums',
    ])
  })

  it('says a stock without a feed has no reference', async () => {
    renderAt(`/stocks/${address('COIN')}`)
    await screen.findByRole('heading', { level: 1, name: 'COINc' })
    expect(document.querySelector('.stk-ttl .status-chip')?.textContent).toBe('No feed')
    expect(band().textContent).toContain('records no Chainlink feed for this stock')
    expect(nb(document.querySelector('.answer')?.textContent)).toBe(
      'Depthwatch scores no pool of COINc yet.',
    )
  })

  it('answers a token off the stock list, or a malformed address, as not found', async () => {
    for (const path of [`/stocks/0x${'ab'.repeat(20)}`, '/stocks/NVDAc']) {
      renderAt(path)
      expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('stock not found')
      expect(screen.getByRole('link', { name: 'Browse stocks' }).getAttribute('href')).toBe(
        '/stocks',
      )
      cleanup()
    }
  })
})
