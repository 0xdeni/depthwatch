/**
 * "trade in this pool": shown under cost to trade only when the static bundle's switch is on for
 * the pool's venue and the pool is one the panel can check (`tradeGate`); never in demo, mock or
 * connecting mode, and never for a tokenized stock's pool. Before the click it shows the
 * snapshot's figure, labelled as the snapshot's, with its time; nothing here loads wallet code
 * before a click (jsdom has no IntersectionObserver and these tests send no pointer events), and
 * the click loads the lazy panel, its loading lines keeping the row's resting height.
 */
import type { TradeFlags } from '@depthwatch/core'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, type NavigateFunction, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../../App.js'
import { createMockClient, MOCK_STOCK_POOLS } from '../../api/mock.js'
import type { ApiClient, PoolDetail, PoolMetaDto } from '../../api/types.js'
import { full } from '../../lib/format.js'
import { expectNoTradeControls } from '../../testing/noTrade.js'
import { tradeTakeaway } from './TradeSection.js'
import { tradeGate } from './tradeGate.js'

const NOW = 1_760_000_000
const V3 = 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224'
const SLIPSTREAM = 'aerodrome-slipstream:0xb2cc224c1c9fee385f8ad6a55b4d94e92359dc59'
/** Another tradeable pool of the same venue: cbETH/WETH. */
const OTHER_V3 = 'uniswap-v3:0x10648ba41b8565907cfa1496765fa4d95390aa0d'
const ON: TradeFlags = { enabled: true, venues: ['uniswap-v3'], maxUsd: 1000, maxSlippageBps: 300 }
const base = createMockClient({ now: NOW })
const v3 = await base.pool(V3)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('tradeGate', () => {
  const env = { mock: false, trade: ON }
  const at = (patch: Partial<PoolDetail>, meta: Partial<PoolMetaDto> = {}) => ({
    ...v3,
    ...patch,
    pool: { ...v3.pool, ...meta },
  })

  it('opens for a rated, fresh, unhooked pool of an enabled venue with allowlisted tokens', () => {
    expect(tradeGate(v3, env)).toEqual({ venue: 'uniswap-v3', flags: ON })
  })

  it('stays shut in demo, mock and connecting mode, and without a switch that is on', () => {
    expect(tradeGate(v3, { ...env, demo: true })).toBeNull()
    expect(tradeGate(v3, { ...env, mock: true })).toBeNull()
    expect(tradeGate(v3, { ...env, connecting: true })).toBeNull()
    expect(tradeGate(v3, { mock: false })).toBeNull()
    expect(tradeGate(v3, { mock: false, trade: null })).toBeNull()
    expect(tradeGate(v3, { mock: false, trade: { ...ON, enabled: false } })).toBeNull()
    expect(
      tradeGate(v3, { mock: false, trade: { ...ON, venues: ['aerodrome-slipstream'] } }),
    ).toBeNull()
  })

  it('stays shut for a held venue, whatever the switch says', () => {
    const aero = at({}, { dex: 'aero-slipstream' })
    expect(
      tradeGate(aero, { mock: false, trade: { ...ON, venues: ['aero-slipstream'] } }),
    ).toBeNull()
  })

  it('stays shut for a hooked, unrated, unsnapshotted or stale pool, or a token off the list', () => {
    const hooks = '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c40'
    expect(tradeGate(at({}, { hooks }), env)).toBeNull()
    expect(tradeGate(at({ score: v3.score && { ...v3.score, rated: false } }), env)).toBeNull()
    expect(tradeGate(at({ latest: null }), env)).toBeNull()
    expect(
      tradeGate(at({ latest: v3.latest && { ...v3.latest, priceDeviationBps: 900 } }), env),
    ).toBeNull()
    const other = {
      ...v3.pool.token1,
      address: '0x000000000000000000000000000000000000beef' as const,
    }
    expect(tradeGate(at({}, { token1: other }), env)).toBeNull()
    expect(tradeGate(at({}, { kind: 'constant-product' }), env)).toBeNull()
  })
})

describe('tradeGate and tokenized stocks (docs/design/stocks-api.md §3)', () => {
  it('never opens for a stock pool, even rated, fresh and unhooked on an enabled venue', async () => {
    const stock = await base.pool(MOCK_STOCK_POOLS.nvdaWethV3)
    // Everything the gate checks holds but the allowlist: the stock is on no trade list.
    expect(stock.pool.dex).toBe('uniswap-v3')
    expect(stock.pool.kind).toBe('concentrated')
    expect(stock.score?.rated).toBe(true)
    expect(stock.latest?.reference).not.toBeNull()
    expect(tradeGate(stock, { mock: false, trade: ON })).toBeNull()
    expect(
      tradeGate(stock, {
        mock: false,
        trade: { ...ON, venues: ['uniswap-v3', 'aero-slipstream'] },
      }),
    ).toBeNull()
  })

  it('shows no trade section on a stock pool’s page with the switch on', async () => {
    await renderPage(MOCK_STOCK_POOLS.nvdaWethV3, ON)
    expect(headings()).toContain('tokenized stock')
    expect(headings()).not.toContain('trade in this pool')
    expect(screen.queryByRole('button', { name: 'Swap in this pool' })).toBeNull()
    expectNoTradeControls()
  })
})

describe('tradeTakeaway', () => {
  const withSpread = (spreadBps: number, feasible = true) => ({
    ...v3,
    latest: v3.latest && {
      ...v3.latest,
      spreads: v3.latest.spreads.map((s) =>
        s.notionalUsd === 10_000 ? { ...s, spreadBps, feasible } : s,
      ),
    },
  })
  const text = (detail: PoolDetail) => tradeTakeaway(detail).replace(/\u00a0/g, ' ')

  it('gives the $10K round trip in percent and dollars, as the panel does, then its bps', () => {
    expect(text(withSpread(14.8))).toMatch(
      /round trip here cost 0\.15 %, about \$15 \(14\.8 bps\)\.$/,
    )
    expect(text(withSpread(2.4))).toMatch(/cost 0\.024 %, about \$2 \(2\.4 bps\)\.$/)
    expect(text(withSpread(123))).toMatch(/cost 1\.2 %, about \$123 \(123 bps\)\.$/)
  })

  it('says the figure is the snapshot’s, with its time, and not live', () => {
    expect(text(withSpread(14.8))).toBe(
      `Snapshot of ${full(v3.latest?.timestamp).replace(/\u00a0/g, ' ')}, not live: a $10K round trip here cost 0.15 %, about $15 (14.8 bps).`,
    )
  })

  it('says no round trip was measured rather than repeat the body’s first sentence', () => {
    expect(text(withSpread(14.8, false))).toBe(
      'The latest snapshot measured no $10K round trip here.',
    )
  })
})

function renderPage(
  id: string,
  flags: TradeFlags | null,
  opts: { mock?: boolean; demo?: boolean } = {},
) {
  const client: ApiClient = base
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers
      client={client}
      mock={opts.mock ?? false}
      demo={opts.demo}
      trade={flags}
      queryClient={queryClient}
    >
      <MemoryRouter initialEntries={[`/pools/${encodeURIComponent(id)}`]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
  return screen.findByRole('heading', { level: 1 })
}

let navigate: NavigateFunction = () => undefined
/** Hands the test the router's `navigate`. */
function Probe() {
  navigate = useNavigate()
  return null
}

const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

describe('the pool page', () => {
  it('shows the section under cost to trade, with the snapshot’s figure and its time', async () => {
    await renderPage(V3, ON)
    const list = headings()
    expect(list.indexOf('trade in this pool')).toBe(list.indexOf('cost to trade') + 1)
    const section = screen.getByRole('region', { name: 'trade in this pool' })
    const text = (section.textContent ?? '').replace(/ /g, ' ')
    expect(text).toContain(
      `Snapshot of ${full(v3.latest?.timestamp).replace(/ /g, ' ')}, not live: a $10K round trip here cost`,
    )
    // The intro is three short facts, custody first.
    expect(
      within(section)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Non-custodial: you swap from your own wallet and sign each step.',
      'Direct: the swap goes to the DEX’s own contract; Depthwatch adds no fee.',
      'Live prices: read through your wallet once you connect it.',
    ])
    expect(within(section).getByRole('button', { name: 'Swap in this pool' })).toBeTruthy()
  })

  it('has no section when the switch is off, the venue is not on, or in mock and demo mode', async () => {
    for (const [id, flags, opts] of [
      [V3, null, {}],
      [V3, { ...ON, enabled: false }, {}],
      [SLIPSTREAM, ON, {}],
      [V3, ON, { mock: true }],
      [V3, ON, { demo: true }],
    ] as const) {
      await renderPage(id, flags, opts)
      expect(headings(), JSON.stringify([id, flags, opts])).not.toContain('trade in this pool')
      cleanup()
    }
  })

  it('loads the panel only on the click, which then looks for wallets', async () => {
    await renderPage(V3, ON)
    expect(screen.queryByRole('heading', { name: 'Connect a wallet' })).toBeNull()
    const slot = screen
      .getByRole('region', { name: 'trade in this pool' })
      .querySelector<HTMLElement>('.pool-trade')
    if (!slot) throw new Error('no trade slot')
    slot.getBoundingClientRect = () => ({ height: 312.5 }) as DOMRect
    fireEvent.click(screen.getByRole('button', { name: 'Swap in this pool' }))
    expect(screen.getByRole('status').textContent).toBe('Loading the swap panel…')
    // The loading line keeps the row's resting height, so the page below holds still.
    expect(screen.getByRole('status').style.minHeight).toBe('312.5px')
    // The button that had focus is gone: the loading line takes it.
    expect(document.activeElement).toBe(screen.getByRole('status'))
    // The panel, loaded, shows the same line until its first look for wallets ends, as tall.
    const panelLine = () => slot.querySelector<HTMLElement>('.trade [role="status"]')
    await waitFor(() => expect(panelLine()).not.toBeNull(), { timeout: 10_000 })
    expect(panelLine()?.textContent).toBe('Loading the swap panel…')
    expect(panelLine()?.style.minHeight).toBe('312.5px')
    // The first import of the chunk is transformed on the fly here, hence the longer wait.
    const heading = await screen.findByRole(
      'heading',
      { name: 'Connect a wallet' },
      { timeout: 10_000 },
    )
    expect(document.activeElement).toBe(heading)
    expect(await screen.findByText(/No wallet was found in this browser/)).toBeTruthy()
    // The panel takes its own height: the resting one went with the loading line.
    expect(slot.style.minHeight).toBe('')
    expect(slot.querySelector('[style*="min-height"]')).toBeNull()
  })

  it('closes the panel when the page moves to another pool, which ends its run', async () => {
    // jsdom has no scrolling; the router scrolls to the top on each page.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <Providers client={base} mock={false} trade={ON} queryClient={queryClient}>
        <MemoryRouter initialEntries={[`/pools/${encodeURIComponent(OTHER_V3)}`]}>
          <AppRoutes />
          <Probe />
        </MemoryRouter>
      </Providers>,
    )
    const title = async (text: RegExp) =>
      waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(text))
    await title(/cbETH/)
    act(() => navigate(`/pools/${encodeURIComponent(V3)}`))
    await title(/USDC/)
    fireEvent.click(screen.getByRole('button', { name: 'Swap in this pool' }))
    await screen.findByRole('heading', { name: 'Connect a wallet' }, { timeout: 10_000 })
    // Back to the first pool, still in the cache: its page draws at once, with the panel closed.
    act(() => navigate(-1))
    await title(/cbETH/)
    expect(screen.queryByRole('heading', { name: 'Connect a wallet' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Swap in this pool' })).toBeTruthy()
  })
})
