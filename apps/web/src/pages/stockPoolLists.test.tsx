/**
 * Once the pipeline seeds and tracks the stock pools (docs/design/stocks.md §7 G), the generic
 * lists show them like any pool: Home's previews, Pools, Gaps and a token page carry no stock
 * marker of their own (stocks-api.md §3), so the site-wide footer line is what covers them. Each
 * list is rendered here with a stock pool in it, as the API answers it after phase G (the mock
 * keeps its stock pools out of these lists, so they are added here), and the eligibility line
 * must be in that page's footer, after the promise, outside <main>. (The lists' depth words, "the
 * buy side", are no offer to buy: the swap panel's gate refusing a stock pool is pinned in
 * pool/tradeSection.test.tsx.) A stock's token page labels its price as the valuation price, the
 * one stock surface outside the stock pages that shows Depthwatch's price of a stock.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { createMockClient } from '../api/mock.js'
import { MOCK_STOCK_POOLS } from '../api/mockStocks.js'
import type { ApiClient, GapsResponse, PoolSummary } from '../api/types.js'
import { FOOTER_STOCKS } from '../components/shell/Footer.js'
import { poolHref } from '../lib/format.js'
import { VALUATION_LABEL } from '../lib/stockText.js'

const NOW = 1_760_000_000
const STOCK_POOL = MOCK_STOCK_POOLS.nvdaUsdcAero
/** NVDAc of the mock (core's `makeStock('NVDAc')` address). */
const NVDA = '0xb26e766461630000000000000000000000000000'

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(cleanup)

/**
 * The mock client with the stock pool first in every pool list, in the gaps feed and on its
 * quote's token page; `quote` is that token's address (USDC of the mock).
 */
async function listingStockPools(): Promise<{ client: ApiClient; quote: string }> {
  const base = createMockClient({ now: NOW })
  const summary = (await base.token(NVDA)).pools.find((p) => p.pool.id === STOCK_POOL)
  if (summary === undefined) throw new Error('the mock lost its NVDAc pool')
  const quote = summary.pool.token0.address
  const withStock = (items: PoolSummary[]) => [
    summary,
    ...items.filter((p) => p.pool.id !== STOCK_POOL),
  ]
  const client: ApiClient = {
    ...base,
    pools: async (query) => {
      const page = await base.pools(query)
      return { items: withStock(page.items), total: page.total + 1 }
    },
    token: async (address, query) => {
      const detail = await base.token(address, query)
      if (address.toLowerCase() !== quote) return detail
      return { ...detail, pools: withStock(detail.pools), total: detail.total + 1 }
    },
    gaps: async (query): Promise<GapsResponse> => {
      const feed = await base.gaps(query)
      const [first] = feed.items
      if (first === undefined) return feed
      const item = { ...first, pool: summary }
      return { ...feed, items: [item, ...feed.items], total: feed.total + 1 }
    },
  }
  return { client, quote }
}

function renderAt(path: string, client: ApiClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client} mock={false} queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

/** The links of <main> to the stock pool's page. */
const stockPoolLinks = () =>
  [...(document.querySelector('main')?.querySelectorAll('a[href]') ?? [])].filter(
    (a) => a.getAttribute('href') === poolHref(STOCK_POOL),
  )

describe('a stock pool in the generic lists', () => {
  it.each([
    ['Home', () => '/'],
    ['Pools', () => '/pools'],
    ['Gaps', () => '/gaps'],
    ['the stock’s token page', () => `/tokens/${NVDA}`],
    ['the quote’s token page', (quote: string) => `/tokens/${quote}`],
  ])('%s shows it with the eligibility line in the footer', async (_name, path) => {
    const { client, quote } = await listingStockPools()
    renderAt(path(quote), client)
    await waitFor(() => expect(stockPoolLinks().length).toBeGreaterThan(0), { timeout: 4_000 })
    const footer = screen.getByRole('contentinfo')
    const paragraphs = [...footer.querySelectorAll('p')].map((p) => p.textContent)
    expect(paragraphs).toContain(FOOTER_STOCKS)
    expect(paragraphs.indexOf(FOOTER_STOCKS)).toBeGreaterThan(
      paragraphs.findIndex((t) => t?.startsWith('Open source')),
    )
    // The footer is the page's own, outside <main>, so a list that fails to draw keeps it.
    expect(document.querySelector('main')?.contains(footer)).toBe(false)
  })
})

describe('a stock’s token page', () => {
  const facts = () =>
    (document.querySelector('.token-facts')?.textContent ?? '').replace(/\u00a0/g, ' ')

  it('labels the price as the valuation price, as the stock pages do', async () => {
    const { client, quote } = await listingStockPools()
    renderAt(`/tokens/${NVDA}`, client)
    await waitFor(() => expect(facts()).toContain(VALUATION_LABEL), { timeout: 4_000 })
    expect(facts()).toContain('valuation price')
    expect(facts()).not.toContain('USD price')
    cleanup()
    // A token off the stock list keeps its USD price, unlabelled.
    renderAt(`/tokens/${quote}`, client)
    await waitFor(() => expect(facts()).toContain('USD price'), { timeout: 4_000 })
    expect(facts()).not.toContain(VALUATION_LABEL)
  })
})
