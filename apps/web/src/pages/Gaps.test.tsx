/**
 * Gaps (ia-v3 §4.4, docs/design/visual-v4.md §6.5) against the in-repo mock: the title section and
 * its answer, the band's lead with the volume floor, "How the score works" and the List / Table
 * control; the ranked rows in a block over the band with their sentence, turnover glyph and focus
 * tooltip; 20 rows, then "Show all" (`rows=all`), then the rows under 3× behind one disclosure; the
 * table view with every v2 column and its sorts (`view`, `sort`, `dir` in the URL); and the no-gap,
 * empty and error states.
 */
import { isMeaningfulGap } from '@depthwatch/core'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../api/mock.js'
import type { ApiClient, GapItem, GapsQuery } from '../api/types.js'
import { NB, pairLabel, ratio, usd } from '../lib/format.js'
import { Gaps } from './Gaps.js'
import { gapsAnswer, quietLabel, restSentence } from './lists/gapsModel.js'
import { NOW, renderPage } from './lists/testing.js'

afterEach(cleanup)

const renderAt = (path: string, client?: ApiClient) => renderPage(path, '/gaps', <Gaps />, client)
const last = (h: { log: string[] }) => h.log.at(-1)
const gapList = () => screen.findByRole('list', { name: 'Liquidity gaps' })
const answerText = () => document.querySelector('.ttl .answer')?.textContent

/** The mock's feed with its items replaced, counted as the API counts the whole feed. */
function withGaps(items: (all: GapItem[]) => GapItem[]): ApiClient {
  const mock = createMockClient({ now: NOW })
  return {
    ...mock,
    async gaps(query) {
      const res = await mock.gaps(query)
      const feed = items(res.items)
      const meaningful = feed.filter((g) => isMeaningfulGap(g.gap)).length
      return { ...res, items: feed, total: feed.length, meaningful }
    },
  }
}

/** A feed of `n` rows, the first `real` of them meaningful, paged by `limit` / `offset`. */
async function pagedFeed(n: number, real: number) {
  const mock = createMockClient({ now: NOW })
  const all = (await mock.gaps({ limit: 200 })).items
  const top = all[0] as GapItem
  const calm = all.find((g) => !isMeaningfulGap(g.gap)) as GapItem
  const feed = Array.from({ length: n }, (_, i) => {
    const g = i < real ? top : calm
    return { ...g, pool: { ...g.pool, pool: { ...g.pool.pool, id: `${g.pool.pool.id}-${i}` } } }
  })
  const asked: GapsQuery[] = []
  const client: ApiClient = {
    ...mock,
    async gaps(query = {}) {
      asked.push(query)
      const offset = query.offset ?? 0
      const items = feed.slice(offset, offset + (query.limit ?? 50))
      return { items, total: n, meaningful: real, minVolumeUsd: 10_000 }
    },
  }
  return { client, asked }
}

/** `n` meaningful gaps (copies of the top one under distinct ids), then the mock's quiet rows. */
const manyGaps = (n: number) =>
  withGaps((all) => {
    const top = all[0] as GapItem
    const quiet = all.filter((g) => (g.gap.turnoverRatio ?? 0) < 3)
    const real = Array.from({ length: n }, (_, i) => ({
      ...top,
      pool: { ...top.pool, pool: { ...top.pool.pool, id: `${top.pool.pool.id}-${i}` } },
    }))
    return [...real, ...quiet]
  })

describe('Gaps: title section and band', () => {
  it('counts the pools that trade 3× their depth or more beside the title "gaps"', async () => {
    const h = renderAt('/gaps')
    const feed = await h.client.gaps({ limit: 100 })
    const real = feed.items.filter((g) => (g.gap.turnoverRatio ?? 0) >= 3)
    await waitFor(() => expect(answerText()).toBe(gapsAnswer(real.length)))
    expect(answerText()).toBe(`${real.length} pools trade 3× their depth or more every day.`)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('gaps')
    expect(document.querySelector('.ttl .eyebrow')?.textContent).toBe(
      'Liquidity gapsVolume against depth',
    )
  })

  it('puts the lead with the volume floor, the score link and the views on the band', async () => {
    renderAt('/gaps')
    const band = screen.getByRole('region', { name: 'What a gap is' })
    expect(band.classList.contains('band')).toBe(true)
    await waitFor(() =>
      expect(band.querySelector('.lead')?.textContent).toBe(
        `A gap is a pool that trades far more each day than the liquidity near its price. Pools with at least $10K of 24${NB}h volume.`,
      ),
    )
    expect(
      within(band).getByRole('link', { name: 'How the score works' }).getAttribute('href'),
    ).toBe('/methodology#gaps')
    expect(within(band).getByRole('radiogroup', { name: 'View' })).toBeTruthy()
    // The list sits in a block stacked over the band's lower edge.
    const block = (await gapList()).closest('.blk')
    expect(block?.classList.contains('blk--over')).toBe(true)
    expect(block?.closest('.overlap')).toBeTruthy()
  })

  it("counts the API's meaningful gaps and lists every page of a feed longer than one", async () => {
    const { client, asked } = await pagedFeed(250, 210)
    const h = renderAt('/gaps?rows=all', client)
    await waitFor(() => expect(answerText()).toBe(gapsAnswer(210)))
    const list = await gapList()
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(210))
    expect(screen.getByRole('button', { name: quietLabel(40) })).toBeTruthy()
    expect(asked.map((q) => q.offset ?? 0).sort((a, b) => a - b)).toEqual([0, 200])
    expect(last(h)).toBe('/gaps?rows=all')
  })

  it('says so when no pool trades 3× its depth', async () => {
    renderAt(
      '/gaps',
      withGaps((all) => all.filter((g) => (g.gap.turnoverRatio ?? 0) < 3)),
    )
    await waitFor(() => expect(answerText()).toBe('No pool trades 3× its depth today.'))
    expect(screen.getByText('Every pool trades less than 3× its depth.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Liquidity gaps' })).toBeNull()
  })
})

describe('Gaps: the ranked rows', () => {
  it('ranks each gap with its pool, sentence and turnover glyph', async () => {
    const h = renderAt('/gaps')
    const top = (await h.client.gaps({ limit: 1 })).items[0] as GapItem
    const list = await gapList()
    expect(list.tagName).toBe('OL')
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(13)
    const first = rows[0] as HTMLElement
    const link = within(first).getByRole('link')
    expect(link.getAttribute('href')).toBe(`/pools/${encodeURIComponent(top.pool.pool.id)}`)
    const name = link.getAttribute('aria-label') ?? ''
    expect(name.startsWith(pairLabel(top.pool.pool.token0, top.pool.pool.token1))).toBe(true)
    expect(name).toContain(`${usd(top.gap.volume24hUsd)} traded through ${usd(top.gap.depth2Usd)}`)
    expect(first.querySelector('.lists-gap-say')?.textContent).toBe(
      `Trades ${ratio(top.gap.turnoverRatio)} its depth a day`,
    )
    expect(first.querySelector('.lists-gap-ratio')?.textContent).toBe(ratio(top.gap.turnoverRatio))
    expect(within(first).getByRole('img').getAttribute('aria-label')).toBe(
      'Gap score 91 of 100: trades 3 times its depth a day or more',
    )
  })

  it('shows volume and depth in a tooltip when the row link takes focus', async () => {
    const h = renderAt('/gaps')
    const top = (await h.client.gaps({ limit: 1 })).items[0] as GapItem
    const link = within(await gapList()).getAllByRole('link')[0] as HTMLElement
    fireEvent.focus(link)
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toBe(
      `${usd(top.gap.volume24hUsd)} traded through ${usd(top.gap.depth2Usd)} of depth`,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('shows 20 gaps, then all of them with rows=all, then offers the rows under 3×', async () => {
    const h = renderAt('/gaps', manyGaps(26))
    const list = await gapList()
    expect(within(list).getAllByRole('listitem')).toHaveLength(20)
    expect(document.querySelector('.lists-gaps-foot .cap')?.textContent).toBe(
      `${restSentence(4)} Gap score 0–100; the tick marks 3× turnover.`,
    )
    expect(screen.queryByRole('button', { name: quietLabel(4) })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 26' }))
    await waitFor(() => expect(last(h)).toBe('/gaps?rows=all'))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(26))
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull()
    expect(screen.getByRole('button', { name: quietLabel(4) })).toBeTruthy()
  })

  it('keeps the rows under 3× behind one quiet disclosure', async () => {
    renderAt('/gaps')
    await gapList()
    const more = screen.getByRole('button', { name: quietLabel(4) })
    // The full sentence on desktop, a short label on phones (CSS picks one); the full sentence
    // stays the accessible name at every width.
    const labels = [...more.querySelectorAll('.disc-label')].map((n) => n.textContent)
    expect(labels).toEqual([
      'Show 4 more pools that trade less than 3× their depth',
      'Show 4 pools under 3×',
    ])
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.textContent).toBe('Hide pools under 3×')
    const quiet = screen.getByRole('list', { name: 'Pools under 3× turnover' })
    const rows = within(quiet).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]?.querySelector('.rl-row')?.classList.contains('is-quiet')).toBe(true)
  })
})

describe('Gaps: the table view (L2)', () => {
  it('switches views in the URL and shows every v2 column in a table sheet', async () => {
    const h = renderAt('/gaps?rows=all')
    await gapList()
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }))
    await waitFor(() => expect(last(h)).toBe('/gaps?view=table'))
    const table = await screen.findByRole('table', { name: 'Liquidity gaps, every column' })
    expect(table.closest('.blk')?.classList.contains('blk--flush')).toBe(true)
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual([
      'Pool',
      `24${NB}h volume`,
      `Depth ±2${NB}%`,
      'Turnover',
      'Gap score',
      'Health',
      'TVL',
    ])
    expect(within(table).getAllByRole('row')).toHaveLength(18)
    const turnover = within(table).getByRole('columnheader', { name: 'Turnover' })
    expect(turnover.getAttribute('aria-sort')).toBe('descending')
  })

  it('sorts every column, nulls last, and keeps the order in the URL', async () => {
    const h = renderAt('/gaps?view=table')
    const table = await screen.findByRole('table', { name: 'Liquidity gaps, every column' })
    fireEvent.click(within(table).getByRole('button', { name: `24${NB}h volume` }))
    await waitFor(() => expect(last(h)).toBe('/gaps?view=table&sort=volume'))
    const feed = await h.client.gaps({ limit: 100 })
    const most = Math.max(...feed.items.map((g) => g.gap.volume24hUsd ?? 0))
    const firstRow = () => within(table).getAllByRole('row')[1] as HTMLElement
    await waitFor(() =>
      expect(
        [...firstRow().querySelectorAll('td')].some((td) => td.textContent === usd(most)),
      ).toBe(true),
    )
    fireEvent.click(within(table).getByRole('button', { name: `24${NB}h volume` }))
    await waitFor(() => expect(last(h)).toBe('/gaps?view=table&sort=volume&dir=asc'))
    fireEvent.click(screen.getByRole('radio', { name: 'List' }))
    await waitFor(() => expect(last(h)).toBe('/gaps'))
  })
})

describe('Gaps: empty and error (ST2, ST3)', () => {
  it('says what is empty when no pool clears the volume floor', async () => {
    renderAt(
      '/gaps',
      withGaps(() => []),
    )
    await waitFor(() =>
      expect(document.querySelector('.empty p')?.textContent).toBe(
        `No pool has $10K of 24${NB}h volume yet, so none can be ranked.`,
      ),
    )
  })

  it('keeps the page usable when the feed fails', async () => {
    const mock = createMockClient({ now: NOW })
    renderAt('/gaps', { ...mock, gaps: () => Promise.reject(new Error('down')) })
    await screen.findByText('Unable to load gaps. Check that the API is running, then retry.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('gaps')
    expect(screen.getByRole('link', { name: 'How the score works' })).toBeTruthy()
  })
})
