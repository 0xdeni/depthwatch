/**
 * Every route of ia-v3 §2 renders inside the shell (one h1 inside <main>, the right nav item
 * current) on the browser router, and the static build's hash router keeps its links in the hash.
 * Screen contents are pinned by each page's own tests.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { App, AppRoutes, createQueryClient, Providers, shouldRetry } from './App.js'
import { ApiError } from './api/errors.js'
import { createMockClient } from './api/mock.js'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const POOL = 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224'
const TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
/** The mock's NVDAc. */
const STOCK = '0xb26e766461630000000000000000000000000000'

function renderAt(path: string) {
  const client = createMockClient({ now: 1_760_000_000 })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client} mock queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

/** The current nav item's name (Scorecards joins the nav once the mock's mandates are in). */
function currentNav(): string[] {
  return within(screen.getByRole('navigation', { name: 'Primary' }))
    .getAllByRole('link')
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.getAttribute('aria-label') ?? a.textContent ?? '')
}

const ROUTES: ReadonlyArray<readonly [string, string | null]> = [
  ['/', null],
  ['/pools', 'Pools'],
  [`/pools/${encodeURIComponent(POOL)}`, 'Pools'],
  ['/gaps', 'Gaps'],
  [`/tokens/${TOKEN}`, 'Pools'],
  ['/stocks', 'Stocks'],
  [`/stocks/${STOCK}`, 'Stocks'],
  ['/mm', 'Scorecards (Scores)'],
  ['/methodology', 'Methodology'],
  ['/nowhere', null],
]

describe('routes (ia-v3 §2)', () => {
  for (const [path, nav] of ROUTES) {
    it(`renders ${path} in the shell with one h1 in <main>`, async () => {
      renderAt(path)
      const main = screen.getByRole('main')
      const h1 = await within(main).findByRole('heading', { level: 1 })
      expect(h1.textContent?.length).toBeGreaterThan(0)
      expect(within(main).getAllByRole('heading', { level: 1 })).toHaveLength(1)
      expect(screen.getByRole('banner')).toBeTruthy()
      expect(screen.getByRole('contentinfo')).toBeTruthy()
      await waitFor(() => expect(currentNav()).toEqual(nav ? [nav] : []))
    })
  }

  it('renders a scorecard route', async () => {
    const client = createMockClient({ now: 1_760_000_000 })
    const { items } = await client.scorecards()
    const id = items[0]?.mandate.id
    if (!id) throw new Error('the mock world has no mandate')
    renderAt(`/mm/${encodeURIComponent(id)}`)
    expect(await within(screen.getByRole('main')).findByRole('heading', { level: 1 })).toBeTruthy()
    await waitFor(() => expect(currentNav()).toEqual(['Scorecards (Scores)']))
  })

  it('says what was not found for an unknown path', async () => {
    renderAt('/nowhere')
    const h1 = await screen.findByRole('heading', { level: 1 })
    expect(h1.textContent).toMatch(/not found/i)
  })
})

describe('static build (docs/design/web-v2.md §4)', () => {
  it('routes from the URL hash and keeps every in-app link inside it', async () => {
    window.location.hash = '#/gaps'
    render(<App client={createMockClient({ now: 1_760_000_000 })} mock={false} staticBuild />)
    expect(currentNav()).toEqual(['Gaps'])
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Pools' }).getAttribute('href')).toBe('#/pools')
    expect(screen.getAllByRole('link', { name: 'Depthwatch home' })[0]?.getAttribute('href')).toBe(
      '#/',
    )
    expect(await within(screen.getByRole('main')).findByRole('heading', { level: 1 })).toBeTruthy()
  })
})

describe('query retries', () => {
  it('retries a network or server failure once and never an API 4xx answer', () => {
    expect(shouldRetry(0, new TypeError('fetch failed'))).toBe(true)
    expect(shouldRetry(0, new ApiError(503, 'unavailable'))).toBe(true)
    expect(shouldRetry(1, new ApiError(503, 'unavailable'))).toBe(false)
    expect(shouldRetry(0, new ApiError(404, 'pool not found'))).toBe(false)
    expect(shouldRetry(0, new ApiError(400, 'invalid query'))).toBe(false)
  })

  it('shows a missing pool without waiting for a retry', async () => {
    const client = createMockClient({ now: 1_760_000_000 })
    render(
      <Providers client={client} mock queryClient={createQueryClient()}>
        <MemoryRouter
          initialEntries={['/pools/uniswap-v3%3A0x0000000000000000000000000000000000000001']}
        >
          <AppRoutes />
        </MemoryRouter>
      </Providers>,
    )
    const h1 = await within(screen.getByRole('main')).findByRole(
      'heading',
      { level: 1 },
      { timeout: 600 },
    )
    expect(h1.textContent).toMatch(/not found/i)
  })
})
