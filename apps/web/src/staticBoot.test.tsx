/**
 * The static build's startup (docs/design/web-v2.md §4): the bundle feeds the app on hash
 * routes, the demo banner follows `source`, a live bundle reads as a dated snapshot (its age only
 * in the banner, on the reader's clock; no "… ago" in the pages), the Embed block explains that
 * badge URLs need a server, and a missing bundle is reported instead of a blank page.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockClient } from './api/mock.js'
import type { StaticBundle } from './api/types.js'
import { dated } from './lib/format.js'
import { startStatic } from './staticBoot.js'
import { bundleFromClient } from './testing/staticBundle.js'

const NOW = 1_760_000_000
const DEMO = await bundleFromClient(createMockClient({ now: NOW }), {
  generatedAt: NOW,
  source: 'demo',
})
const MANDATE = DEMO.scorecards[0]?.mandate.id ?? ''
/** A live export of the same world, as `depthwatch export --note` writes it. */
const LIVE: StaticBundle = {
  ...DEMO,
  source: 'live',
  health: { ...DEMO.health, source: 'live' },
  note: 'The 492 largest pools by TVL, read through a free RPC plan.\n\nBRETT is priced through its WETH pools.\n',
  updates: 'several-times-a-day',
}
const AT_DATED = dated(DEMO.health.latestSnapshotAt)

let mounted: { root: Root; container: HTMLElement } | null = null

async function boot(hash: string, load: () => Promise<StaticBundle>): Promise<void> {
  window.location.hash = hash
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => {
    await startStatic(root, load)
  })
}

function unmount(): void {
  if (!mounted) return
  const { root, container } = mounted
  act(() => root.unmount())
  container.remove()
  mounted = null
}

/**
 * Everything a reader or a screen reader gets in `scope` (the whole page by default): the text
 * plus labels and native tooltips.
 */
function pageText(scope: Element = document.body): string {
  const attrs = [...scope.querySelectorAll('[aria-label], [title]')].flatMap((el) => [
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('title') ?? '',
  ])
  return [scope.textContent ?? '', ...attrs].join('\n')
}

afterEach(() => {
  unmount()
  window.location.hash = ''
  vi.useRealTimers()
})

describe('static build startup', () => {
  it('renders the routes from the URL hash with the demo banner and hash links', async () => {
    await boot('#/pools', async () => DEMO)
    expect(await screen.findByRole('table', { name: 'Pools' })).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/^Demo data: a synthetic week of Base/)
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText('Data: a synthetic demo world')).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Gaps' }).getAttribute('href')).toBe('#/gaps')
    expect(within(nav).getByRole('link', { name: 'Pools' }).getAttribute('aria-current')).toBe(
      'page',
    )
    const top = DEMO.pools[0]
    if (!top) throw new Error('empty bundle')
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('link', {
            name: (name) =>
              name.startsWith(`${top.pool.token0.symbol} / ${top.pool.token1.symbol}, `),
          })
          .map((link) => link.getAttribute('href')),
      ).toContain(`#/pools/${encodeURIComponent(top.pool.id)}`),
    )
    // Freshness reads the bundle's health.
    const fresh = await screen.findByRole('button', { name: /^Block 36,123,456, updated / })
    expect(fresh.getAttribute('title')).toMatch(/^Block 36,123,456,/)
  })

  it('opens Home on an empty hash and keeps Methodology anchors inside the hash', async () => {
    await boot('', async () => DEMO)
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^\$[\d.]+[KMB] sits within 2 % of the price across [\d,]+ pools on Base\.$/,
      }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse pools' }).getAttribute('href')).toBe('#/pools')
    expect(screen.getByRole('link', { name: 'How it’s measured' }).getAttribute('href')).toBe(
      '#/methodology',
    )
    // A glossary term's "How it is measured" link keeps its Methodology anchor inside the hash.
    const term = await screen.findByRole('button', { name: 'KPIs' })
    act(() => term.focus())
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByRole('link').getAttribute('href')).toBe('#/methodology#scorecards')
  })

  it('shows the badge preview and the server note in the Embed block', async () => {
    await boot(`#/mm/${encodeURIComponent(MANDATE)}`, async () => DEMO)
    const note = await screen.findByTestId('embed-static-note')
    expect(note.textContent).toBe(
      'Badge links need a running Depthwatch API; this static copy shows the preview only.',
    )
    expect(await screen.findByTestId('badge-preview')).toBeTruthy()
    // The command and the badge path sit in scrolling code blocks behind "Show code".
    const embed = document.getElementById('s-embed')?.closest('section') as HTMLElement
    fireEvent.click(within(embed).getAllByRole('button', { name: 'Show code' })[0] as HTMLElement)
    const code = [...embed.querySelectorAll('pre.codeblock')].map((n) => n.textContent)
    expect(code).toEqual(['depthwatch serve', `/api/mm/${MANDATE}/badge.svg`])
    expect(screen.queryByTestId('badge-url')).toBeNull()
    expect(screen.queryByText('Markdown')).toBeNull()
  })

  it('answers unknown ids with the page not-found state', async () => {
    await boot('#/pools/nope', async () => DEMO)
    // A 4xx is final (shouldRetry): the 404 state shows at once.
    expect(await screen.findByRole('heading', { name: 'pool not found' })).toBeTruthy()
    // The static copy says why a shared link can miss: the bundle only holds what was exported.
    expect(
      screen.getByText(/This static copy only holds the data it was exported with\./),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse pools' }).getAttribute('href')).toBe('#/pools')
  })

  it('states when a live bundle’s data is from, how old it is and how often it is updated', async () => {
    // The reader opens the copy 6 hours after the data was read.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(((DEMO.health.latestSnapshotAt ?? 0) + 6 * 3600 + 60) * 1000)
    await boot('#/gaps', async () => LIVE)
    expect(await screen.findByRole('heading', { level: 1, name: 'gaps' })).toBeTruthy()
    const line = screen.getByRole('note', { name: 'Data source' })
    expect(line.querySelector('.snap-wide')?.textContent).toBe(
      `Data from ${AT_DATED}, 6\u00a0h ago. Updated several times a day.`,
    )
    expect(line.querySelector('.snap-narrow')?.textContent).toMatch(
      /^Data from \d\d:\d\d\u00a0UTC, 6\u00a0h ago, updated several times a day$/,
    )
    expect(line.textContent).not.toMatch(/demo/i)
    fireEvent.click(within(line).getByRole('button', { name: 'About this snapshot' }), {
      detail: 1,
    })
    const about = screen.getByRole('dialog', { name: 'About this snapshot' })
    expect([...about.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'The 492 largest pools by TVL, read through a free RPC plan.',
      'BRETT is priced through its WETH pools.',
      `Read at block 36,123,456. Exported ${AT_DATED}.`,
    ])
    expect(
      within(screen.getByRole('contentinfo')).getByText('Data: a Base mainnet snapshot'),
    ).toBeTruthy()
    // Freshness: the block first, then the data's time and age, and no live (ok) dot.
    const fresh = await screen.findByRole('button', {
      name: `Block 36,123,456, data from ${AT_DATED}, 6\u00a0h ago`,
    })
    expect(fresh.textContent).toBe('Block 36,123,456')
    expect(fresh.querySelector('.fresh-dot')?.className).toBe('fresh-dot is-snapshot')
    fireEvent.click(fresh, { detail: 0 })
    const pop = screen.getByRole('dialog', { name: 'Data freshness' })
    expect([...pop.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Data from',
      'Block',
      'Pools tracked',
      'Exported',
    ])
  })

  it('never says "… ago" in the pages of a live snapshot, while the demo does', async () => {
    const pool = encodeURIComponent(DEMO.pools[0]?.pool.id ?? '')
    const token = DEMO.pools[0]?.pool.token0.address ?? ''
    const routes = ['#/', '#/pools', `#/pools/${pool}`, '#/gaps', `#/tokens/${token}`, '#/mm']
    routes.push(`#/mm/${encodeURIComponent(MANDATE)}`, '#/methodology')
    const ages = { live: [] as string[], demo: [] as string[] }
    const stamped: string[] = []
    for (const [name, bundle] of [
      ['live', LIVE],
      ['demo', DEMO],
    ] as const) {
      for (const route of routes) {
        await boot(route, async () => bundle)
        await screen.findByRole('heading', { level: 1 })
        const busy = () => document.querySelector('.skel, [aria-busy="true"]')
        await waitFor(() => expect(busy()).toBeNull(), { timeout: 4000 })
        // A snapshot's banner gives the data's age on the reader's clock; its pages never do.
        const scope = name === 'live' ? document.querySelector('main') : document.body
        if (/\bago\b/.test(pageText(scope ?? document.body))) ages[name].push(route)
        const main = document.querySelector('main')?.textContent ?? ''
        if (name === 'live' && /\d\d:\d\d\u00a0UTC/.test(main)) stamped.push(route)
        unmount()
      }
    }
    expect(ages.live).toEqual([])
    // The check bites: every demo page gives an age (the header's at least), and where the
    // pages themselves give one, the snapshot's give the UTC time instead.
    expect(ages.demo).toEqual(routes)
    expect(stamped).toEqual([
      '#/pools',
      `#/pools/${pool}`,
      `#/tokens/${token}`,
      `#/mm/${encodeURIComponent(MANDATE)}`,
    ])
  }, 30_000)

  it('freezes relative times of a demo bundle at its generatedAt, so it never looks stale', async () => {
    // NOW is long before the wall clock; against Date.now() this would read "… d ago".
    await boot('#/gaps', async () => DEMO)
    expect(
      await screen.findByRole('button', { name: /^Block [\d,]+, updated 1\u00a0min ago$/ }),
    ).toBeTruthy()
  })

  it('shows the shell and the route while a slow bundle loads, then the data (ST1)', async () => {
    let release: (bundle: StaticBundle) => void = () => undefined
    const slow = new Promise<StaticBundle>((resolve) => {
      release = resolve
    })
    window.location.hash = '#/gaps'
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted = { root, container }
    let started: Promise<void> = Promise.resolve()
    await act(async () => {
      started = startStatic(root, () => slow, 0)
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    // The chrome is there at once: nav, the header's "Connecting…" (no status dot), the footer.
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy()
    expect(screen.getByText('Connecting…').className).toBe('fresh is-connecting')
    expect(screen.getByRole('contentinfo')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'gaps' })).toBeTruthy()
    await act(async () => {
      release(DEMO)
      await started
    })
    expect(await screen.findByRole('button', { name: /^Block [\d,]+, updated / })).toBeTruthy()
    expect(screen.queryByText('Connecting…')).toBeNull()
    expect(screen.getByRole('note').textContent).toMatch(/^Demo data/)
  })

  it('reports a bundle that cannot be loaded', async () => {
    await boot('#/pools', async () => {
      throw new Error('could not load ./data/bundle.json: 404 Not Found')
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/^Could not load the data bundle \(\.\/data\/bundle\.json\)/)
    expect(alert.textContent).toContain('404 Not Found')
  })
})
