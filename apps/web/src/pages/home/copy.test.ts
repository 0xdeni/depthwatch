/**
 * Home's words and the geometry of its fact visuals, without rendering: number agreement, the
 * numberless lead, the comparison labels, the nested squares of the biggest gap (areas to scale)
 * and the grade distribution.
 */
import { describe, expect, it } from 'vitest'
import type { PoolSummary } from '../../api/types.js'
import { NB } from '../../lib/format.js'
import {
  gapsTakeaway,
  healthLabel,
  homeAnswer,
  homeLead,
  homeSay,
  mandatesTakeaway,
  volumeLabel,
} from './copy.js'
import { gradeCounts, NEST_PX, nestSides } from './HomeFacts.js'

describe('Home copy', () => {
  it('states the answer as one sentence that counts the pools it sums', () => {
    // 492 scored pools, 165 of them stale quotes: the figure sums the other 327.
    expect(homeAnswer(49_800_000, 327)).toBe(
      `$49.8M sits within 2${NB}% of the price across 327 pools on Base.`,
    )
    expect(homeSay(1)).toBe(`sits within 2${NB}% of the price across 1 pool on Base.`)
    expect(homeSay(1_284)).toBe(`sits within 2${NB}% of the price across 1,284 pools on Base.`)
  })

  it('keeps numbers out of the lead and says which pools are graded', () => {
    expect(homeLead(492, 50)).toBe(
      'Depthwatch measures what it costs to move each Uniswap, Aerodrome and Aero pool it scores on Base, and grades the ones deep enough to rate.',
    )
    expect(homeLead(5, 5)).toMatch(/, and grades each one A to F\.$/)
    expect(homeLead(492, 0)).toMatch(/, but none is deep enough to grade yet\.$/)
    expect(homeLead(1, 1)).toMatch(
      /the one Uniswap, Aerodrome or Aero pool it scores on Base, and grades it A to F\.$/,
    )
    expect(homeLead(1, 0)).toMatch(/, but it is too thin to grade\.$/)
    for (const lead of [homeLead(492, 50), homeLead(5, 5), homeLead(492, 0)])
      expect(lead).not.toMatch(/\d/)
  })

  it('agrees in number', () => {
    expect(gapsTakeaway(0)).toBe('No pool trades 3× its depth today.')
    expect(gapsTakeaway(1)).toBe('1 pool trades 3× its depth or more every day.')
    expect(gapsTakeaway(48)).toBe('48 pools trade 3× their depth or more every day.')
    const take = (ok: number, n: number) => {
      const w = mandatesTakeaway(
        Array.from({ length: n }, (_, i) => ({ status: i < ok ? 'ok' : 'breached' }) as const),
      )
      return `${w.before}KPIs${w.after}`
    }
    expect(take(1, 2)).toBe('1 of 2 mandates is within its KPIs right now.')
    expect(take(2, 2)).toBe('2 of 2 mandates are within their KPIs right now.')
    expect(take(0, 3)).toBe('0 of 3 mandates are within their KPIs right now.')
    expect(take(0, 1)).toBe('0 of 1 mandate is within its KPIs right now.')
    expect(healthLabel(50)).toBe('median health of the 50 rated pools')
    expect(healthLabel(1)).toBe('median health of the 1 rated pool')
    expect(healthLabel(0)).toBe('median health: no pool is deep enough to rate yet')
  })

  it('carries the comparison in the volume label only when the turnover is known', () => {
    expect(volumeLabel(3.83)).toBe(`traded in 24${NB}h, 3.8× the depth within 2${NB}% of the price`)
    expect(volumeLabel(null)).toBe(`traded in 24${NB}h`)
  })
})

describe('Home fact visuals', () => {
  it('draws the biggest gap as two squares whose areas keep the turnover', () => {
    const [outline, solid] = nestSides(205)
    expect(outline).toBe(NEST_PX)
    expect(solid).toBeCloseTo(72 / Math.sqrt(205), 6)
    expect((outline / solid) ** 2).toBeCloseTo(205, 6)
    // Under 1× the depth is the larger square.
    const [o2, s2] = nestSides(0.25)
    expect(s2).toBe(NEST_PX)
    expect((o2 / s2) ** 2).toBeCloseTo(0.25, 6)
    expect(nestSides(0)).toEqual([NEST_PX, 0])
  })

  it('counts the rated pools by grade, best first, leaving out empty grades', () => {
    const pool = (grade: PoolSummary['health']['grade']) =>
      ({ health: { total: 0, grade, rated: grade !== null, unratedReason: null } }) as PoolSummary
    const pools = [pool('C'), pool('A'), pool(null), pool('A'), pool('F'), pool('C'), pool('C')]
    expect(gradeCounts(pools)).toEqual([
      { grade: 'A', n: 2 },
      { grade: 'C', n: 3 },
      { grade: 'F', n: 1 },
    ])
  })
})
