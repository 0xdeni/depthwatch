/**
 * The footer's promise follows the trade switch the page loaded with: the panel's non-custodial
 * promise while the switch is on for a venue whose route is not on hold (`tradeSwitchOn`),
 * read-only otherwise, so the switch can be turned on without a release that rewrites the footer.
 * The spec (docs/design/visual-v4.md §5.1) quotes both. The tokenized stocks' eligibility line
 * follows the promise as a paragraph of its own on the Stocks pages only (docs/design/stocks-api.md
 * §3). The API link goes to the README's API section from a static copy, which runs no API, and to
 * the server's own AGENTS.md otherwise. A keyboard ring on the ink is Yellow in both themes.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TradeFlags } from '@depthwatch/core'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../../App.js'
import { createMockClient } from '../../api/mock.js'
import { tradeSwitchOn } from '../../lib/tradeSwitch.js'
import { FOOTER_PROMISE, FOOTER_PROMISE_TRADE, FOOTER_STOCKS } from './Footer.js'

const NOW = 1_760_000_000
const V3 = 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224'
const ON: TradeFlags = { enabled: true, venues: ['uniswap-v3'], maxUsd: 1000, maxSlippageBps: 300 }
const client = createMockClient({ now: NOW })

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(cleanup)

interface Env {
  trade?: TradeFlags | null
  mock?: boolean
  demo?: boolean
  connecting?: boolean
  staticBuild?: boolean
}

function renderAt(path: string, env: Env) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers
      client={client}
      mock={env.mock ?? false}
      demo={env.demo}
      connecting={env.connecting}
      staticBuild={env.staticBuild}
      trade={env.trade}
      queryClient={queryClient}
    >
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

const promise = () => screen.getByRole('contentinfo').querySelector('.foot-say')?.textContent

describe('the footer promise and the trade switch', () => {
  it('stays read-only while the switch is off, missing or held, or the mode never trades', () => {
    const off: Env[] = [
      {},
      { trade: null },
      { trade: { ...ON, enabled: false } },
      { trade: { ...ON, venues: [] } },
      { trade: { ...ON, venues: ['aero-slipstream'] } },
      { trade: ON, demo: true },
      { trade: ON, mock: true },
      { trade: ON, connecting: true },
    ]
    for (const env of off) {
      expect(tradeSwitchOn({ mock: false, ...env }), JSON.stringify(env)).toBeNull()
      renderAt('/methodology', env)
      expect(promise()?.startsWith(`${FOOTER_PROMISE} Data: `), JSON.stringify(env)).toBe(true)
      cleanup()
    }
  })

  it('says the swap panel is on and non-custodial, and no longer read-only, when it is on', () => {
    renderAt('/methodology', { trade: ON })
    const text = promise() ?? ''
    expect(text).toBe(`${FOOTER_PROMISE_TRADE} Data: Base mainnet.`)
    expect(text).toContain('The swap panel is on and non-custodial')
    expect(text).toContain('from your own wallet straight to the pool’s router')
    expect(text).toContain('no fee added to swaps')
    expect(text).toContain('Independent: not affiliated with or endorsed by Base.')
    expect(text).not.toMatch(/read-only/i)
    const footer = screen.getByRole('contentinfo')
    expect(footer.textContent).not.toContain('·')
    expect(footer.textContent).not.toMatch(/partner|Built on Base/i)
  })

  it('says so on the pool page that shows the panel, the same switch deciding both', async () => {
    renderAt(`/pools/${encodeURIComponent(V3)}`, { trade: ON })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('region', { name: 'trade in this pool' })).toBeTruthy()
    expect(within(screen.getByRole('contentinfo')).getByText(/The swap panel is on/)).toBeTruthy()
    cleanup()
    renderAt(`/pools/${encodeURIComponent(V3)}`, { trade: null })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('region', { name: 'trade in this pool' })).toBeNull()
    expect(promise()).toMatch(/^Open source and read-only\./)
  })

  it('carries the stocks’ eligibility line after the promise on the Stocks pages, in every state', () => {
    for (const [path, env] of [
      ['/stocks', {}],
      ['/stocks', { trade: ON }],
      ['/stocks/0xb26e766461630000000000000000000000000000', { mock: true }],
    ] as const) {
      renderAt(path, env)
      const paragraphs = [...screen.getByRole('contentinfo').querySelectorAll('p')]
      const texts = paragraphs.map((p) => p.textContent)
      expect(texts, path).toContain(FOOTER_STOCKS)
      // Its own paragraph, after the promise, which stays word for word.
      expect(texts.indexOf(FOOTER_STOCKS)).toBeGreaterThan(
        texts.findIndex((t) => t?.startsWith('Open source')),
      )
      cleanup()
    }
    // Elsewhere the footer is the promise alone.
    for (const path of ['/', '/methodology', '/pools', '/gaps', '/stocksx']) {
      renderAt(path, {})
      const texts = [...screen.getByRole('contentinfo').querySelectorAll('p')].map(
        (p) => p.textContent,
      )
      expect(texts, path).toHaveLength(1)
      cleanup()
    }
    expect(FOOTER_STOCKS).toBe(
      'Coinbase tokenized stocks are only available to persons in eligible jurisdictions outside of the U.S. Depthwatch measures their markets; it does not offer, route or recommend trades in them.',
    )
  })

  it('links API to the README’s API section from a static copy, to AGENTS.md on a server', () => {
    const api = () => within(screen.getByRole('contentinfo')).getByRole('link', { name: 'API' })
    renderAt('/methodology', { staticBuild: true })
    expect(api().getAttribute('href')).toBe('https://github.com/0xdeni/depthwatch#api')
    expect(api().getAttribute('rel')).toBe('noopener')
    cleanup()
    renderAt('/methodology', {})
    expect(api().getAttribute('href')).toBe('/AGENTS.md')
  })

  it('rings keyboard focus in Yellow on the ink, in both themes (footer.css)', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles', 'footer.css'),
      'utf8',
    )
    expect(css).toMatch(/\.foot :focus-visible \{\s*outline-color: var\(--focus-band\);\s*\}/)
  })

  it('is quoted in both states by its spec, visual-v4.md §5.1', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
    const spec = readFileSync(join(root, 'docs', 'design', 'visual-v4.md'), 'utf8')
    const footer = spec
      .slice(spec.indexOf('**Footer:**'), spec.indexOf('### 5.2'))
      .replace(/\s+/g, ' ')
    expect(footer).toContain(`"${FOOTER_PROMISE}"`)
    expect(footer).toContain(`"${FOOTER_PROMISE_TRADE}"`)
    expect(footer).toContain(`"${FOOTER_STOCKS}"`)
    expect(footer).toContain('`FOOTER_STOCKS`')
    expect(footer).toContain('`tradeSwitchOn`')
    expect(footer).not.toMatch(/Built on Base/)
  })
})
