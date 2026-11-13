/**
 * The over-time spread at $10K reads as the facts row does, percent first and bps second, in the
 * multiple's head and its summary; the range bracket keeps bps, the unit of its 0.1 precision.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HistoryPoint } from '../../api/types.js'
import { type MultipleSeries, SmallMultiples } from '../../components/charts/SmallMultiples.js'
import { bps, NB } from '../../lib/format.js'
import { spreadHeadText } from './poolText.js'

afterEach(cleanup)

const T0 = 1_792_108_800

function history(spreads: readonly (number | null)[]): HistoryPoint[] {
  return spreads.map((spread10kBps, i) => ({
    timestamp: T0 + i * 7200,
    price: 2460,
    depth2Usd: 10_000_000,
    spread10kBps,
    tvlUsd: null,
    health: 88,
  }))
}

/** The pool page's spread multiple. */
const SPREAD: MultipleSeries<HistoryPoint> = {
  key: 'spread',
  label: 'Spread at $10K',
  value: (p) => p.spread10kBps,
  format: bps,
  head: spreadHeadText,
  minSpan: 0.02,
}

function draw(points: HistoryPoint[]) {
  const end = points[points.length - 1]?.timestamp ?? T0
  return render(
    <SmallMultiples
      points={points}
      series={[SPREAD]}
      domain={[points[0]?.timestamp ?? T0, end]}
      windowLabel="24 hours"
    />,
  )
}

describe('spreadHeadText', () => {
  it('gives the percent, then the bps', () => {
    expect(spreadHeadText(17.8)).toBe(`0.18${NB}% (17.8${NB}bps)`)
    expect(spreadHeadText(2.4)).toBe(`0.024${NB}% (2.4${NB}bps)`)
    expect(spreadHeadText(187)).toBe(`1.9${NB}% (187${NB}bps)`)
  })

  it('is a dash where bps print no number', () => {
    expect(spreadHeadText(null)).toBe('—')
    expect(spreadHeadText(1.449e24)).toBe('—')
  })
})

describe('the over-time spread multiple', () => {
  it('heads with the percent and keeps the bracket in bps', () => {
    const { container } = draw(history([18.1, 17.9, 17.8]))
    expect(container.querySelector('.sm-h b')?.textContent).toBe(`0.18${NB}% (17.8${NB}bps)`)
    const ends = [...container.querySelectorAll('.sm-range text')].map((t) => t.textContent)
    expect(ends).toEqual([`18.1${NB}bps`, `17.8${NB}bps`])
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      `Spread at $10K over 24 hours: between 17.8${NB}bps and 18.1${NB}bps, latest 0.18${NB}% (17.8${NB}bps).`,
    )
  })

  it('labels a level series once, in bps, so the bracket label stays short', () => {
    const { container } = draw(history([60.227, 60.226, 60.226]))
    const ends = [...container.querySelectorAll('.sm-range text')].map((t) => t.textContent)
    expect(ends).toEqual([`60.2${NB}bps`])
    expect(container.querySelector('.sm-h b')?.textContent).toBe(`0.60${NB}% (60.2${NB}bps)`)
  })

  it('rewrites the head with the scrubbed sample in the same words', () => {
    const { container } = draw(history([18.1, 17.9, 17.8]))
    const group = screen.getByRole('group')
    // The first step lands on the latest sample, the second on the one before it.
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(container.querySelector('.sm-h b')?.textContent).toBe(`0.18${NB}% (17.9${NB}bps)`)
    expect(container.querySelector('[aria-live]')?.textContent).toMatch(
      new RegExp(`Spread at \\$10K 0\\.18${NB}% \\(17\\.9${NB}bps\\)$`),
    )
  })
})
