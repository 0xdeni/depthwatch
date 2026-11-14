import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { createMockClient } from '../api/mock.js'
import type { ApiClient } from '../api/types.js'
import { FIRST_VIEW_KEY } from '../lib/firstView.js'
import { DRAW_FAILED, RootErrorBoundary } from './ErrorBoundary.js'
import { isInAppHref, routeIntentOf } from './Layout.js'
import { DOCK_QUERY } from './shell/Dock.js'
import { navName } from './shell/Nav.js'

const NOW = 1_760_000_000
const NB = ' '

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

function renderAt(
  path: string,
  opts: { demo?: boolean; mock?: boolean; dataNow?: number; client?: ApiClient } = {},
) {
  const client = opts.client ?? createMockClient({ now: NOW })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers
      client={client}
      mock={opts.mock ?? opts.demo !== true}
      demo={opts.demo}
      dataNow={opts.dataNow}
      queryClient={queryClient}
    >
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

const nav = () => screen.getByRole('navigation', { name: 'Primary' })
/** A link's accessible name: its aria-label where it has short and long words, else its text. */
const nameOf = (a: HTMLElement) => a.getAttribute('aria-label') ?? a.textContent
const current = () =>
  within(nav())
    .getAllByRole('link')
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map(nameOf)
/** The mock world without a registered mandate. */
function noMandates(): ApiClient {
  return { ...createMockClient({ now: NOW }), scorecards: async () => ({ items: [] }) }
}

describe('shell landmarks and wayfinding', () => {
  it('starts with a skip link that moves focus to <main>', () => {
    renderAt('/methodology')
    const focusable = document.body.querySelectorAll('a[href], button')
    expect(focusable[0]?.textContent).toBe('Skip to content')
    const main = screen.getByRole('main')
    main.scrollIntoView = vi.fn()
    fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }))
    expect(document.activeElement).toBe(main)
    expect(main.getAttribute('tabindex')).toBe('-1')
  })

  it('links the wordmark home and lists Pools, Stocks, Gaps, Scorecards and Methodology in one nav', async () => {
    renderAt('/gaps')
    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(1)
    const home = screen.getAllByRole('link', { name: 'Depthwatch home' })
    expect(home.map((a) => a.getAttribute('href'))).toEqual(['/', '/'])
    await within(nav()).findByRole('link', { name: 'Scorecards (Scores)' })
    const links = within(nav()).getAllByRole('link')
    expect(links.map(nameOf)).toEqual([
      'Pools',
      'Stocks',
      'Gaps',
      'Scorecards (Scores)',
      'Methodology',
    ])
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/pools',
      '/stocks',
      '/gaps',
      '/mm',
      '/methodology',
    ])
    expect(current()).toEqual(['Gaps'])
    expect(nav().querySelector('.nav-ind')?.getAttribute('aria-hidden')).toBe('true')
    // The strip's short words (shell.css shows them below 425 px); the name stays whole.
    const method = within(nav()).getByRole('link', { name: 'Methodology' })
    expect(method.querySelector('.nav-long')?.textContent).toBe('Methodology')
    expect(method.querySelector('.nav-short')?.textContent).toBe('Method')
    expect(within(nav()).getByRole('link', { name: 'Pools' }).hasAttribute('aria-label')).toBe(
      false,
    )
  })

  it('names each tab with the words it shows at every width (label in name)', async () => {
    renderAt('/gaps')
    await within(nav()).findByRole('link', { name: 'Scorecards (Scores)' })
    for (const a of within(nav()).getAllByRole('link')) {
      const name = nameOf(a)?.toLowerCase() ?? ''
      const shown = [...a.querySelectorAll('.nav-long, .nav-short')].map((s) => s.textContent)
      for (const words of shown.length ? shown : [a.textContent])
        expect(name, `${name} holds ${words}`).toContain(words?.toLowerCase())
    }
    expect(navName({ to: '/mm', label: 'Scorecards', short: 'Scores' })).toBe('Scorecards (Scores)')
    expect(navName({ to: '/methodology', label: 'Methodology', short: 'Method' })).toBe(
      'Methodology',
    )
    expect(navName({ to: '/pools', label: 'Pools' })).toBeUndefined()
  })

  it('keeps Scorecards in the nav and its Home block while a server’s list of mandates loads', async () => {
    const client: ApiClient = {
      ...createMockClient({ now: NOW }),
      scorecards: () => new Promise(() => {}),
    }
    renderAt('/', { client })
    expect(within(nav()).getAllByRole('link').map(nameOf)).toContain('Scorecards (Scores)')
    await screen.findByRole('heading', { level: 1 })
    expect(document.getElementById('home-mm')).not.toBeNull()
  })

  it('leaves Scorecards out while a static bundle built without a mandate loads', () => {
    vi.stubEnv('DW_SHIPPED_MANDATES', '0')
    const client: ApiClient = {
      ...createMockClient({ now: NOW }),
      scorecards: () => new Promise(() => {}),
    }
    renderAt('/', { client })
    expect(within(nav()).getAllByRole('link').map(nameOf)).not.toContain('Scorecards (Scores)')
    expect(document.getElementById('home-mm')).toBeNull()
  })

  it('leaves Scorecards out of the nav while no mandate is registered; its page stays', async () => {
    renderAt('/mm', { client: noMandates() })
    expect(await screen.findByRole('heading', { level: 1, name: 'scorecards' })).toBeTruthy()
    await waitFor(() =>
      expect(within(nav()).getAllByRole('link').map(nameOf)).toEqual([
        'Pools',
        'Stocks',
        'Gaps',
        'Methodology',
      ]),
    )
    expect(current()).toEqual([])
  })

  it('keeps Pools current on pool and token pages and marks nothing on Home', () => {
    renderAt(
      `/pools/${encodeURIComponent('uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224')}`,
    )
    expect(current()).toEqual(['Pools'])
    cleanup()
    renderAt('/tokens/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
    expect(current()).toEqual(['Pools'])
    cleanup()
    renderAt('/')
    expect(current()).toEqual([])
  })

  it('makes Stocks current on the list and on a stock’s page, and nothing else', () => {
    renderAt('/stocks')
    expect(current()).toEqual(['Stocks'])
    cleanup()
    renderAt('/stocks/0xb26e766461630000000000000000000000000000')
    expect(current()).toEqual(['Stocks'])
  })
})

describe('route changes', () => {
  it('moves focus to <main> after a keyboard navigation, not after a pointer one', async () => {
    renderAt('/methodology')
    const main = screen.getByRole('main')
    fireEvent.click(within(nav()).getByRole('link', { name: 'Gaps' }), { detail: 1 })
    await waitFor(() => expect(current()).toEqual(['Gaps']))
    expect(document.activeElement).not.toBe(main)
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0)
    fireEvent.click(await within(nav()).findByRole('link', { name: 'Scorecards (Scores)' }), {
      detail: 0,
    })
    await waitFor(() => expect(current()).toEqual(['Scorecards (Scores)']))
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('animates only pointer clicks on in-app links with the primary button (§4 row 6)', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/pools')
    const span = document.createElement('span')
    a.append(span)
    document.body.append(a)
    const click = (init: MouseEventInit) => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
      Object.defineProperty(e, 'target', { value: span })
      return e
    }
    expect(routeIntentOf(click({ detail: 1 }), false)).toBe('pointer')
    expect(routeIntentOf(click({ detail: 0 }), false)).toBe('keyboard')
    expect(routeIntentOf(click({ detail: 1 }), true)).toBe('instant')
    expect(routeIntentOf(click({ detail: 1, metaKey: true }), false)).toBeNull()
    expect(routeIntentOf(click({ detail: 1, button: 1 }), false)).toBeNull()
    a.setAttribute('target', '_blank')
    expect(routeIntentOf(click({ detail: 1 }), false)).toBeNull()
    a.remove()
    expect(isInAppHref('#/pools')).toBe(true)
    expect(isInAppHref('/AGENTS.md')).toBe(true)
    expect(isInAppHref('//evil.example')).toBe(false)
    expect(isInAppHref('https://github.com/0xdeni/depthwatch')).toBe(false)
  })
})

function Broken(): never {
  throw new Error('broken')
}

describe('a page that fails to draw (§5.12 ST3)', () => {
  /** Pools whose token0 is missing, as a corrupted response would have them. */
  function brokenPools(): ApiClient {
    const mock = createMockClient({ now: NOW })
    return {
      ...mock,
      pools: async (query) => {
        const page = await mock.pools(query)
        const items = page.items.map((p) => ({ ...p, pool: { ...p.pool, token0: null as never } }))
        return { ...page, items }
      },
    }
  }

  it('replaces only the route, keeps the chrome, and draws again after a navigation', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      renderAt('/pools', { client: brokenPools() })
      const title = await screen.findByRole('heading', { level: 1, name: DRAW_FAILED })
      const failed = title.closest('[role="alert"]') as HTMLElement
      expect(failed.closest('main')).not.toBeNull()
      expect(within(failed).getByRole('link', { name: 'Pools' }).getAttribute('href')).toBe(
        '/pools',
      )
      expect(within(nav()).getAllByRole('link').length).toBeGreaterThan(3)
      expect(screen.getByRole('contentinfo')).toBeTruthy()
      fireEvent.click(within(nav()).getByRole('link', { name: 'Methodology' }), { detail: 0 })
      await waitFor(() => expect(current()).toEqual(['Methodology']))
      expect(screen.queryByRole('heading', { name: DRAW_FAILED })).toBeNull()
      expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('')
      // A navigation that fails shows it again.
      fireEvent.click(within(nav()).getByRole('link', { name: 'Pools' }), { detail: 0 })
      expect(await screen.findByRole('heading', { level: 1, name: DRAW_FAILED })).toBeTruthy()
    } finally {
      quiet.mockRestore()
    }
  })

  it('replaces the whole app with Reload when it fails outside the routes', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(
        <RootErrorBoundary>
          <Broken />
        </RootErrorBoundary>,
      )
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DRAW_FAILED)
      expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
      expect(screen.getByRole('main')).toBeTruthy()
    } finally {
      quiet.mockRestore()
    }
  })
})

describe('freshness (§5.1, ia-v3 §3.2)', () => {
  it('shows the circle and the block, named by its words and "updated 2 min ago", and opens the details', async () => {
    renderAt('/methodology', { demo: true, dataNow: NOW + 120 })
    const button = await screen.findByRole('button', {
      name: new RegExp(`^Block \\d{1,3}(,\\d{3})+, updated 2${NB}min ago$`),
    })
    expect(button.textContent).toMatch(/^Block \d{1,3}(,\d{3})+$/)
    // Its name starts with what it shows (WCAG 2.5.3).
    expect(button.getAttribute('aria-label')?.startsWith(`${button.textContent},`)).toBe(true)
    expect(button.querySelector('.fresh-dot')?.className).toBe('fresh-dot')
    expect(button.querySelector('.eyebrow')?.textContent).toBe(button.textContent)
    expect(button.querySelector('.fresh-dot')?.getAttribute('aria-hidden')).toBe('true')
    expect(button.getAttribute('title')).toMatch(
      /^Block \d{1,3}(,\d{3})+, [\d,]+ of [\d,]+ pools tracked, /,
    )
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button, { detail: 0 })
    const pop = screen.getByRole('dialog', { name: 'Data freshness' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const rows = [...pop.querySelectorAll('dt')].map((dt) => dt.textContent)
    expect(rows).toEqual(['Updated', 'Block', 'Pools tracked', 'Snapshot'])
    expect(within(pop).getByText(/^\d{1,3}(,\d{3})+$/)).toBeTruthy()
    expect(within(pop).getByText(/^[\d,]+ of [\d,]+$/)).toBeTruthy()
    expect(within(pop).getByText(/UTC$/)).toBeTruthy()
    // Escape closes it and returns focus to the trigger.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Data freshness' })).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('reads "Offline" with the error and a Retry when the health check fails (ST7)', async () => {
    const base = createMockClient({ now: NOW })
    const health = vi.fn(() => Promise.reject(new Error('down')))
    renderAt('/methodology', { client: { ...base, health } })
    const button = await screen.findByRole('button', { name: 'Offline: data freshness' })
    expect(button.textContent).toBe('Offline')
    fireEvent.click(button, { detail: 0 })
    const pop = screen.getByRole('dialog', { name: 'Data freshness' })
    expect(pop.textContent).toContain('Unable to reach the API')
    const calls = health.mock.calls.length
    await act(async () => {
      fireEvent.click(within(pop).getByRole('button', { name: 'Retry' }))
    })
    expect(health.mock.calls.length).toBeGreaterThan(calls)
  })
})

describe('demo line and footer (ia-v3 §3.1, §3.3)', () => {
  it('says "Demo data" once, with the full sentence behind "About the demo"', () => {
    renderAt('/', { demo: true })
    const note = screen.getByRole('note', { name: 'Data source' })
    expect(note.textContent).toMatch(/^Demo data: a synthetic week of Base/)
    fireEvent.click(within(note).getByRole('button', { name: 'About the demo' }), { detail: 1 })
    expect(screen.getByRole('dialog', { name: 'About the demo' }).textContent).toBe(
      'Every number comes from the real pipeline run over a simulated week of Base.',
    )
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText('Data: a synthetic demo world')).toBeTruthy()
  })

  it('reads "In-repo mock data" in mock mode and shows no demo line for live data', () => {
    renderAt('/mm')
    expect(screen.getByRole('note', { name: 'Data source' }).textContent).toMatch(
      /^In-repo mock data/,
    )
    expect(within(screen.getByRole('contentinfo')).getByText('Data: the in-repo mock')).toBeTruthy()
    cleanup()
    renderAt('/mm', { mock: false })
    expect(screen.queryByRole('note')).toBeNull()
    expect(within(screen.getByRole('contentinfo')).getByText('Data: Base mainnet')).toBeTruthy()
  })

  it('carries the promise, the independence line in plain text and the Methodology, API and GitHub links', () => {
    renderAt('/mm')
    const footer = screen.getByRole('contentinfo')
    expect(footer.querySelector('.foot-say')?.textContent).toBe(
      'Open source and read-only. No token, no custody. It indexes Uniswap, Aerodrome and Aero pools on Base mainnet. Independent: not affiliated with or endorsed by Base. Data: the in-repo mock.',
    )
    expect(footer.textContent).not.toMatch(/Built on Base/)
    expect(footer.querySelector('img, svg[aria-label]')).toBeNull()
    const href = (name: string) => within(footer).getByRole('link', { name }).getAttribute('href')
    expect(href('Methodology')).toBe('/methodology')
    expect(href('API')).toBe('/AGENTS.md')
    expect(href('GitHub')).toBe('https://github.com/0xdeni/depthwatch')
    expect(footer.textContent).not.toContain('·')
    expect(footer.textContent).not.toMatch(/partner/i)
  })
})

describe('the first view (§4.1)', () => {
  let calls: { keyframes: Keyframe[]; options: KeyframeEffectOptions }[]
  beforeEach(() => {
    window.sessionStorage.clear()
    calls = []
    Element.prototype.animate = function animate(keyframes, options) {
      calls.push({
        keyframes: keyframes as Keyframe[],
        options: options as KeyframeEffectOptions,
      })
      return { cancel() {}, startTime: null } as unknown as Animation
    }
  })
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate')
    window.sessionStorage.clear()
  })

  it('plays once per session on the landing route, by 450 ms, and never on a route change', async () => {
    // Not found's title section opts into the timeline (`data-rise`, `data-in`).
    renderAt('/nowhere')
    await waitFor(() => expect(window.sessionStorage.getItem(FIRST_VIEW_KEY)).toBe('1'))
    expect(document.documentElement.hasAttribute('data-first-view')).toBe(false)
    const first = calls.length
    expect(first).toBeGreaterThan(0)
    for (const c of calls)
      expect(Number(c.options.delay ?? 0) + Number(c.options.duration)).toBeLessThanOrEqual(450)
    fireEvent.click(within(nav()).getByRole('link', { name: 'Gaps' }), { detail: 0 })
    await waitFor(() => expect(current()).toEqual(['Gaps']))
    expect(calls).toHaveLength(first)
    cleanup()
    // A new load in the same session does not play it again.
    renderAt('/gaps')
    await screen.findByRole('heading', { level: 1 })
    expect(calls).toHaveLength(first)
  })

  it('replays with ?replay=1', async () => {
    window.sessionStorage.setItem(FIRST_VIEW_KEY, '1')
    renderAt('/nowhere?replay=1')
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
  })
})

describe('the dock (§5.1, PH3)', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('stays out of a browser tab and replaces the tab strip in an installed app', async () => {
    renderAt('/gaps')
    expect(document.querySelector('.dock')).toBeNull()
    cleanup()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: q === DOCK_QUERY,
        addEventListener() {},
        removeEventListener() {},
      }),
    })
    renderAt('/gaps')
    const dock = document.querySelector('nav.dock') as HTMLElement
    expect(dock.getAttribute('aria-label')).toBe('Primary')
    await within(dock).findByRole('link', { name: 'Scorecards (Scores)' })
    const tabs = within(dock).getAllByRole('link')
    // Five tabs share 288 px at 320 px (57.6 px each): Scorecards and Methodology go short, and
    // each link's name holds both its full and its short words.
    expect(tabs.map((a) => a.textContent)).toEqual(['Pools', 'Stocks', 'Gaps', 'Scores', 'Method'])
    for (const a of tabs) expect(nameOf(a)?.toLowerCase()).toContain(a.textContent?.toLowerCase())
    expect(tabs.map((a) => a.getAttribute('aria-current'))).toEqual([
      null,
      null,
      'page',
      null,
      null,
    ])
    expect(within(dock).getByRole('link', { name: 'Methodology' })).toBeTruthy()
    expect(within(dock).getByRole('link', { name: 'Scorecards (Scores)' })).toBeTruthy()
    cleanup()
    // Four tabs once the list says no mandate is registered.
    renderAt('/gaps', { client: noMandates() })
    const dockLinks = () =>
      within(document.querySelector('nav.dock') as HTMLElement).getAllByRole('link')
    await waitFor(() =>
      expect(dockLinks().map((a) => a.textContent)).toEqual(['Pools', 'Stocks', 'Gaps', 'Method']),
    )
  })
})
