/**
 * The footer's promise follows the trade switch the page loaded with: the panel's non-custodial
 * promise while the switch is on for a venue whose route is not on hold (`tradeSwitchOn`),
 * read-only otherwise, so the switch can be turned on without a release that rewrites the footer.
 * The spec (docs/design/visual-v4.md §5.1) quotes both.
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
import { FOOTER_PROMISE, FOOTER_PROMISE_TRADE } from './Footer.js'

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
}

function renderAt(path: string, env: Env) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers
      client={client}
      mock={env.mock ?? false}
      demo={env.demo}
      connecting={env.connecting}
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

  it('is quoted in both states by its spec, visual-v4.md §5.1', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
    const spec = readFileSync(join(root, 'docs', 'design', 'visual-v4.md'), 'utf8')
    const footer = spec
      .slice(spec.indexOf('**Footer:**'), spec.indexOf('### 5.2'))
      .replace(/\s+/g, ' ')
    expect(footer).toContain(`"${FOOTER_PROMISE}"`)
    expect(footer).toContain(`"${FOOTER_PROMISE_TRADE}"`)
    expect(footer).toContain('`tradeSwitchOn`')
    expect(footer).not.toMatch(/Built on Base/)
  })
})
