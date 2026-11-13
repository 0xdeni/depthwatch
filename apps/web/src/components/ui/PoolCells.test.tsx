import type { UnratedReason } from '@depthwatch/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { PoolSummary } from '../../api/types.js'
import { NB } from '../../lib/format.js'
import { UNKNOWN_REASON } from '../../lib/poolsTable.js'
import { BASIS_MARK } from '../../lib/rating.js'
import { DEMO_POOLS, summary } from '../charts/chartFixtures.js'
import { DepthCell, HealthCell, metricCell } from './PoolCells.js'
import { PoolsTable } from './PoolsTable.js'

afterEach(cleanup)

const rated = {
  total: 71.4,
  grade: 'B',
  rated: true,
  unratedReason: null,
  concentrationBasis: 'owners',
} as const
const unrated = (unratedReason: UnratedReason) =>
  ({ total: 38.2, grade: null, rated: false, unratedReason, concentrationBasis: 'owners' }) as const

describe('HealthCell', () => {
  it('shows the glyph and the truncated score of a rated pool', () => {
    render(<HealthCell health={rated} />)
    expect(screen.getByRole('img', { name: 'Grade B' })).toBeTruthy()
    expect(screen.getByText('71')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Not rated' })).toBeNull()
  })

  it('shows "Not rated" and its reason instead of a letter or a score', async () => {
    const reasons = {
      thin: 'Too thin to rate',
      'one-sided': 'Too thin on one side',
      unpriced: 'No USD price',
      hooked: 'Hooked pool',
      'transfers-paused': 'Transfers paused',
    } as const
    for (const [reason, words] of Object.entries(reasons)) {
      const { container, unmount } = render(
        <MemoryRouter>
          <HealthCell health={unrated(reason as keyof typeof reasons)} />
        </MemoryRouter>,
      )
      expect(within(container).queryByRole('img')).toBeNull()
      // its total is not a grade: the row does not show it
      expect(container.textContent).toBe('Not rated')
      fireEvent.focus(within(container).getByRole('button', { name: 'Not rated' }))
      expect((await screen.findByRole('tooltip')).textContent).toContain(words)
      unmount()
    }
  })
})

describe('HealthCell: the concentration basis', () => {
  it('reads score, then glyph, the order of the pool page’s fact', () => {
    const { container } = render(<HealthCell health={rated} />)
    expect(container.textContent).toBe('71B')
    const cell = container.querySelector('.td-health')
    expect(cell?.firstElementChild?.className).toBe('n')
    expect(cell?.lastElementChild?.classList.contains('grade')).toBe(true)
  })

  it('carries no mark and no button of its own: its table’s Health header says the basis', () => {
    for (const basis of ['owners', 'ranges', 'neutral', null] as const) {
      const { container, unmount } = render(
        <HealthCell health={{ ...rated, concentrationBasis: basis }} />,
      )
      expect(within(container).getByRole('img', { name: 'Grade B' })).toBeTruthy()
      expect(container.textContent).toBe('71B')
      expect(within(container).queryByRole('button')).toBeNull()
      expect(container.textContent).not.toContain(BASIS_MARK)
      unmount()
    }
  })

  it('marks a grade whose basis the header names as the exception, never as a control', () => {
    const { container } = render(
      <HealthCell health={{ ...rated, concentrationBasis: 'neutral' }} marked />,
    )
    expect(within(container).getByRole('img', { name: 'Grade B' })).toBeTruthy()
    expect(container.querySelector('.grade-mark')?.textContent).toBe(BASIS_MARK)
    expect(container.querySelector('.grade-mark')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.sr-only')?.textContent).toBe(', concentration scored neutral')
    expect(within(container).queryByRole('button')).toBeNull()
  })

  it('never marks an unrated pool or a grade stored before the basis was recorded', () => {
    const plain = render(<HealthCell health={{ ...rated, concentrationBasis: null }} marked />)
    expect(plain.container.querySelector('.grade-mark')).toBeNull()
    plain.unmount()
    const none = render(
      <MemoryRouter>
        <HealthCell health={{ ...unrated('thin'), concentrationBasis: 'ranges' }} marked />
      </MemoryRouter>,
    )
    expect(none.container.querySelector('.grade-mark')).toBeNull()
  })
})

describe('metricCell', () => {
  const pool = (over: Partial<PoolSummary>): PoolSummary => {
    const base = DEMO_POOLS[0]
    if (!base) throw new Error('no fixture pool')
    return { ...base, ...over }
  }

  it('shows the health total of a rated pool and "—" for an unrated one', () => {
    expect(metricCell(pool({ health: rated }), 'health')).toBe('71')
    const { container } = render(
      <MemoryRouter>{metricCell(pool({ health: unrated('thin') }), 'health')}</MemoryRouter>,
    )
    expect(container.textContent).toBe('—')
  })

  it('words a spread the pool cannot absorb where the spread would be', () => {
    expect(metricCell(pool({ spread10kBps: 13.8 }), 'spread')).toBe(`13.8${NB}bps`)
    for (const spread10kBps of [null, 1.449e24, 10_000]) {
      expect(metricCell(pool({ spread10kBps }), 'spread')).toBe(`Can’t absorb $10K`)
    }
    // a pool with no USD price has no spread to talk about
    const { container } = render(
      <MemoryRouter>
        {metricCell(pool({ spread10kBps: null, health: unrated('unpriced') }), 'spread')}
      </MemoryRouter>,
    )
    expect(container.textContent).toBe('—')
  })

  it('gives a hooked pool "—" for depth and spread, named by the hooked reason', () => {
    const hooked = pool({
      depth2Usd: null,
      depth2UpUsd: null,
      depth2DownUsd: null,
      spread10kBps: null,
      health: unrated('hooked'),
    })
    for (const key of ['depth', 'spread'] as const) {
      const { container, unmount } = render(<MemoryRouter>{metricCell(hooked, key)}</MemoryRouter>)
      expect(container.textContent).toBe('—')
      expect(within(container).getByRole('img').getAttribute('aria-label')).toContain('Hooked pool')
      expect(container.querySelector('button, a, [tabindex]')).toBeNull()
      unmount()
    }
  })
})

describe('DepthCell', () => {
  const base = DEMO_POOLS[0]
  if (!base) throw new Error('no fixture pool')

  it('adds the "Stale price" chip to a stale quote, with how far off it is', async () => {
    const stale = { ...base, priceDeviationBps: 38_601_331, staleQuote: true }
    const { container } = render(
      <MemoryRouter>
        <DepthCell pool={stale} max={20_000_000} />
      </MemoryRouter>,
    )
    const chip = within(container).getByRole('button', { name: 'Stale price' })
    fireEvent.focus(chip)
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      `Stale price: 386,013${NB}% off the market`,
    )
  })

  it('has no chip for a pool at the market price', () => {
    const { container } = render(
      <MemoryRouter>
        <DepthCell pool={base} max={20_000_000} />
      </MemoryRouter>,
    )
    expect(within(container).queryByRole('button', { name: 'Stale price' })).toBeNull()
  })
})

describe('unknown values (D6)', () => {
  it('draws a null top LP share as a dash named by its reason, not a tab stop', () => {
    const base = DEMO_POOLS[0]
    if (!base) throw new Error('no fixture pool')
    const { container } = render(
      <MemoryRouter>{metricCell({ ...base, ownerTop1Share: null }, 'top')}</MemoryRouter>,
    )
    const dash = screen.getByRole('img', { name: `Unknown: ${UNKNOWN_REASON.top}` })
    expect(dash.textContent).toBe('—')
    expect(dash.getAttribute('title')).toBe(UNKNOWN_REASON.top)
    expect(container.querySelector('button, a, [tabindex]')).toBeNull()
  })
})

describe('PoolsTable: one name per pool', () => {
  const slip = (address: string, tickSpacing: number): PoolSummary => {
    const p = summary(
      `aerodrome-slipstream:${address}`,
      ['WETH', 'cbBTC'],
      'aerodrome-slipstream',
      1_000,
      1_000,
    )
    return { ...p, pool: { ...p.pool, tickSpacing } }
  }
  const rows = [
    slip(`0x${'a'.repeat(40)}`, 10),
    slip(`0x${'b'.repeat(40)}`, 10),
    slip(`0x${'c'.repeat(40)}`, 50),
    summary('uniswap-v3:0xd', ['WETH', 'USDC'], 'uniswap-v3', 1_000, 1_000),
  ]
  const table = (phone: boolean) =>
    render(
      <MemoryRouter>
        <PoolsTable
          rows={rows}
          state={{ sort: 'depth', dir: 'desc', cols: [] }}
          now={0}
          phone={phone}
          onSort={() => undefined}
          label="Pools"
        />
      </MemoryRouter>,
    )

  it('names each link by its pair and second line, and tells same-named pools apart', () => {
    const slipName = `WETH / cbBTC, Aerodrome Slipstream, 0.05${NB}% dynamic`
    for (const phone of [false, true]) {
      const { unmount } = table(phone)
      const names = screen.getAllByRole('link').map((a) => a.getAttribute('aria-label'))
      expect(names).toEqual([
        `${slipName}, 0xaaaa…aaaa`,
        `${slipName}, 0xbbbb…bbbb`,
        `${slipName}, tick spacing 50`,
        `WETH / USDC, Uniswap v3, 0.05${NB}%`,
      ])
      // The second line shows the same words, so sighted readers can tell the rows apart too.
      const lines = [...document.querySelectorAll('.pd')].map((el) => el.textContent)
      expect(lines[2]).toBe(`Aerodrome Slipstream, 0.05${NB}% dynamic, tick spacing 50`)
      expect(lines[3]).toBe(`Uniswap v3, 0.05${NB}%`)
      unmount()
    }
  })
})
