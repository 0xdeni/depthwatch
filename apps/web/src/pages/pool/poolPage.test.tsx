/**
 * The Pool page's edge cases: stored sides with the price read from the base token, About this
 * pool's identifiers, a pool with no grade, a stale quote, not found, and a tokenized stock's pool
 * (its stock row and eligibility line, docs/design/stocks-api.md §3).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../../App.js'
import { createMockClient, MOCK_STOCK_POOLS } from '../../api/mock.js'
import type { ApiClient } from '../../api/types.js'
import { NB, roundTripCost, usd } from '../../lib/format.js'
import { ELIGIBILITY_LINE, VALUATION_LABEL } from '../../lib/stockText.js'
import { expectNoTradeControls } from '../../testing/noTrade.js'
import { PoolTitle } from './PoolTitle.js'
import {
  facts,
  HOOKS,
  loaded,
  NOW,
  renderPool,
  USDC_AERO,
  USDC_CBBTC,
  V3_ADDRESS,
  V3_WETH_USDC,
  V4_ETH_USDC,
  V4_POOL_ID,
  ZERO_ADDRESS,
} from './testing.js'

afterEach(cleanup)

describe('Pool page: stored sides, price from the base token (N2, UX2-02)', () => {
  /** The stored ±2 % sides: up lifts token0 (USDC here), down pushes it. */
  async function stored(id: string) {
    const detail = await createMockClient({ now: NOW }).pool(id)
    const level = detail.latest?.depthUsd.find((d) => d.pct === 2)
    return { up: level?.upUsd ?? null, down: level?.downUsd ?? null }
  }

  it.each([
    [
      USDC_AERO,
      'AERO (Aerodrome)',
      /^1\sAERO \(Aerodrome\) = 1\.32\sUSDC$/,
      /^1\sUSDC = 0\.7576\sAERO \(Aerodrome\)$/,
    ],
    [USDC_CBBTC, 'cbBTC', /^1\scbBTC = 98,522\.17\sUSDC$/, /^1\sUSDC = 0\.00001015\scbBTC$/],
  ])('%s keeps USDC’s sides and prices %s in USDC', async (id, base, line, flipped) => {
    const { up, down } = await stored(id)
    renderPool(id)
    await screen.findByRole('heading', { level: 1, name: `USDC / ${base}` })
    // The sides are the stored ones, token0's, as Home and the scorecards show them.
    expect(document.querySelector('.answer')?.textContent).toBe(
      `It takes ${usd(up)} of buying to lift USDC 2${NB}% and ${usd(down)} of selling to push it down.`,
    )
    expect(document.querySelector('.pool-price')?.textContent).toMatch(line)
    fireEvent.click(screen.getByRole('button', { name: `Show price in ${base}` }), { detail: 0 })
    expect(document.querySelector('.pool-price')?.textContent).toMatch(flipped)
  })
})

describe('Pool page: the pair title', () => {
  it('glues the slash to the first symbol, so a wrapping title never starts a line with it', async () => {
    renderPool(V3_WETH_USDC)
    const h1 = await loaded()
    expect(h1.textContent).toBe(`WETH${NB}/ USDC`)
    expect(h1.textContent).toContain(`${NB}/ `)
    expect(h1.textContent).not.toMatch(/ \//)
    expect(
      within(h1)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['WETH', 'USDC'])
  })
})

describe('Pool page: About this pool (L3)', () => {
  it('links an address-keyed pool to Basescan and offers a copy', async () => {
    const { container } = renderPool(V3_WETH_USDC)
    await loaded()
    const links = [...container.querySelectorAll('a[href^="https://basescan.org"]')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `https://basescan.org/address/${V3_ADDRESS}`,
    ])
    expect(screen.getByTitle(V3_ADDRESS).textContent).toBe(
      `${V3_ADDRESS.slice(0, 10)}…${V3_ADDRESS.slice(-6)}`,
    )
    expect(screen.getByRole('button', { name: 'Copy address', hidden: true })).toBeTruthy()
  })

  it('shows a Uniswap v4 pool id as text, never as a dead explorer link', async () => {
    const { container } = renderPool(V4_ETH_USDC)
    await loaded()
    expect(container.querySelectorAll('a[href^="https://basescan.org"]')).toHaveLength(0)
    const id = screen.getByTitle(V4_POOL_ID)
    expect(id.tagName).toBe('SPAN')
    expect(screen.getByRole('button', { name: 'Copy pool id', hidden: true })).toBeTruthy()
  })

  it('names a hooks contract only when the pool has one', async () => {
    renderPool(V4_ETH_USDC, { meta: { hooks: ZERO_ADDRESS } })
    await loaded()
    expect(screen.queryByText('Hooks')).toBeNull()
    cleanup()
    renderPool(V4_ETH_USDC, { meta: { hooks: HOOKS } })
    await loaded()
    expect(screen.getByText('Hooks')).toBeTruthy()
    expect(screen.getByTitle(HOOKS).getAttribute('href')).toBe(
      `https://basescan.org/address/${HOOKS}`,
    )
  })
})

describe('Pool page: an Aero Slipstream pool', () => {
  const AERO_CL = 'aero-slipstream:0x9e2b4d6f8a1c3e5b7d9f0a2c4e6b8d1f3a5c7e92'
  const AERO_V2 = 'aero-v2:0x5d1e3f7a9b2c4e6a8d0f1b3c5e7a9d2f4b6c8e01'
  const aboutRow = (term: string) =>
    [...document.querySelectorAll('.about dt')].find((dt) => dt.textContent === term)
      ?.nextElementSibling?.textContent

  it('says its fee is dynamic, read at the latest snapshot, in the eyebrow and About', async () => {
    renderPool(AERO_CL)
    await loaded()
    expect(document.querySelector('.pool-eb')?.textContent).toBe(
      `Aero Slipstream 0.0465${NB}% dynamic fee`,
    )
    expect(aboutRow('Fee')).toBe(`0.0465${NB}%, dynamic (read at the latest snapshot)`)
  })

  it('names Aero’s AERO apart from Aerodrome’s in the title and the About tokens', async () => {
    renderPool(AERO_V2)
    const h1 = await screen.findByRole('heading', { level: 1, name: /^AERO \(Aero\) \/ USDC$/ })
    expect(
      within(h1)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['AERO (Aero)', 'USDC'])
    expect(aboutRow('Fee')).toBe(`0.3${NB}%`)
    expect(aboutRow('Tokens')).toBe('AERO (Aero)andUSDC')
  })
})

describe('Pool page: a pool with no grade', () => {
  const THIN = 'aerodrome-v2:0x2b6f9a1c4d8e3f7a0b5c6d9e1f2a3b4c5d6e7f80'
  const ONE_SIDED = 'uniswap-v3:0x61d4c2e8a3f90b7d5c1e6a4f2b8d3c09e7a5b1f4'
  const UNPRICED = 'uniswap-v3:0x9f3b7e1a5c2d8046e9b1a7c3f5d20e8b4a6c1d93'
  const opened = async () => {
    const health = screen.getByRole('region', { name: 'health' })
    fireEvent.click(within(health).getByRole('button', { name: 'Details' }), { detail: 0 })
    return health
  }

  it('says "Not rated" instead of a letter, and why, for a pool that is too thin', async () => {
    renderPool(THIN)
    await screen.findByRole('heading', { level: 1, name: /AERO \(Aerodrome\) \/ DEGEN/ })
    expect(within(facts()).queryByRole('img', { name: /^Grade/ })).toBeNull()
    const chip = within(facts()).getByRole('button', { name: 'Not rated' })
    fireEvent.focus(chip)
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      `Too thin to rate: neither side holds $5K within 2${NB}%.`,
    )
    const reason = `Too thin to rate: neither side holds $5K within 2${NB}%.`
    const health = await opened()
    // the takeaway and the Details line both say it; the numbers stay in the table
    // (the default matcher folds the no-break space in the text it reads, not in the needle)
    expect(within(health).getAllByText(reason.replaceAll(NB, ' '))).toHaveLength(2)
    const table = within(health).getByRole('table', { name: 'Health components' })
    expect(within(table).getByText('Total, not rated')).toBeTruthy()
    expect(within(table).queryByText(/grade [A-F]/)).toBeNull()
    expect(within(table).getAllByRole('row')).toHaveLength(6)
  })

  it('says "Too thin on one side" for a pool with a buy side only, and that it can’t absorb $10K', async () => {
    renderPool(ONE_SIDED)
    await screen.findByRole('heading', { level: 1, name: /BRETT \/ DEGEN/ })
    fireEvent.focus(within(facts()).getByRole('button', { name: 'Not rated' }))
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      `Too thin on one side: the thinner side holds under $5K within 2${NB}%.`,
    )
    // a priced pool with no $10K spread: the words where the spread would be
    const spread = [...facts().querySelectorAll('.fact')].find(
      (f) => f.querySelector('dt')?.textContent === 'spread at $10K, a round trip',
    )
    expect(spread?.querySelector('dd')?.textContent).toBe(`Can’t absorb $10K`)
    expect(document.querySelector('.answer')?.textContent).toMatch(
      /^Liquidity runs out before a 2\s% move/,
    )
  })

  it('says "No USD price" for a pool with a token that has none, with no spread to show', async () => {
    renderPool(UNPRICED)
    await screen.findByRole('heading', { level: 1, name: /WETH \/ TOSHI/ })
    fireEvent.focus(within(facts()).getByRole('button', { name: 'Not rated' }))
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      'No USD price: a token in this pool has no price in dollars.',
    )
    const spread = [...facts().querySelectorAll('.fact')].find(
      (f) => f.querySelector('dt')?.textContent === 'spread at $10K, a round trip',
    )
    expect(spread?.querySelector('dd')?.textContent).toBe('—')
    expect(document.querySelector('.answer')?.textContent).toBe(
      `It takes $42K of selling to push WETH down 2${NB}%. The buy side is unknown: TOSHI has no USD price.`,
    )
  })

  it('shows the grade of a rated pool as before', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    expect(within(facts()).getByRole('img', { name: /^Grade [A-F]$/ })).toBeTruthy()
    expect(within(facts()).queryByRole('button', { name: 'Not rated' })).toBeNull()
  })
})

describe('Pool page: states', () => {
  it('says which pool was not found, with the id and two ways on', async () => {
    renderPool('uniswap-v3:0x00000000000000000000000000000000000000aa')
    expect(await screen.findByRole('heading', { level: 1, name: 'pool not found' })).toBeTruthy()
    expect(screen.getByText('uniswap-v3:0x00000000000000000000000000000000000000aa')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse pools' }).getAttribute('href')).toBe('/pools')
  })
})

describe('Pool page: a stale quote', () => {
  it('carries the "Stale price" chip in the eyebrow, and none at the market price', async () => {
    const client = createMockClient({ now: NOW })
    const { pool } = await client.pool(V3_WETH_USDC)
    const stale = render(
      <Providers client={client} mock>
        <MemoryRouter>
          <PoolTitle pool={pool} spot={null} answer={null} staleDeviationBps={1_000} />
        </MemoryRouter>
      </Providers>,
    )
    fireEvent.focus(within(stale.container).getByRole('button', { name: 'Stale price' }))
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      `Stale price: 10${NB}% off the market, so its depth is left out of totals.`,
    )
    stale.unmount()
    const fresh = render(
      <Providers client={client} mock>
        <MemoryRouter>
          <PoolTitle pool={pool} spot={null} answer={null} />
        </MemoryRouter>
      </Providers>,
    )
    expect(within(fresh.container).queryByRole('button', { name: 'Stale price' })).toBeNull()
  })
})

describe('Pool page: costs in percent and dollars first, bps second', () => {
  it('gives the $10K spread fact as a percent, with the dollars and bps under it', async () => {
    const detail = await createMockClient({ now: NOW }).pool(V3_WETH_USDC)
    const bps10k = detail.latest?.spreads.find((s) => s.notionalUsd === 10_000)?.spreadBps
    if (typeof bps10k !== 'number') throw new Error('the mock pool has no $10K spread')
    renderPool(V3_WETH_USDC)
    await loaded()
    const spread = [...facts().querySelectorAll('.fact')].find(
      (f) => f.querySelector('dt')?.textContent === 'spread at $10K, a round trip',
    )
    const cost = roundTripCost(bps10k, 10_000)
    expect(spread?.querySelector('dd')?.textContent).toBe(
      `${cost?.percent} about ${cost?.dollars} (${cost?.bps})`,
    )
    expect(spread?.querySelector('dd .fv-sub')?.textContent).toMatch(
      /^about \$[\d.]+K? \([\d.]+\sbps\)$/,
    )
    // The cost section's finding and its Details table read the same way.
    const section = screen.getByRole('region', { name: 'cost to trade' })
    expect(section.querySelector('.takeaway')?.textContent).toMatch(
      /round trip costs [\d.]+\s%, about \$[\d.]+K? \([\d.]+\sbps\), fees included\.$/,
    )
    // In the table, each fillable spread is the percent over the dollars and bps.
    fireEvent.click(within(section).getByRole('button', { name: 'Details' }), { detail: 0 })
    const row = [...section.querySelectorAll('tbody tr')].find(
      (r) => r.querySelector('td')?.textContent === '$10K',
    )
    const cell = row?.querySelectorAll('td')[1]
    expect(cell?.querySelector('.pool-cost-pct')?.textContent).toBe(cost?.percent)
    expect(cell?.querySelector('.pool-cost-sub')?.textContent).toBe(
      `${cost?.dollars} (${cost?.bps})`,
    )
  })
})

describe('Pool page: the static site, which reads no LP owners', () => {
  /** The mock client with this pool's owner data removed, as the static export has it. */
  async function ownerless() {
    const base = createMockClient({ now: NOW })
    const detail = await base.pool(V3_WETH_USDC)
    const latest = detail.latest
    if (!latest?.concentration) throw new Error('the mock pool has no concentration')
    const patch = {
      latest: { ...latest, concentration: { ...latest.concentration, owners: null } },
    }
    const client: ApiClient = {
      ...base,
      async pool(id) {
        return { ...(await base.pool(id)), ...patch }
      },
    }
    return { client, patch }
  }

  it('titles the section by what it shows and does not say owners are not indexed', async () => {
    const { client } = await ownerless()
    render(
      <Providers client={client} mock={false} staticBuild>
        <MemoryRouter initialEntries={[`/pools/${encodeURIComponent(V3_WETH_USDC)}`]}>
          <AppRoutes />
        </MemoryRouter>
      </Providers>,
    )
    await loaded()
    const section = screen.getByRole('region', { name: 'how concentrated the liquidity is' })
    expect(screen.queryByRole('region', { name: 'who provides it' })).toBeNull()
    expect(section.querySelector('.takeaway')?.textContent).toMatch(/^The active range holds /)
    fireEvent.click(within(section).getByRole('button', { name: 'Details' }), { detail: 0 })
    expect(section.textContent).toContain('Active range share')
    expect(section.textContent).not.toMatch(/not indexed/)
  })

  it('keeps "who provides it" and the owner sentence where owners can be read', async () => {
    const { patch } = await ownerless()
    renderPool(V3_WETH_USDC, { patch })
    await loaded()
    const section = screen.getByRole('region', { name: 'who provides it' })
    expect(section.querySelector('.takeaway')?.textContent).toMatch(
      /^LP owners are not indexed for this pool\./,
    )
  })
})

describe('Pool page: owners that cover too little of the pool', () => {
  it('says what the indexed LPs hold and draws the active range, never "One LP holds 100 %"', async () => {
    const detail = await createMockClient({ now: NOW }).pool(V3_WETH_USDC)
    const latest = detail.latest
    if (!latest?.concentration) throw new Error('the mock pool has no concentration')
    // One unstaked LP beside a gauge holding 97 % of the band.
    const owners = { count: 1, top1Share: 1, top3Share: 1, hhi: 1, coverage: 0.0102 }
    renderPool(V3_WETH_USDC, {
      patch: { latest: { ...latest, concentration: { ...latest.concentration, owners } } },
    })
    await loaded()
    const who = screen.getByRole('region', { name: 'who provides it' })
    expect(within(who).getByText(/^Indexed LPs hold/).textContent).toBe(
      `Indexed LPs hold 1${NB}% of the liquidity near the price; the largest holds 100${NB}% of that.`,
    )
    expect(within(who).queryByText(/One LP holds/)).toBeNull()
    expect(within(who).getByRole('img', { name: /^Active range/ })).toBeTruthy()
    fireEvent.click(within(who).getByRole('button', { name: 'Details' }), { detail: 0 })
    const row = (term: string) => within(who).getByText(term).closest('div')?.textContent
    expect(row('Coverage')).toBe(`Coverage1${NB}%`)
    expect(row('Top indexed LP')).toBe(`Top indexed LP100${NB}%`)
    expect(within(who).getByText(/^Indexed owners cover 1/)).toBeTruthy()
  })
})

describe('Pool page: a tokenized stock’s pool', () => {
  it('opens its sheet with the stock row and the eligibility line, and links to the stock', async () => {
    renderPool(MOCK_STOCK_POOLS.nvdaUsdcAero)
    await screen.findByRole('heading', { level: 1, name: /^USDC.\/ NVDAc$/ })
    const titles = [...document.querySelectorAll('.secs .sec h2')].map((h) => h.textContent)
    expect(titles.slice(0, 3)).toEqual(['tokenized stock', 'health', 'cost to trade'])
    const stock = screen.getByRole('region', { name: 'tokenized stock' })
    const text = (stock.textContent ?? '').replace(/ /g, ' ')
    expect(text).toContain(
      '+25.06 bps from Chainlink’s answer, within the feed’s 0.5 % band plus the pool’s 0.05 % fee.',
    )
    expect(text).toContain('Chainlink’s answer$199.50, Live, 30 min old')
    expect(text).toContain('This pool’s mid$200.00')
    expect(text).toContain(VALUATION_LABEL)
    expect(within(stock).getByText(ELIGIBILITY_LINE)).toBeTruthy()
    expect(within(stock).getByRole('link', { name: 'NVDAc' }).getAttribute('href')).toBe(
      '/stocks/0xb26e766461630000000000000000000000000000',
    )
    // The stock's price in "Prices used" carries the valuation label too.
    const about = document.querySelector('.sec-about')?.textContent ?? ''
    expect(about).toContain(`NVDAc $200.00${VALUATION_LABEL}`)
    expectNoTradeControls()
  })

  it('says why a stock pool has no deviation', async () => {
    renderPool(MOCK_STOCK_POOLS.nvdaUsdcV4)
    await screen.findByRole('heading', { level: 1, name: /^USDC.\/ NVDAc$/ })
    const stock = screen.getByRole('region', { name: 'tokenized stock' })
    expect(within(stock).getByText(/^No deviation from Chainlink’s answer: Too thin/)).toBeTruthy()
  })

  it('shows no stock row on a pool without a stock', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    expect(screen.queryByRole('region', { name: 'tokenized stock' })).toBeNull()
    expect(document.querySelector('main')?.textContent).not.toContain(ELIGIBILITY_LINE)
  })
})
