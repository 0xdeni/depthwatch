import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { BulletGraph, bulletFractions, depthBullet } from './BulletGraph.js'
import { SNAPSHOT, samples } from './chartFixtures.js'
import { HealthBar, healthFill, healthLabel, weakestPart } from './HealthBar.js'
import { glyphWidth, RowDepthGlyph } from './RowDepthGlyph.js'
import { ShareBar, shareParts } from './ShareBar.js'
import { lollipopAxis, lollipopLabel, SpreadLollipop } from './SpreadLollipop.js'
import {
  MEANINGFUL_GAP_SCORE,
  MEANINGFUL_GAP_TURNOVER,
  TurnoverGlyph,
  turnoverLabel,
} from './TurnoverGlyph.js'
import { stripLabel, stripLayout, UptimeStrip } from './UptimeStrip.js'

afterEach(cleanup)

const NB = ' '
const style = (el: Element | null | undefined, name: string) =>
  (el as HTMLElement | null)?.style.getPropertyValue(name)

describe('UptimeStrip (CH8, visual-v4 §5.9.7)', () => {
  it('draws one cell per sample: ink within KPI, Red when breached, hollow when not checkable', () => {
    const pts = samples('oobbuo')
    const { container } = render(<UptimeStrip points={pts} />)
    const cells = [...container.querySelectorAll('.strip i')]
    expect(cells.map((c) => c.className)).toEqual(['ok', 'ok', 'br', 'br', 'na', 'ok'])
    expect(cells[0]?.getAttribute('title')).toBe(`16${NB}Oct, 00:00${NB}UTC`)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      '3 of 5 samples within KPI, 1 not evaluable',
    )
    // Roomy cells, 6 px apart, each with its time under it.
    expect((container.querySelector('.strip') as HTMLElement).style.columnGap).toBe('6px')
    expect([...container.querySelectorAll('.strip-x span')].map((e) => e.textContent)).toEqual([
      '00:00',
      '02:00',
      '04:00',
      '06:00',
      '08:00',
      '10:00',
    ])
    expect(container.querySelector('.legend')?.textContent).toBe('BreachedWithin KPINot checkable')
  })

  it('names why a cell could not be checked, and drops times and legend in list rows', () => {
    const { container } = render(
      <UptimeStrip points={samples('ou')} unchecked="Not checkable: no per-side depth stored" />,
    )
    expect(container.querySelector('.legend')?.textContent).toContain(
      'Not checkable: no per-side depth stored',
    )
    cleanup()
    const row = render(<UptimeStrip points={samples('ou')} axis={false} />).container
    expect(row.querySelector('.strip-wrap.is-row')).toBeTruthy()
    expect(row.querySelector('.strip-x')).toBeNull()
    expect(row.querySelector('.legend')).toBeNull()
  })

  it('counts like the uptime: "36 of 84 samples within KPI"', () => {
    const pattern = 'o'.repeat(36) + 'b'.repeat(48)
    expect(stripLabel(samples(pattern))).toBe('36 of 84 samples within KPI')
  })

  it('groups neighbours when the strip is too narrow, never averaging a breach away', () => {
    const pts = samples(`${'o'.repeat(179)}b${'o'.repeat(180)}`)
    const layout = stripLayout(pts, 343)
    expect(layout.dense).toBe(true)
    expect(layout.gap).toBe(2)
    expect(layout.cells.length).toBeLessThanOrEqual(Math.floor(345 / 5))
    expect(layout.cells.filter((c) => c.kind === 'bad')).toHaveLength(1)
    expect(layout.cells.reduce((n, c) => n + c.samples, 0)).toBe(360)
  })
})

describe('SpreadLollipop (visual-v4 §5.9.8)', () => {
  it('shares one bps axis from 0 in three round steps, the last one carrying the unit', () => {
    expect(lollipopAxis(SNAPSHOT.spreads)).toEqual({ max: 15, ticks: [0, 5, 10, 15] })
    const { container } = render(
      <MemoryRouter>
        <SpreadLollipop spreads={SNAPSHOT.spreads} />
      </MemoryRouter>,
    )
    expect(container.querySelector('.dp-last')?.textContent).toBe(`15${NB}bps`)
    expect(container.querySelector('.dp-last .gloss')).toBeTruthy()
    const tracks = [...container.querySelectorAll('.dots .dot-t')]
    expect(Number(style(tracks[2], '--x'))).toBeCloseTo(13.83 / 15, 9)
    expect(container.querySelectorAll('.dot-s')).toHaveLength(3)
    expect(tracks[1]?.querySelector('b')?.textContent).toBe(`10.4${NB}bps`)
    // The chart's name says the costs as its labels do: percent and dollars first, bps second.
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      `Effective spread: $1K costs 0.10${NB}%, about $1 (10.0${NB}bps); $10K costs 0.10${NB}%, about $10 (10.4${NB}bps); $100K costs 0.14${NB}%, about $138 (13.8${NB}bps).`,
    )
  })

  it('shows a notional the pool cannot absorb as a hollow ring at 0: "Can’t absorb $100K"', () => {
    const spreads = SNAPSHOT.spreads.map((s) =>
      s.notionalUsd === 100_000 ? { ...s, spreadBps: null, feasible: false } : s,
    )
    const { container } = render(
      <MemoryRouter>
        <SpreadLollipop spreads={spreads} />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('.dot-d.ring')).toHaveLength(1)
    expect(screen.getByText('Can’t absorb $100K')).toBeTruthy()
    expect(lollipopLabel(spreads)).toContain('$100K can’t be absorbed')
    expect(lollipopAxis(spreads).max).toBe(15)
  })

  it('treats a stored spread of 10,000 bps or more as one the pool cannot absorb', () => {
    // the first live run stored 1.4e24 bps for a pool of 7e-17 USD
    const spreads = SNAPSHOT.spreads.map((s) =>
      s.notionalUsd === 100_000 ? { ...s, spreadBps: 1.449e24, feasible: true } : s,
    )
    const { container } = render(
      <MemoryRouter>
        <SpreadLollipop spreads={spreads} />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('.dot-d.ring')).toHaveLength(1)
    expect(screen.getByText('Can’t absorb $100K')).toBeTruthy()
    expect(lollipopLabel(spreads)).not.toMatch(/\d{5,}/)
    expect(lollipopAxis(spreads).max).toBe(15) // the axis ignores it
  })

  it('draws the $1M point as a fourth row, a ring at 0 when the pool cannot absorb it', () => {
    const oneM = {
      notionalUsd: 1_000_000,
      spreadBps: null,
      feasible: false,
      buyAvgPrice: null,
      sellAvgPrice: null,
    }
    const spreads = [...SNAPSHOT.spreads, oneM]
    const { container } = render(
      <MemoryRouter>
        <SpreadLollipop spreads={spreads} />
      </MemoryRouter>,
    )
    const rows = [...container.querySelectorAll('.dots .dot-r')]
    expect(rows.map((r) => r.querySelector('.k')?.textContent)).toEqual([
      '$1K',
      '$10K',
      '$100K',
      '$1M',
    ])
    expect(rows[3]?.querySelector('.dot-d.ring')).toBeTruthy()
    expect(screen.getByText('Can’t absorb $1M')).toBeTruthy()
    expect(lollipopLabel(spreads)).toBe(
      `Effective spread: $1K costs 0.10${NB}%, about $1 (10.0${NB}bps); $10K costs 0.10${NB}%, about $10 (10.4${NB}bps); $100K costs 0.14${NB}%, about $138 (13.8${NB}bps); $1M can’t be absorbed.`,
    )
    expect(lollipopAxis(spreads).max).toBe(15)
  })
})

describe('HealthBar (CH8)', () => {
  const c = { depth: 33.1, spread: 22.4, concentration: 5.5, persistence: 19.2 }

  it('fills each segment to its component ÷ weight and names the weakest', () => {
    expect(healthFill(c, 'depth')).toBeCloseTo(33.1 / 35, 9)
    expect(healthFill({ ...c, spread: 40 }, 'spread')).toBe(1)
    expect(weakestPart(c)).toBe('concentration')
    expect(healthLabel(c)).toBe(
      'Depth 33.1 of 35, Spread 22.4 of 25, Concentration 5.5 of 20, Persistence 19.2 of 20',
    )
  })

  it('names each part with its score of its weight, the weakest underlined; not the total', () => {
    const { container } = render(<HealthBar components={c} />)
    const names = [...container.querySelectorAll('.wbar-l .wlab')].map((s) => s.textContent)
    expect(names).toEqual([
      'Depth33.1 of 35',
      'Spread22.4 of 25',
      'Concentration5.5 of 20',
      'Persistence19.2 of 20',
    ])
    expect(container.querySelector('.wbar-l .weak b')?.textContent).toBe('Concentration')
    const segs = [...container.querySelectorAll('.wbar .wseg')] as HTMLElement[]
    expect(segs.map((s) => s.style.flexGrow)).toEqual(['35', '25', '20', '20'])
    expect(Number(style(segs[0]?.querySelector('i'), '--f'))).toBeCloseTo(33.1 / 35, 9)
    expect(container.textContent).not.toContain('80.2')
  })

  it('has an 80 × 4 table variant without names', () => {
    const { container } = render(<HealthBar components={c} mini />)
    expect(container.querySelector('.wbar.mini')).toBeTruthy()
    expect(container.querySelector('.wbar-l')).toBeNull()
  })
})

describe('ShareBar', () => {
  it('splits the bar into the top LP, the next two and everyone else', () => {
    const p = shareParts(0.53, 0.93)
    expect(p.top).toBe(0.53)
    expect(p.next).toBeCloseTo(0.4, 9)
    expect(p.rest).toBeCloseTo(0.07, 9)
    expect(shareParts(0.6, 0.5)).toEqual({ top: 0.6, next: 0, rest: 0.4 })
    const { container } = render(
      <ShareBar top1Share={0.53} top3Share={0.93} owners={4} bandPct={5} />,
    )
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      `Top LP 53${NB}%, next two 40${NB}%, everyone else 7${NB}%`,
    )
    expect(screen.getByText(/^4 owners within ±5/)).toBeTruthy()
    expect(container.querySelectorAll('.share .sh')).toHaveLength(3)
  })

  it('shows the active range against every other range when owners are not indexed', () => {
    const { container } = render(<ShareBar activeShare={0.006} bandPct={5} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      `Active range under 1${NB}% of the liquidity within ±5${NB}%`,
    )
    // The measured part is at least 6 px wide; the rest is hatched.
    expect((container.querySelector('.sh.s1') as HTMLElement).style.flexBasis).toBe(
      'max(6px, 0.600%)',
    )
    expect(container.querySelector('.sh.s3')).toBeTruthy()
    expect(screen.getByText(/^Every other range within ±5.%$/)).toBeTruthy()
  })
})

describe('TurnoverGlyph', () => {
  it('ticks the 3× threshold at core’s own gap score', () => {
    expect(MEANINGFUL_GAP_TURNOVER).toBe(3)
    expect(MEANINGFUL_GAP_SCORE).toBeCloseTo(23.86, 2)
    expect(turnoverLabel(85.29)).toBe('Gap score 85 of 100; 3× turnover is 24')
    const { container } = render(<TurnoverGlyph gapScore={85.29} />)
    const meter = container.querySelector('.tmeter')
    expect(Number(style(meter, '--v'))).toBeCloseTo(0.8529, 9)
    expect(Number(style(meter, '--t'))).toBeCloseTo(0.2386, 3)
    expect(container.querySelector('.gbar .num')?.textContent).toBe('85')
  })

  it('draws rows under 3× quiet and an unknown score as a dash', () => {
    const { container } = render(<TurnoverGlyph gapScore={null} quiet />)
    expect(container.querySelector('.gbar.quiet')).toBeTruthy()
    expect(container.querySelector('.num')?.textContent).toBe('—')
  })
})

describe('BulletGraph', () => {
  it('scales depth bullets to 1.25× the larger of the KPI and the value', () => {
    const f = bulletFractions(depthBullet(7_820, 50_000))
    expect(f.t).toBeCloseTo(0.8, 9)
    expect(f.v).toBeCloseTo(7_820 / 62_500, 9)
    const over = bulletFractions(depthBullet(200_000, 50_000))
    expect(over.v).toBeCloseTo(0.8, 9)
    expect(over.t).toBeCloseTo(0.2, 9)
    expect(bulletFractions(depthBullet(null, 50_000)).v).toBe(0)
  })

  it('is an image with a sentence', () => {
    const { container } = render(
      <BulletGraph value={0.429} target={0.95} label="7 day uptime 42.9 % against a 95 % target" />,
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBe('7 day uptime 42.9 % against a 95 % target')
    expect(style(container.querySelector('.bullet'), '--t')).toBe('0.95')
  })
})

describe('RowDepthGlyph (CH8)', () => {
  it('draws each side to max(2, v / max × 40) px on the table’s shared scale', () => {
    expect(glyphWidth(6_079_641, 6_079_641)).toBe(40)
    expect(glyphWidth(15_592, 6_079_641)).toBe(2)
    expect(glyphWidth(null, 6_079_641)).toBe(0)
    expect(glyphWidth(0, 6_079_641)).toBe(0)
    const { container } = render(<RowDepthGlyph sell={3_000_000} buy={6_000_000} max={6_000_000} />)
    const sell = container.querySelector('.glyph .s') as HTMLElement
    const buy = container.querySelector('.glyph .b') as HTMLElement
    expect(Number.parseFloat(sell.style.width)).toBe(20)
    expect(Number.parseFloat(buy.style.width)).toBe(40)
    expect(container.querySelector('.glyph')?.getAttribute('aria-hidden')).toBe('true')
  })
})
