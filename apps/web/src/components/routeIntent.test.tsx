/**
 * Route data on intent (visual-v3 §4 row 6, §5.12 ST1): what each route reads first is keyed as
 * its page reads it, a resting pointer or keyboard focus loads it, and a pointer click that will
 * cross-fade to a cold route waits for it (at most 120 ms), then replays.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { createMockClient } from '../api/mock.js'
import type { ApiClient } from '../api/types.js'
import {
  cachedPoolSummary,
  cachedScorecard,
  cachedStock,
  cachedToken,
  hrefTarget,
  routeQueries,
} from '../routeData.js'
import { createClickHold, prefetchRoute, ROUTE_WAIT_MS } from './routeIntent.js'

const NOW = 1_760_000_000
const POOL = 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224'
const WETH = '0x4200000000000000000000000000000000000006'
/** The mock's NVDAc (core `makeStock`). */
const STOCK = '0xb26e766461630000000000000000000000000000'

afterEach(cleanup)

const client = () => createMockClient({ now: NOW })
const qcOf = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function link(href: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.setAttribute('href', href)
  document.body.append(a)
  return a
}

describe('routeQueries: the keys each page reads first', () => {
  it('keys a pool, token, scorecard and list route as their pages do', () => {
    const api = client()
    const keys = (href: string) => routeQueries(href, api).map((q) => q.queryKey)
    expect(keys(`/pools/${encodeURIComponent(POOL)}`)).toEqual([['pool', POOL]])
    expect(keys(`#/pools/${encodeURIComponent(POOL)}`)).toEqual([['pool', POOL]])
    expect(keys(`/tokens/${WETH.toUpperCase().replace('0X', '0x')}`)).toEqual([
      ['token', WETH, { sort: 'depth', dir: 'desc', limit: 200 }],
    ])
    expect(keys('/mm/demo-a')).toEqual([
      ['mm', 'demo-a'],
      ['mm', 'demo-a', 'samples', '30d'],
    ])
    expect(keys('/gaps')).toEqual([['gaps', { limit: 100 }]])
    expect(keys('/mm')).toEqual([['mm', {}]])
    expect(keys('/stocks')).toEqual([['stocks']])
    expect(keys(`/stocks/${STOCK.toUpperCase().replace('0X', '0x')}`)).toEqual([['stock', STOCK]])
    expect(keys('/pools')[0]).toEqual(['stats'])
    expect(keys('/methodology')).toEqual([])
    expect(keys('/AGENTS.md')).toEqual([])
    expect(hrefTarget('https://basescan.org/address/0x1')).toBeNull()
  })
})

describe('cached title data', () => {
  it('finds a pool, its tokens and a scorecard in lists already loaded', async () => {
    const api = client()
    const qc = qcOf()
    expect(cachedPoolSummary(qc, POOL)).toBeUndefined()
    qc.setQueryData(['pools', { limit: 200 }], await api.pools({ limit: 200 }))
    expect(cachedPoolSummary(qc, POOL)?.pool.id).toBe(POOL)
    expect(cachedToken(qc, WETH)?.symbol).toBe('WETH')
    const list = await api.scorecards({})
    qc.setQueryData(['mm', {}], list)
    const first = list.items[0]
    if (!first) throw new Error('no mandates')
    expect(cachedScorecard(qc, first.mandate.id)?.mandate.name).toBe(first.mandate.name)
    expect(cachedScorecard(qc, 'nope')).toBeUndefined()
    expect(cachedStock(qc, STOCK)).toBeUndefined()
    qc.setQueryData(['stocks'], await api.stocks())
    expect(cachedStock(qc, STOCK.toUpperCase().replace('0X', '0x'))?.stock.ticker).toBe('NVDA')
  })
})

describe('prefetch on intent', () => {
  it('loads the route data once, under the key the page reads', async () => {
    const api = client()
    const spy = vi.spyOn(api, 'pool')
    const qc = qcOf()
    const href = `/pools/${encodeURIComponent(POOL)}`
    await prefetchRoute(qc, api, href)
    expect(qc.getQueryData<{ pool: { id: string } }>(['pool', POOL])?.pool.id).toBe(POOL)
    expect(prefetchRoute(qc, api, href)).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('loads a pool when a pointer rests on its link in the app', async () => {
    const api: ApiClient = client()
    const spy = vi.spyOn(api, 'pool')
    const qc = qcOf()
    render(
      <Providers client={api} mock queryClient={qc}>
        <MemoryRouter initialEntries={['/pools']}>
          <AppRoutes />
        </MemoryRouter>
      </Providers>,
    )
    const table = await screen.findByRole('table', { name: 'Pools' })
    const row = await waitFor(() => {
      const a = table.querySelector('a[href^="/pools/"]')
      if (!a) throw new Error('no pool rows yet')
      return a
    })
    expect(spy).not.toHaveBeenCalled()
    fireEvent.pointerOver(row)
    const id = decodeURIComponent((row.getAttribute('href') ?? '').replace('/pools/', ''))
    await waitFor(() => expect(qc.getQueryData(['pool', id])).toBeDefined())
    expect(spy).toHaveBeenCalledWith(id)
  })
})

describe('the click hold', () => {
  const pointer = (detail = 1) =>
    new MouseEvent('click', { bubbles: true, cancelable: true, detail, button: 0 })

  it('holds a click to a cold route, then replays it once the data is in', async () => {
    const qc = qcOf()
    const hold = createClickHold(qc, client())
    const a = link(`/pools/${encodeURIComponent(POOL)}`)
    const seen: MouseEvent[] = []
    a.addEventListener('click', (e) => {
      if (hold.hold(e)) return
      seen.push(e)
      e.preventDefault()
    })
    const first = pointer()
    a.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(true)
    expect(seen).toHaveLength(0)
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]?.detail).toBe(1)
    expect(qc.getQueryData(['pool', POOL])).toBeDefined()
    // Warm now: the next click goes straight through.
    a.dispatchEvent(pointer())
    expect(seen).toHaveLength(2)
    a.remove()
  })

  it('navigates after 120 ms even when the data is slower, and only for the last click', async () => {
    vi.useFakeTimers()
    try {
      const api: ApiClient = { ...client(), pool: () => new Promise(() => undefined) }
      const hold = createClickHold(qcOf(), api)
      const a = link(`/pools/${encodeURIComponent(POOL)}`)
      let replays = 0
      a.addEventListener('click', (e) => {
        if (hold.hold(e)) return
        replays++
        e.preventDefault()
      })
      a.dispatchEvent(pointer())
      a.dispatchEvent(pointer())
      await vi.advanceTimersByTimeAsync(ROUTE_WAIT_MS - 1)
      expect(replays).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(replays).toBe(1)
      a.remove()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves links without route data alone', () => {
    const hold = createClickHold(qcOf(), client())
    const a = link('/methodology')
    let held: boolean | null = null
    let prevented: boolean | null = null
    a.addEventListener('click', (ev) => {
      held = hold.hold(ev)
      prevented = ev.defaultPrevented
      ev.preventDefault()
    })
    a.dispatchEvent(pointer())
    expect(held).toBe(false)
    expect(prevented).toBe(false)
    a.remove()
  })
})
