/**
 * The header shell of index.html: markup inside #root that paints the banner before any script
 * runs, which the app then replaces. It must draw what the app draws first, with the same classes
 * in the same places, so nothing moves when the app takes over: the static build's empty data line
 * (`plugins/siteMeta.ts`), the wordmark, the nav as it is before the list of mandates answers
 * (Scorecards listed, unless the static build's bundle has no mandate: `lib/shipped.ts`), and the
 * freshness slot's "Connecting…". It carries no script and no style attribute (the
 * Content-Security-Policy allows neither) and is hidden from assistive technology.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DATA_LINE_SHELL,
  DATA_LINE_SLOT,
  DEFAULT_SITE_URL,
  type ShippedFacts,
  staticIndexHtml,
} from '../../../plugins/siteMeta.js'
import { AppRoutes, Providers } from '../../App.js'
import { createPendingClient } from '../../api/pending.js'
import { Mark } from './Logo.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const INDEX = readFileSync(join(WEB, 'index.html'), 'utf8')

/**
 * The shell as the static build writes it: index.html's #root, data line in its slot, and the
 * Scorecards tab as the shipped bundle says (kept without `facts`, as on a server).
 */
function shell(facts?: ShippedFacts): HTMLElement {
  const html = facts
    ? staticIndexHtml(INDEX, DEFAULT_SITE_URL, facts)
    : INDEX.replace(DATA_LINE_SLOT, DATA_LINE_SHELL)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.getElementById('root')
  if (!root) throw new Error('index.html has no #root')
  return root
}

/**
 * An element's classes and, recursively, its element children's: the layout's skeleton. A tab of
 * the shell (`.nav-tab`, a span that links nowhere) stands for the app's nav link.
 */
function outline(el: Element): unknown {
  const cls = el.className === 'nav-tab' ? '' : el.className
  return { cls, kids: [...el.children].map(outline) }
}

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

/** The static app's banner while its bundle loads, on `path`. */
function loadingBanner(path = '/methodology'): HTMLElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers
      client={createPendingClient(new Promise(() => {}))}
      mock={false}
      staticBuild
      connecting
      queryClient={queryClient}
    >
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
  return screen.getByRole('banner')
}

const tabWords = (tabs: NodeListOf<Element>) => [...tabs].map((t) => t.innerHTML.trim())

describe('the header shell in index.html', () => {
  it('has no script and no style attribute, and is hidden from assistive technology', () => {
    const root = shell()
    expect(root.querySelector('script, [style], a[href], button')).toBeNull()
    expect(root.children).toHaveLength(1)
    expect(root.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
    expect(INDEX.split(DATA_LINE_SLOT)).toHaveLength(2)
  })

  it('draws the banner the static app draws while its data loads, class for class', () => {
    const banner = loadingBanner()
    const drawn = shell().firstElementChild as HTMLElement
    // The app's nav adds its indicator, which takes no room.
    const nav = banner.querySelector('nav.nav') as HTMLElement
    expect(nav.lastElementChild?.classList.contains('nav-ind')).toBe(true)
    nav.lastElementChild?.remove()
    expect(banner.children).toHaveLength(2)
    expect(outline(drawn)).toEqual(outline(banner))
    // The words too: the wordmark and the tabs, short labels included.
    expect(drawn.querySelector('.wordmark')?.textContent).toBe('Depthwatch')
    expect(tabWords(drawn.querySelectorAll('.nav > .nav-tab'))).toEqual(
      tabWords(nav.querySelectorAll('a')),
    )
    expect(nav.querySelectorAll('a')).toHaveLength(5)
    expect(drawn.querySelector('.fresh')?.textContent).toBe(
      banner.querySelector('.fresh')?.textContent,
    )
    expect(drawn.querySelector('.fresh')?.textContent).toBe('Connecting…')
  })

  it.each([
    ['without a mandate', 0, ['Pools', 'Stocks', 'Gaps', 'Methodology']],
    ['with mandates', 2, ['Pools', 'Stocks', 'Gaps', 'Scorecards', 'Methodology']],
  ])('lists the tabs the loading app lists for a bundle %s', (_name, mandates, names) => {
    vi.stubEnv('DW_SHIPPED_MANDATES', String(mandates))
    const banner = loadingBanner('/gaps')
    const links = [...banner.querySelectorAll('nav.nav a')]
    expect(links.map((a) => a.getAttribute('aria-label') ?? a.textContent)).toEqual(
      names.map((n) => (n === 'Scorecards' ? 'Scorecards (Scores)' : n)),
    )
    const drawn = shell({ source: 'live', mandates })
    expect(tabWords(drawn.querySelectorAll('.nav > .nav-tab'))).toEqual(
      tabWords(banner.querySelectorAll('nav.nav a')),
    )
  })

  it('draws the mark with the app’s own shapes', () => {
    const { container } = render(<Mark />)
    const shapes = (svg: Element | null) =>
      [...(svg?.querySelectorAll('rect, path') ?? [])].map((s) =>
        [s.getAttribute('class'), s.getAttribute('d') ?? s.getAttribute('x')].join(' '),
      )
    const drawn = shell().querySelector('svg.mark')
    expect(shapes(drawn)).toEqual(shapes(container.querySelector('svg.mark')))
    expect(drawn?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(drawn?.getAttribute('width')).toBe('22')
  })
})
