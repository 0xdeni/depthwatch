import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import type { PoolSummary } from '../../api/types.js'
import { barWidth, labelFits } from './ButterflyPlot.js'
import {
  axisTicks,
  bracketText,
  butterflyLabel,
  butterflyModel,
  pickButterflyRows,
  rowLinkLabel,
  TOTAL_SEGMENTS,
} from './butterflyModel.js'
import { ButterflyTable } from './ChartTables.js'
import { DEMO_POOLS, GAP_POOL_ID, summary } from './chartFixtures.js'
import { DepthButterfly } from './DepthButterfly.js'

afterEach(cleanup)

const NB = '\u00a0'

/** The demo's six pools plus six thin ones: more pools than the total row has segments. */
const MANY: PoolSummary[] = [
  ...DEMO_POOLS,
  ...Array.from({ length: 6 }, (_, i) =>
    summary(`uniswap-v3:0xe${i}`, ['WETH', `T${i}`], 'uniswap-v3', 10_000 + i * 1_000, 9_000 + i),
  ),
]

const sumW = (segs: readonly { w: number }[]) => segs.reduce((s, x) => s + x.w, 0)

describe('butterfly model (CH4, visual-v4 §5.9.1)', () => {
  const m = butterflyModel(pickButterflyRows(MANY), MANY)

  it('sets one shared scale by the larger total side', () => {
    const sell = MANY.reduce((s, p) => s + (p.depth2DownUsd ?? 0), 0)
    const buy = MANY.reduce((s, p) => s + (p.depth2UpUsd ?? 0), 0)
    expect(m.total).toEqual({ sell, buy })
    expect(m.max).toBe(Math.max(sell, buy))
    expect(m.ticks).toEqual([5_000_000, 10_000_000])
  })

  it('splits each total side into the deepest pools and one hatched rest that sum to it', () => {
    for (const side of ['sell', 'buy'] as const) {
      const segs = m.segments[side]
      expect(segs).toHaveLength(TOTAL_SEGMENTS + 1)
      expect(segs.filter((s) => s.id === null)).toHaveLength(1)
      expect(segs[segs.length - 1]?.id).toBeNull()
      expect(sumW(segs) * m.max).toBeCloseTo(m.total[side], 4)
      // Out from the spine in row order: each segment starts where the last one ended.
      for (let i = 1; i < segs.length; i++)
        expect(segs[i]?.o).toBeCloseTo((segs[i - 1]?.o ?? 0) + (segs[i - 1]?.w ?? 0), 12)
    }
    expect(m.segments.buy[0]?.id).toBe('aerodrome-slipstream:0xdf54')
    expect(m.rest.count).toBe(MANY.length - TOTAL_SEGMENTS)
    const drawn = new Set(m.segments.sell.map((x) => x.id))
    const rest = MANY.filter((p) => !drawn.has(p.pool.id))
    expect(rest).toHaveLength(m.rest.count)
    expect(m.rest.sell).toBeCloseTo(
      rest.reduce((s, p) => s + (p.depth2DownUsd ?? 0), 0),
      6,
    )
  })

  it('draws no hatched segment when every pool has its own', () => {
    const few = butterflyModel(DEMO_POOLS, DEMO_POOLS)
    expect(few.segments.sell).toHaveLength(6)
    expect(few.segments.sell.every((s) => s.id !== null)).toBe(true)
    expect(sumW(few.segments.buy) * few.max).toBeCloseTo(few.total.buy, 4)
    expect(few.rest.count).toBe(0)
  })

  it('states the deepest pool’s share of all depth in the bracket', () => {
    const top = MANY[0]
    const all = m.total.sell + m.total.buy
    const share = ((top?.depth2DownUsd ?? 0) + (top?.depth2UpUsd ?? 0)) / all
    expect(m.bracket?.share).toBeCloseTo(share, 12)
    expect(m.bracket?.sellW).toBe(m.segments.sell[0]?.w)
    expect(m.bracket?.buyW).toBe(m.segments.buy[0]?.w)
    expect(bracketText(m.bracket!)).toBe(
      `${Math.round(share * 100)}${NB}% of it sits in one pool: WETH / USDC, Aerodrome Slipstream 0.05${NB}% dynamic`,
    )
    expect(butterflyModel(DEMO_POOLS.slice(0, 1), DEMO_POOLS.slice(0, 1)).bracket).toBeNull()
  })

  it('reads an unpriced side as nothing, never as 0', () => {
    const pools = [summary('uniswap-v3:0x1', ['A', 'B'], 'uniswap-v3', null, 1000), ...DEMO_POOLS]
    const model = butterflyModel(pools, pools)
    const row = model.rows[0]!
    expect(row.sellW).toBe(0)
    expect(row.sell).toBeNull()
    expect(barWidth(row.sellW, row.sell)).toBe('0px')
    expect(barWidth(0.001, 15_000)).toBe('max(2px, 0.100%)')
    expect(rowLinkLabel(row, 'Base')).toContain('— on the sell side')
  })

  it('draws a stale quote but leaves it out of the totals, the segments and the shares', () => {
    const stale: PoolSummary = {
      ...summary('uniswap-v3:0x5a1e', ['WETH', 'JUNK'], 'uniswap-v3', 40_000_000, 30_000_000),
      staleQuote: true,
      priceDeviationBps: 38_601_300,
    }
    const pools = [stale, ...DEMO_POOLS]
    const model = butterflyModel(pickButterflyRows(pools), pools)
    const plain = butterflyModel(DEMO_POOLS, DEMO_POOLS)
    expect(model.total).toEqual(plain.total)
    expect(model.max).toBe(plain.max)
    expect(model.poolCount).toBe(DEMO_POOLS.length)
    expect(model.rest).toEqual({ count: 0, sell: 0, buy: 0 })
    expect(model.segments.sell.map((s) => s.id)).not.toContain(stale.pool.id)
    expect(model.bracket?.share).toBeCloseTo(plain.bracket?.share ?? 0, 12)
    const row = model.rows[0]!
    expect([row.id, row.stale, row.share]).toEqual([stale.pool.id, true, null])
    // Deeper than all of Base's counted depth: the bar stops at the end of the scale.
    expect([row.sellW, row.buyW]).toEqual([1, 1])
    expect(rowLinkLabel(row, 'Base')).toMatch(/, left out of Base’s total: stale price$/)
    expect(model.rows.slice(1).map((r) => r.share)).toEqual(plain.rows.map((r) => r.share))

    render(<ButterflyTable pools={pools} scope="Base" />)
    const table = screen.getByRole('table')
    const first = within(table).getAllByRole('row')[1]!
    expect(within(first).getByRole('img').getAttribute('aria-label')).toMatch(
      /^Unknown: Stale price: 386,013.% off the market/,
    )
    expect(within(table).queryByText('Every other pool')).toBeNull()
    const total = within(table).getByText('All of Base').closest('tr')
    expect(total?.textContent).toMatch(/^All of Base\$11\.8M\$14\.3M100.%$/)
  })

  it("leaves a pool whose stock's transfers are paused out of the totals, as a stale quote", () => {
    const base = summary('uniswap-v3:0xb20c', ['USDC', 'NVDAc'], 'uniswap-v3', 900_000, 800_000)
    const paused: PoolSummary = {
      ...base,
      health: { ...base.health, grade: null, rated: false, unratedReason: 'transfers-paused' },
    }
    const pools = [...DEMO_POOLS, paused]
    const model = butterflyModel(pools, pools)
    const plain = butterflyModel(DEMO_POOLS, DEMO_POOLS)
    expect([model.total, model.max, model.poolCount]).toEqual([
      plain.total,
      plain.max,
      DEMO_POOLS.length,
    ])
    expect(model.segments.buy.map((s) => s.id)).not.toContain(paused.pool.id)
    const row = model.rows[model.rows.length - 1]!
    expect([row.id, row.paused, row.stale, row.share]).toEqual([paused.pool.id, true, false, null])
    expect(rowLinkLabel(row, 'Base')).toMatch(/, left out of Base’s total: transfers paused$/)
    // Another unrated reason stays in the totals.
    const thin = { ...paused, health: { ...paused.health, unratedReason: 'one-sided' as const } }
    expect(butterflyModel([thin], [...DEMO_POOLS, thin]).total.buy).toBe(plain.total.buy + 800_000)

    render(<ButterflyTable pools={pools} rows={[paused]} scope="Base" />)
    const table = screen.getByRole('table')
    const first = within(table).getAllByRole('row')[1]!
    expect(within(first).getByRole('img').getAttribute('aria-label')).toBe(
      'Unknown: Transfers paused: every swap in this pool reverts, so its depth is left out of totals.',
    )
    // The six counted pools are "every other pool", and the total is theirs alone.
    expect(within(table).getByText('Every other pool').closest('tr')?.textContent).toMatch(
      /^Every other pool 6 pools\$11\.8M\$14\.3M100.%$/,
    )
  })

  it('lists the 7 deepest pools plus the gap pool (ia-v3 §4.1)', async () => {
    const client = createMockClient({ now: 1_760_000_000 })
    const pools = (await client.pools({ limit: 200 })).items
    const gap = (await client.gaps()).items[0]?.pool.pool.id
    const rows = pickButterflyRows(pools, gap)
    expect(rows).toHaveLength(8)
    expect(rows.slice(0, 7).map((p) => p.depth2Usd)).toEqual(
      [...pools]
        .map((p) => p.depth2Usd)
        .sort((a, b) => (b ?? 0) - (a ?? 0))
        .slice(0, 7),
    )
    expect(rows[7]?.pool.id).toBe(gap)
    expect(pickButterflyRows(DEMO_POOLS, GAP_POOL_ID)).toHaveLength(6)
  })

  it('keeps axis labels clear of each other and of the spine’s "0"', () => {
    const label = (v: number) => `$${v / 1e6}M`
    expect(axisTicks([5e6, 10e6], 14.3e6, 600, label)).toEqual([5e6, 10e6])
    // On an 80 px side "$5M" would crowd "$10M": the outer tick stays alone.
    expect(axisTicks([5e6, 10e6], 14.3e6, 80, label)).toEqual([10e6])
    expect(axisTicks([5e6], 0, 600, label)).toEqual([])
  })

  it('stacks a row label that would run off the figure', () => {
    const row = { pair: 'WETH / USDC', venue: `Uniswap v3${NB}0.3${NB}%`, sellW: 0.2 }
    expect(labelFits(row, 600, 56)).toBe(true)
    expect(labelFits({ ...row, sellW: 0.99 }, 600, 56)).toBe(false)
  })

  it('summarises the scope, the concentration and every row for assistive tech', () => {
    const label = butterflyLabel(butterflyModel(DEMO_POOLS, DEMO_POOLS), 'Base')
    expect(label).toMatch(/^Base: \$11\.8M on the sell side and \$14\.3M on the buy side/)
    expect(label).toContain('of it sits in one pool: WETH / USDC, Aerodrome Slipstream')
    expect(label).toContain(
      `USDC / AERO, Aerodrome v2${NB}0.05${NB}%: $15.9K sell side, $15.6K buy side`,
    )
  })
})

// jsdom has no PointerEvent: a MouseEvent that carries `pointerType` stands in.
class TestPointerEvent extends MouseEvent {
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerType = init.pointerType ?? 'mouse'
  }
}
beforeEach(() => vi.stubGlobal('PointerEvent', TestPointerEvent))
afterEach(() => vi.unstubAllGlobals())

function renderButterfly(props: Partial<Parameters<typeof DepthButterfly>[0]> = {}) {
  const pools = props.pools ?? MANY
  return render(
    <MemoryRouter>
      <DepthButterfly pools={pools} gap={{ poolId: GAP_POOL_ID, turnoverRatio: 50.8 }} {...props}>
        <ButterflyTable pools={pools} gapPoolId={GAP_POOL_ID} />
      </DepthButterfly>
    </MemoryRouter>,
  )
}

describe('DepthButterfly', () => {
  const totals = (c: HTMLElement) => [...c.querySelectorAll('.bf-tot')].map((e) => e.textContent)
  const who = (c: HTMLElement) => c.querySelector('.bf-read[aria-live]')?.textContent

  it('reads the scope and its two side totals in the head', () => {
    const { container } = renderButterfly({ pools: DEMO_POOLS })
    expect(who(container)).toBe('All of Base, every tracked pool')
    expect(totals(container)).toEqual(['$11.8M', '$14.3M'])
    expect(container.querySelectorAll('.bf-pools .bf-r')).toHaveLength(6)
  })

  it('draws the total row as per-pool segments, a hatched rest and the bracket', () => {
    const { container } = renderButterfly()
    const total = screen.getByRole('img', { name: /^All of Base:/ })
    expect(total.getAttribute('aria-label')).toContain('Hatched: the other 5 pools.')
    expect(total.querySelectorAll('.bf-h--s .bf-seg')).toHaveLength(8)
    expect(total.querySelectorAll('.bf-seg.is-rest')).toHaveLength(2)
    expect(container.querySelector('.bf-call-t')?.textContent).toMatch(
      /^\d+.% of it sits in one pool: WETH \/ USDC, Aerodrome Slipstream 0\.05.% dynamic$/,
    )
    expect(container.querySelector('.bf-foot')?.textContent).toContain(
      'One scale for every pool. The other 5 pools.',
    )
    // Bars carry `data-bar` for the first view: the two total sides and both sides of every row.
    const rows = container.querySelectorAll('.bf-pools .bf-r').length
    expect(rows).toBe(7)
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(2 + 2 * rows)
  })

  it('links every row to its pool and the gap marker to /gaps', () => {
    renderButterfly({ pools: DEMO_POOLS })
    const link = screen.getByRole('link', { name: /^USDC \/ AERO, Aerodrome v2/ })
    expect(link.getAttribute('href')).toBe('/pools/aerodrome-v2%3A0xd59e')
    expect(link.getAttribute('aria-label')).toContain(`under 1${NB}% of Base`)
    const gap = screen.getByRole('link', {
      name: /Liquidity gap: USDC \/ AERO trades 51× its depth/,
    })
    expect(gap.getAttribute('href')).toBe('/gaps')
  })

  it('lenses a row on keyboard focus, instantly: readout, totals and dim; blur restores', () => {
    const { container } = renderButterfly({ pools: DEMO_POOLS })
    const fig = container.querySelector('figure.bf') as HTMLElement
    const link = screen.getByRole('link', { name: /^WETH \/ USDC, Uniswap v3/ })
    fireEvent.focus(link)
    expect(fig.classList.contains('is-lens')).toBe(true)
    expect(fig.classList.contains('is-instant')).toBe(true)
    expect(who(container)).toBe(`WETH / USDC, Uniswap v3${NB}0.05${NB}%: 20${NB}% of Base`)
    expect(totals(container)).toEqual(['$2.31M', '$2.96M'])
    const rows = container.querySelectorAll('.bf-pools .bf-r')
    expect(rows[1]?.classList.contains('is-on')).toBe(true)
    expect(rows[0]?.classList.contains('is-on')).toBe(false)
    fireEvent.blur(link, { relatedTarget: document.body })
    expect(fig.classList.contains('is-lens')).toBe(false)
    expect(totals(container)).toEqual(['$11.8M', '$14.3M'])
  })

  it('lenses on mouse hover with the 150 ms dim, and restores when the pointer leaves', () => {
    const { container } = renderButterfly({ pools: DEMO_POOLS })
    const fig = container.querySelector('figure.bf') as HTMLElement
    fireEvent.pointerOver(container.querySelectorAll('.bf-pools .bf-b')[0] as HTMLElement, {
      pointerType: 'mouse',
    })
    expect(fig.classList.contains('is-lens')).toBe(true)
    expect(fig.classList.contains('is-instant')).toBe(false)
    fireEvent.pointerLeave(container.querySelector('.bf-plot') as HTMLElement, {
      pointerType: 'mouse',
    })
    expect(fig.classList.contains('is-lens')).toBe(false)
  })

  it('reads a row on the first tap and offers "Open pool"; a second tap on it opens', () => {
    const { container } = renderButterfly({ pools: DEMO_POOLS })
    const row = container.querySelectorAll('.bf-pools .bf-r')[2] as HTMLElement
    const bar = row.querySelector('.bf-b') as HTMLElement
    fireEvent.pointerDown(bar, { pointerType: 'touch' })
    fireEvent.click(bar)
    expect(row.classList.contains('is-on')).toBe(true)
    const open = screen.getByRole('link', { name: 'Open pool' })
    expect(open.getAttribute('href')).toBe('/pools/uniswap-v4%3A0x96d4')
    // Once read, the row's own link takes the tap (butterflyStates.css) and opens the pool.
    expect(row.querySelector('.bf-link')?.getAttribute('href')).toBe('/pools/uniswap-v4%3A0x96d4')
  })

  it('holds every row’s readout hidden in the readout’s cell, so the first tap moves no row', () => {
    const { container } = renderButterfly({ pools: DEMO_POOLS })
    const cell = container.querySelector('.bf-who') as HTMLElement
    const live = cell.querySelector('.bf-read[aria-live]') as HTMLElement
    const ghosts = [...cell.querySelectorAll<HTMLElement>('.bf-read.is-ghost')]
    const rows = [...container.querySelectorAll<HTMLElement>('.bf-pools .bf-r')]
    expect(ghosts).toHaveLength(rows.length)
    for (const g of ghosts) expect(g.getAttribute('aria-hidden')).toBe('true')
    // A touch read shows the row's words and "Open pool": the text its hidden copy already holds.
    rows.forEach((row, i) => {
      const bar = row.querySelector('.bf-b') as HTMLElement
      fireEvent.pointerDown(bar, { pointerType: 'touch' })
      fireEvent.click(bar)
      expect(row.classList.contains('is-on')).toBe(true)
      expect(live.textContent).toBe(ghosts[i]?.textContent)
      expect(live.textContent).toMatch(/Open pool$/)
    })
  })

  it('moves focus between row links with Up and Down', () => {
    renderButterfly({ pools: DEMO_POOLS })
    const links = screen.getAllByRole('link').filter((a) => a.classList.contains('bf-link'))
    links[0]?.focus()
    fireEvent.keyDown(links[0] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(links[1])
    fireEvent.keyDown(links[1] as HTMLElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(links[0])
  })

  it('puts the numbers behind Show data, in a block on the band (CH9)', () => {
    renderButterfly()
    const trigger = screen.getByRole('button', { name: 'Show data' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: 'Hide data' })).toBeTruthy()
    const table = screen.getByRole('table')
    expect(table.closest('.band-data')).toBeTruthy()
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(heads).toEqual(['Pool', `Sell ±2${NB}%`, `Buy ±2${NB}%`, 'Share of Base'])
    expect(within(table).getByText('Every other pool').closest('tr')?.textContent).toContain(
      '5 pools',
    )
    const total = within(table).getByText('All of Base').closest('tr')
    expect(total?.textContent).toMatch(/^All of Base\$11\.8M\$14\.4M100.%$/)
  })

  it('draws only the spine when nothing is scored', () => {
    const { container } = render(
      <MemoryRouter>
        <DepthButterfly pools={[]} />
      </MemoryRouter>,
    )
    expect(container.querySelector('.bf.is-empty .bf-spine')).toBeTruthy()
    expect(container.querySelector('.bf-b')).toBeNull()
  })

  it('scopes the head, the total row and the summary to a token', () => {
    const pools = DEMO_POOLS.slice(0, 2)
    const { container } = render(
      <MemoryRouter>
        <DepthButterfly pools={pools} scope="WETH" />
      </MemoryRouter>,
    )
    expect(who(container)).toBe('All of WETH, every tracked pool')
    expect(screen.getByRole('img', { name: /^All of WETH:/ })).toBeTruthy()
    expect(screen.getByRole('group').getAttribute('aria-label')).toMatch(/^WETH: \$7\.41M/)
  })
})
