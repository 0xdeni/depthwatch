/**
 * The grades' concentration basis, said once per list: the common basis and its exceptions, the
 * Health header's info button and its note (over the grade column on phones), the minority mark on
 * a row, and the pool page's short text link under the score's label. A rated chip is never a
 * button; that a tap on it reaches the row link is the CSS rule styles.test.ts pins.
 */
import type { ConcentrationBasis } from '@depthwatch/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { PoolSummary } from '../../api/types.js'
import { BASIS_MARK } from '../../lib/rating.js'
import { SECTIONS } from '../../pages/docs/content.js'
import { summary } from '../charts/chartFixtures.js'
import { Fact, Facts } from './Fact.js'
import {
  BASIS_NOTE_NAME,
  basisMarked,
  type HealthBasis,
  HealthBasisNote,
  healthBasis,
  healthBasisNote,
} from './HealthBasis.js'
import { PoolsTable } from './PoolsTable.js'

afterEach(cleanup)

const rated = (concentrationBasis: ConcentrationBasis | null) => ({
  rated: true,
  concentrationBasis,
})
const unrated = (concentrationBasis: ConcentrationBasis | null) => ({
  rated: false,
  concentrationBasis,
})

describe('healthBasis', () => {
  it('takes the basis most rated rows share; unrated rows and unknown bases count for none', () => {
    const rows = [
      ...Array.from({ length: 74 }, () => rated('ranges')),
      ...Array.from({ length: 5 }, () => rated('neutral')),
      ...Array.from({ length: 9 }, () => unrated('owners')),
      rated(null),
    ]
    const basis = healthBasis(rows)
    expect(basis).toEqual({ common: 'ranges', others: ['neutral'] })
    expect(basisMarked(basis, rated('neutral'))).toBe(true)
    expect(basisMarked(basis, rated('ranges'))).toBe(false)
    expect(basisMarked(basis, rated(null))).toBe(false)
    expect(basisMarked(basis, unrated('neutral'))).toBe(false)
  })

  it('breaks a tie for the most rows in the order owners, ranges, neutral', () => {
    expect(healthBasis([rated('neutral'), rated('ranges')]).common).toBe('ranges')
    expect(healthBasis([rated('ranges'), rated('owners')]).common).toBe('owners')
    expect(healthBasis([unrated('ranges')])).toEqual({ common: null, others: [] })
    expect(healthBasis([])).toEqual({ common: null, others: [] })
  })

  it('says what the grades stand on, and what the mark means when some differ', () => {
    const only = healthBasisNote({ common: 'ranges', others: [] })
    expect(only).toMatch(/^Concentration, 20 of a grade’s 100 points, is scored from how the/)
    expect(only).toContain('price ranges, since LP owners are not indexed or cover under 90')
    expect(only).not.toContain(BASIS_MARK)
    const mixed = healthBasisNote({ common: 'ranges', others: ['neutral'] })
    expect(mixed).toContain(
      `Grades marked ${BASIS_MARK} score it as a neutral 10 of 20, since LP owners are not indexed.`,
    )
    expect(healthBasisNote({ common: 'owners', others: ['ranges', 'neutral'] })).toContain(
      'largest LP owner’s share of the liquidity. Grades marked * score it from how the liquidity',
    )
    // Grades resting on LP owners need no note; neither does a list with no grade.
    expect(healthBasisNote({ common: 'owners', others: [] })).toBeNull()
    expect(healthBasisNote({ common: null, others: [] })).toBeNull()
  })
})

describe('HealthBasisNote', () => {
  const note = (basis: HealthBasis) =>
    render(
      <MemoryRouter>
        <table>
          <thead>
            <tr>
              <th aria-label="Health">
                Health
                <HealthBasisNote basis={basis} />
              </th>
            </tr>
          </thead>
        </table>
      </MemoryRouter>,
    )

  it('is one named info button whose note opens on focus, the header keeping its text', async () => {
    const { container } = note({ common: 'ranges', others: ['neutral'] })
    const button = screen.getByRole('button', { name: BASIS_NOTE_NAME })
    expect(button.classList.contains('th-info')).toBe(true)
    expect(button.classList.contains('touch-hit')).toBe(true)
    expect(button.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('th')?.textContent).toBe('Health')
    fireEvent.focus(button)
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('price ranges')
    expect(within(tip).getByRole('link', { name: 'How it is measured' })).toBeTruthy()
  })

  it('is left out when there is nothing to say', () => {
    note({ common: 'owners', others: [] })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the pools table: the basis once, in the Health header', () => {
  const pool = (n: number, basis: ConcentrationBasis): PoolSummary => {
    const p = summary(`uniswap-v3:0x${n}`, ['WETH', 'USDC'], 'uniswap-v3', 1_000, 1_000)
    return { ...p, health: { ...p.health, concentrationBasis: basis } }
  }
  const rows = [pool(1, 'ranges'), pool(2, 'ranges'), pool(3, 'neutral'), pool(4, 'ranges')]
  const table = (phone: boolean) =>
    render(
      <MemoryRouter>
        <PoolsTable
          rows={rows}
          state={{ sort: 'health', dir: 'desc', cols: [] }}
          now={0}
          phone={phone}
          onSort={() => undefined}
          label="Pools"
        />
      </MemoryRouter>,
    )

  it('puts the note in the Health header and the mark on the minority row only', () => {
    const { container } = table(false)
    const health = screen.getByRole('columnheader', { name: 'Health' })
    expect(within(health).getByRole('button', { name: BASIS_NOTE_NAME })).toBeTruthy()
    expect(health.textContent).toBe('Health')
    expect(screen.getAllByRole('button', { name: BASIS_NOTE_NAME })).toHaveLength(1)
    const marks = [...container.querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelector('.grade-mark') !== null,
    )
    expect(marks).toEqual([false, false, true, false])
    // No grade, marked or not, is a button: the row's one tab stop is its pool link.
    expect(
      within(container.querySelector('tbody') as HTMLElement).queryAllByRole('button'),
    ).toEqual([])
  })

  it('puts the note over the phone rows and the mark on the same minority row', () => {
    const { container } = table(true)
    const head = container.querySelector('.prow-head') as HTMLElement
    // The head's words stay hidden from the reader; its one button is the note.
    expect(head.getAttribute('aria-hidden')).toBeNull()
    expect(within(head).getByRole('button', { name: BASIS_NOTE_NAME })).toBeTruthy()
    for (const span of head.querySelectorAll(':scope > span'))
      expect(span.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getAllByRole('button', { name: BASIS_NOTE_NAME })).toHaveLength(1)
    expect(container.querySelectorAll('.rl-row .grade')).toHaveLength(4)
    const marks = [...container.querySelectorAll('.rl-row')].map(
      (row) => row.querySelector('.grade-mark') !== null,
    )
    expect(marks).toEqual([false, false, true, false])
    expect(within(container.querySelector('ol') as HTMLElement).queryAllByRole('button')).toEqual(
      [],
    )
  })

  it('says nothing over the phone rows when there is nothing to say', () => {
    const { container } = render(
      <MemoryRouter>
        <PoolsTable
          rows={rows.map((p) => ({ ...p, health: { ...p.health, concentrationBasis: 'owners' } }))}
          state={{ sort: 'health', dir: 'desc', cols: [] }}
          now={0}
          phone
          onSort={() => undefined}
          label="Pools"
        />
      </MemoryRouter>,
    )
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(container.querySelector('.grade-mark')).toBeNull()
  })
})

describe('the pool page: the grade’s basis under its score and label', () => {
  const fact = (basis: ConcentrationBasis | null) =>
    render(
      <MemoryRouter>
        <Facts>
          <Fact value="71" grade="B" gradeBasis={basis} label="health" />
        </Facts>
      </MemoryRouter>,
    )

  it('is a short text link after the label, whose reason opens on focus', async () => {
    const { container } = fact('ranges')
    // label, value, basis: the label names the score; the basis is the fact's last description
    const [term, value, basis] = [...(container.querySelector('.fact')?.children ?? [])]
    expect(term?.tagName).toBe('DT')
    expect(term?.textContent).toBe('health')
    expect(value?.textContent).toBe('71B')
    expect(basis?.tagName).toBe('DD')
    expect(basis?.classList.contains('fact-basis')).toBe(true)
    const link = within(basis as HTMLElement).getByRole('button', {
      name: 'Concentration from price ranges',
    })
    fireEvent.focus(link)
    expect((await screen.findByRole('tooltip')).textContent).toContain('LP owners are not indexed')
    cleanup()
    fact('neutral')
    expect(screen.getByRole('button', { name: 'Concentration scored neutral' })).toBeTruthy()
  })

  it('says nothing for an owner-based grade or an unknown basis', () => {
    for (const basis of ['owners', null] as const) {
      const { container, unmount } = fact(basis)
      expect(container.querySelector('.fact-basis')).toBeNull()
      expect(container.querySelectorAll('dd')).toHaveLength(1)
      expect(container.querySelector('dd')?.textContent).toBe('71B')
      unmount()
    }
  })
})

describe('the Methodology', () => {
  it('says what the lists do: one note at the Health column, a star only on the exceptions', () => {
    const health = SECTIONS.find((s) => s.id === 'health')
    if (!health) throw new Error('no health section')
    const { container } = render(<MemoryRouter>{health.body}</MemoryRouter>)
    const text = container.textContent ?? ''
    expect(text).not.toContain('does not rest on LP owners carries a star')
    expect(text).toContain('an info button at its Health column says what most of them rest on')
    expect(text).toContain('a star marks each grade that rests on something else')
  })
})
