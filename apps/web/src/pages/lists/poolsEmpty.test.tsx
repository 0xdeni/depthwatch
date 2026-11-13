/**
 * The Pools search's next steps: search reads tokens and addresses, never the DEX, so a search
 * that names a DEX is told so and offered that DEX with the rest of the search; a pasted pool id
 * of another DEX than the filter's is offered every DEX, keeping the id; and a pasted link longer
 * than the API takes is cut to it, keeping its id, instead of failing the list.
 */
import { POOL_QUERY_MAX_LENGTH } from '@depthwatch/core'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import { createStaticClient } from '../../api/static.js'
import { bundleFromClient } from '../../testing/staticBundle.js'
import { Pools } from '../Pools.js'
import { readPoolsState } from './poolsState.js'
import { dexesNamedBy } from './searchDexes.js'
import { NOW, renderPage } from './testing.js'

afterEach(cleanup)

const V3 = 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224'
const V4 = 'uniswap-v4:0x3f0e1c7b8d2a9f4e6b1c5d8a7e9f2b4c6d8e0f1a2b3c4d5e6f708192a3b4c5d6'
const HINT = 'search reads tokens and addresses, and DEXes have their own filter.'

const renderAt = (path: string, client = createMockClient({ now: NOW })) =>
  renderPage(path, '/pools', <Pools />, client)
const last = (h: { log: string[] }) => h.log.at(-1)
const rowsOf = async () =>
  within(await screen.findByRole('table', { name: 'Pools' }))
    .getAllByRole('row')
    .slice(1)

describe('dexesNamedBy', () => {
  it('names the DEXes with the most of their words, and keeps the rest of the search', () => {
    expect(dexesNamedBy('uniswap v3 weth')).toEqual([{ dex: 'uniswap-v3', rest: 'weth' }])
    expect(dexesNamedBy('Uniswap-V3')).toEqual([{ dex: 'uniswap-v3', rest: '' }])
    expect(dexesNamedBy('uniswap').map((n) => n.dex)).toEqual(['uniswap-v3', 'uniswap-v4'])
    expect(dexesNamedBy('slipstream usdc')).toEqual([
      { dex: 'aerodrome-slipstream', rest: 'usdc' },
      { dex: 'aero-slipstream', rest: 'usdc' },
    ])
    expect(dexesNamedBy('Aerodrome CL')).toEqual([{ dex: 'aerodrome-slipstream', rest: '' }])
  })

  it('names none for tokens alone, a version alone or a pasted pool id', () => {
    for (const q of ['weth usdc', 'v3', 'v2 weth', V3, '']) expect(dexesNamedBy(q), q).toEqual([])
  })
})

describe('Pools: a search that names a DEX', () => {
  it('says search reads tokens and addresses, and offers the DEX with the rest', async () => {
    const h = renderAt('/pools?q=uniswap+v3+weth')
    await screen.findByText(`No pools match “uniswap v3 weth”: ${HINT}`)
    fireEvent.click(screen.getByRole('button', { name: 'Search “weth” on Uniswap v3' }))
    await waitFor(() => expect(last(h)).toBe('/pools?q=weth&dex=uniswap-v3'))
    await waitFor(async () => expect(await rowsOf()).toHaveLength(4))
    expect((screen.getByLabelText('Search pools') as HTMLInputElement).value).toBe('weth')
  })

  it('offers the DEX alone when the search is only its name', async () => {
    const h = renderAt('/pools?q=Aerodrome+CL')
    await screen.findByText(`No pools match “Aerodrome CL”: ${HINT}`)
    fireEvent.click(screen.getByRole('button', { name: 'Show Aerodrome Slipstream pools' }))
    await waitFor(() => expect(last(h)).toBe('/pools?dex=aerodrome-slipstream'))
    await waitFor(async () => expect(await rowsOf()).toHaveLength(4))
  })

  it('clears the search when it names more than one DEX', async () => {
    const h = renderAt('/pools?q=uniswap')
    await screen.findByText(`No pools match “uniswap”: ${HINT}`)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(last(h)).toBe('/pools'))
  })
})

describe('Pools: a pasted pool id of another DEX than the filter', () => {
  it('names the id’s DEX and lifts the filter, keeping the id', async () => {
    const h = renderAt(`/pools?dex=aerodrome-slipstream&q=${encodeURIComponent(V3)}`)
    await screen.findByText(
      `No pools match “${V3}” on Aerodrome Slipstream: the id names Uniswap v3.`,
    )
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all DEXes' }))
    await waitFor(() => expect(last(h)).toBe(`/pools?q=${encodeURIComponent(V3)}`))
    await waitFor(async () => expect(await rowsOf()).toHaveLength(1))
  })
})

describe('Pools: a pasted link longer than the API takes', () => {
  const link = `https://depthwatch.pages.dev/#/pools/${encodeURIComponent(V4)}?window=7d&utm_source=newsletter&utm_medium=email&utm_campaign=november-liquidity-report`

  it('is cut to 200 characters, which keep its id', () => {
    expect(link.length).toBeGreaterThan(POOL_QUERY_MAX_LENGTH)
    const { q } = readPoolsState(new URLSearchParams({ q: link }))
    expect(q).toBe(link.slice(0, POOL_QUERY_MAX_LENGTH))
  })

  it('finds its pool through the static client instead of failing the list', async () => {
    const mock = createMockClient({ now: NOW })
    const bundle = await bundleFromClient(mock, { generatedAt: NOW, source: 'demo' })
    renderAt(`/pools?q=${encodeURIComponent(link)}`, createStaticClient(bundle))
    const rows = await rowsOf()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain('ETH')
    expect(screen.queryByText(/Unable to load pools/)).toBeNull()
    const box = screen.getByLabelText('Search pools') as HTMLInputElement
    expect(box.maxLength).toBe(POOL_QUERY_MAX_LENGTH)
  })
})
