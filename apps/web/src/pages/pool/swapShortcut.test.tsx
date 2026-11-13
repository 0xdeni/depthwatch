/**
 * The short way to the swap (docs/design/visual-v4.md §6.4): "Swap" on the title's price line
 * wherever the trade row is shown and nowhere else; it brings the row into view, opens the panel
 * and moves focus into it, smoothly for a pointer and at once for the keyboard or reduced motion.
 * Hovering, pressing or focusing a way in, or the row coming within one viewport, warms the panel
 * (its chunk and wallet discovery) without opening anything; with Save-Data on only intent does.
 * The early discovery goes to the panel once. Opening keeps the row's resting height.
 */
import type { TradeFlags } from '@depthwatch/core'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../../App.js'
import { createMockClient } from '../../api/mock.js'
import type { ApiClient } from '../../api/types.js'
import { discoverForPanel } from './tradeIntent.js'

const discover = vi.hoisted(() => vi.fn(async () => []))
vi.mock('../../trade/wallets.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../trade/wallets.js')>()),
  discoverWallets: discover,
}))

const NOW = 1_760_000_000
const V3 = 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224'
const ON: TradeFlags = { enabled: true, venues: ['uniswap-v3'], maxUsd: 1000, maxSlippageBps: 300 }
const base = createMockClient({ now: NOW })
/** The first import of the panel's chunk is transformed on the fly here. */
const SLOW = { timeout: 10_000 }

const scroll = vi.fn()
const originalScroll = Element.prototype.scrollIntoView

beforeEach(() => {
  Element.prototype.scrollIntoView = scroll
})

afterEach(async () => {
  cleanup()
  // An early discovery a test left waiting would go to the next test's panel.
  await discoverForPanel()
  Element.prototype.scrollIntoView = originalScroll
  scroll.mockReset()
  discover.mockClear()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'matchMedia')
  Reflect.deleteProperty(navigator, 'connection')
})

function renderPage(
  flags: TradeFlags | null,
  { client = base, mock = false }: { client?: ApiClient; mock?: boolean } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client} mock={mock} trade={flags} queryClient={queryClient}>
      <MemoryRouter initialEntries={[`/pools/${encodeURIComponent(V3)}`]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
  return screen.findByRole('heading', { level: 1, name: 'WETH / USDC' })
}

const title = () => screen.getByRole('region', { name: 'WETH / USDC' })
const swap = () => within(title()).getByRole('button', { name: 'Swap' })
const tradeRow = () => screen.getByRole('region', { name: 'trade in this pool' })
const connect = () => screen.findByRole('heading', { name: 'Connect a wallet' }, SLOW)

describe('Swap on the price line', () => {
  it('sits on the price line of a tradable pool, after the price’s own text toggle', async () => {
    await renderPage(ON)
    const line = title().querySelector('.pool-line')
    const buttons = within(line as HTMLElement).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Show price in WETH', 'Swap'])
    expect(swap().className).toBe('btn primary is-sm pool-swap')
    // The toggle is words: no glyph, and its name is exactly what it shows.
    const toggle = buttons[0] as HTMLElement
    expect(toggle.querySelector('svg')).toBeNull()
    expect(toggle.getAttribute('aria-label')).toBeNull()
  })

  it('is absent when the switch is off, for a venue on hold, and in mock mode', async () => {
    const held: ApiClient = {
      ...base,
      async pool(id) {
        const detail = await base.pool(id)
        return { ...detail, pool: { ...detail.pool, dex: 'aero-slipstream' } }
      },
    }
    const cases: [TradeFlags | null, { client?: ApiClient; mock?: boolean }][] = [
      [null, {}],
      [{ ...ON, enabled: false }, {}],
      [{ ...ON, venues: ['uniswap-v3', 'aero-slipstream'] }, { client: held }],
      [ON, { mock: true }],
    ]
    for (const [flags, opts] of cases) {
      await renderPage(flags, opts)
      expect(within(title()).queryByRole('button', { name: 'Swap' }), JSON.stringify(flags)).toBe(
        null,
      )
      expect(screen.queryByRole('region', { name: 'trade in this pool' })).toBeNull()
      // The price toggle stays.
      expect(within(title()).getByRole('button', { name: /^Show price in / })).toBeTruthy()
      cleanup()
    }
  })

  it('from the keyboard: brings the row into view at once, opens the panel, focus inside', async () => {
    await renderPage(ON)
    fireEvent.click(swap(), { detail: 0 })
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    expect(scroll.mock.contexts[0]).toBe(tradeRow())
    const heading = await connect()
    expect(document.activeElement).toBe(heading)
    expect(within(tradeRow()).queryByRole('button', { name: 'Swap in this pool' })).toBeNull()
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('from a pointer: scrolls smoothly, then opens once the page has settled', async () => {
    await renderPage(ON)
    fireEvent.click(swap(), { detail: 1 })
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    // Nothing opens mid-scroll.
    expect(screen.queryByRole('heading', { name: 'Connect a wallet' })).toBeNull()
    const heading = await connect()
    expect(document.activeElement).toBe(heading)
  })

  it('with reduced motion, a pointer gets no smooth scroll', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    })
    await renderPage(ON)
    fireEvent.click(swap(), { detail: 1 })
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    const heading = await connect()
    expect(document.activeElement).toBe(heading)
  })

  it('moves focus back into a panel that is already open', async () => {
    await renderPage(ON)
    fireEvent.click(within(tradeRow()).getByRole('button', { name: 'Swap in this pool' }))
    const heading = await connect()
    heading.blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.click(swap(), { detail: 0 })
    expect(document.activeElement).toBe(heading)
  })
})

describe('warming the panel on intent', () => {
  it('loads the panel and starts wallet discovery on a press, without opening anything', async () => {
    await renderPage(ON)
    fireEvent.pointerDown(swap())
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(1), SLOW)
    expect(screen.queryByRole('heading', { name: 'Connect a wallet' })).toBeNull()
    expect(within(tradeRow()).getByRole('button', { name: 'Swap in this pool' })).toBeTruthy()
    // Opening hands the early discovery to the panel; a later look discovers afresh.
    fireEvent.click(swap(), { detail: 0 })
    await connect()
    expect(await screen.findByText(/No wallet was found in this browser/)).toBeTruthy()
    expect(discover).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Look again' }))
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
  })

  it('warms on hover or focus of “Swap in this pool” too', async () => {
    await renderPage(ON)
    fireEvent.pointerEnter(within(tradeRow()).getByRole('button', { name: 'Swap in this pool' }))
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(1))
    // One early discovery waits at a time, and the panel takes it when it opens.
    fireEvent.focus(swap())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(discover).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: 'Connect a wallet' })).toBeNull()
    fireEvent.click(swap(), { detail: 0 })
    await connect()
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('warms when the row comes within one viewport, unless the reader saves data', async () => {
    const observers: {
      options?: IntersectionObserverInit
      targets: Element[]
      fire: () => void
    }[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        targets: Element[] = []
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          const self = this as unknown as IntersectionObserver
          observers.push({
            options,
            targets: this.targets,
            fire: () => callback([{ isIntersecting: true } as IntersectionObserverEntry], self),
          })
        }
        observe(el: Element) {
          this.targets.push(el)
        }
        disconnect() {
          this.targets.length = 0
        }
      },
    )
    await renderPage(ON)
    const watched = observers.find((o) => o.targets.some((t) => t.matches('.pool-trade')))
    expect(watched?.options?.rootMargin).toBe('100% 0px')
    act(() => watched?.fire())
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('heading', { name: 'Connect a wallet' })).toBeNull()
    cleanup()

    observers.length = 0
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true },
    })
    await renderPage(ON)
    expect(observers.some((o) => o.targets.some((t) => t.matches('.pool-trade')))).toBe(false)
  })
})

describe('the trade row’s resting height', () => {
  it('is kept while the panel loads, so the page below does not jump', async () => {
    await renderPage(ON)
    const slot = tradeRow().querySelector<HTMLElement>('.pool-trade')
    if (!slot) throw new Error('no trade slot')
    expect(slot.style.minHeight).toBe('')
    slot.getBoundingClientRect = () => ({ height: 312.5 }) as DOMRect
    fireEvent.click(within(tradeRow()).getByRole('button', { name: 'Swap in this pool' }))
    expect(slot.style.minHeight).toBe('312.5px')
    await connect()
    expect(slot.style.minHeight).toBe('312.5px')
  })
})
