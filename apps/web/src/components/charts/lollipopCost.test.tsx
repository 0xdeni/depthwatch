/**
 * Cost to trade's value labels lead with the percent, then the dollars and bps it comes to
 * (`roundTripCost`): "0.10 %" over "$10 (10.4 bps)". A notional the pool cannot absorb keeps its
 * words, and the bps axis is unchanged.
 */
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SNAPSHOT } from './chartFixtures.js'
import { SpreadLollipop } from './SpreadLollipop.js'

afterEach(cleanup)

const nb = (text: string | null | undefined) => text?.replaceAll(' ', ' ')

describe('SpreadLollipop value labels', () => {
  it('reads the percent first, then the dollars and the bps', () => {
    const { container } = render(
      <MemoryRouter>
        <SpreadLollipop spreads={SNAPSHOT.spreads} />
      </MemoryRouter>,
    )
    const values = [...container.querySelectorAll('.dots .dot-v')]
    expect(values.map((v) => nb(v.querySelector('strong')?.textContent))).toEqual([
      '0.10 %',
      '0.10 %',
      '0.14 %',
    ])
    expect(values.map((v) => nb(v.querySelector('small')?.textContent))).toEqual([
      '$1 (10.0 bps)',
      '$10 (10.4 bps)',
      '$138 (13.8 bps)',
    ])
    // The bps keep the axis's unit and their own element.
    expect(nb(values[1]?.querySelector('b')?.textContent)).toBe('10.4 bps')
    expect(nb(container.querySelector('.dp-last')?.textContent)).toBe('15 bps')
  })

  it('words a notional the pool cannot absorb, with no percent', () => {
    const spreads = SNAPSHOT.spreads.map((s) =>
      s.notionalUsd === 100_000 ? { ...s, spreadBps: null, feasible: false } : s,
    )
    const { container } = render(
      <MemoryRouter>
        <SpreadLollipop spreads={spreads} />
      </MemoryRouter>,
    )
    const rows = [...container.querySelectorAll('.dots .dot-r')]
    expect(rows[2]?.querySelector('.dot-v')).toBeNull()
    expect(rows[2]?.querySelector('b')?.textContent).toBe('Can’t absorb $100K')
  })
})
