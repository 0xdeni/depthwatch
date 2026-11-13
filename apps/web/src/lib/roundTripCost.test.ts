/**
 * `roundTripCost`: a round trip's cost for readers who do not think in basis points, percent and
 * dollars first, bps second ("$10K round trip: 0.18 %, about $18 (17.8 bps)"). The percent keeps
 * 2 significant figures below 10 % and is whole from there; the dollars are the notional times the
 * spread, written as `usd` writes money; the bps are `bps`'s. Where `bps` prints no number, there
 * is no cost to word.
 */
import { describe, expect, it } from 'vitest'
import { roundTripCost } from './format.js'

/** The text with its no-break spaces as `~`, so the glue shows in the expectations. */
const text = (spreadBps: number | null, notional: number) =>
  roundTripCost(spreadBps, notional)?.text.replaceAll(' ', '~') ?? null

describe('roundTripCost', () => {
  it('leads with percent and dollars and puts bps second', () => {
    expect(text(17.8, 10_000)).toBe('0.18~%, about $18 (17.8~bps)')
    expect(roundTripCost(17.8, 10_000)).toEqual({
      percent: '0.18 %',
      dollars: '$18',
      bps: '17.8 bps',
      text: '0.18 %, about $18 (17.8 bps)',
    })
  })

  it('rounds the percent to 2 significant figures, keeping a trailing zero', () => {
    expect(text(14.8, 10_000)).toBe('0.15~%, about $15 (14.8~bps)')
    expect(text(14.4, 10_000)).toBe('0.14~%, about $14 (14.4~bps)')
    expect(text(10, 1_000)).toBe('0.10~%, about $1 (10.0~bps)')
    expect(text(100, 10_000)).toBe('1.0~%, about $100 (100~bps)')
    expect(text(123, 10_000)).toBe('1.2~%, about $123 (123~bps)')
    // Two spreads that round to the same percent stay apart in bps.
    expect(roundTripCost(10.0, 1_000)?.percent).toBe(roundTripCost(10.4, 10_000)?.percent)
    expect(roundTripCost(10.4, 10_000)?.bps).toBe('10.4 bps')
  })

  it('writes small costs out in full, never as 0 % or $0', () => {
    expect(text(2.4, 10_000)).toBe('0.024~%, about $2 (2.4~bps)')
    expect(text(0.48, 1_000)).toBe('0.0048~%, about $0.05 (0.5~bps)')
    expect(text(0.04, 1_000)).toBe('0.00040~%, about <$0.01 (0.0~bps)')
    expect(text(0, 10_000)).toBe('0~%, about $0 (0.0~bps)')
    for (const v of [0.04, 0.48, 2.4]) expect(text(v, 1_000)).not.toMatch(/e-|\$0\.00\b/)
  })

  it('gives large costs in whole percent and compact dollars, never 100 % below 10,000 bps', () => {
    expect(text(1_234.5, 10_000)).toBe('12~%, about $1.23K (1,235~bps)')
    expect(text(6_902.55, 1_000_000)).toBe('69~%, about $690K (6,903~bps)')
    expect(text(42, 1_000_000)).toBe('0.42~%, about $4.20K (42.0~bps)')
    expect(text(9_960, 10_000)).toBe('99.6~%, about $9.96K (9,960~bps)')
    expect(text(9_999.4, 10_000)).toBe('99.9~%, about $10K (9,999~bps)')
  })

  it('words nothing where bps print no number: unknown, or 10,000 bps and more', () => {
    expect(roundTripCost(null, 10_000)).toBeNull()
    expect(roundTripCost(undefined, 10_000)).toBeNull()
    expect(roundTripCost(Number.NaN, 10_000)).toBeNull()
    expect(roundTripCost(9_999.6, 10_000)).toBeNull()
    expect(roundTripCost(1.449e24, 10_000)).toBeNull()
  })
})
