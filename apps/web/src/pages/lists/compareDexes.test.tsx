/**
 * Compare DEXes: each DEX's median health reads score, then grade, as the Pools table's Health
 * cells beside it do (PoolCells' `HealthCell`).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import { CompareDexes } from './CompareDexes.js'
import { NOW } from './testing.js'

afterEach(cleanup)

describe('CompareDexes', () => {
  it('reads each median health as score, then grade', async () => {
    const stats = await createMockClient({ now: NOW }).stats()
    const { container } = render(<CompareDexes stats={stats} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compare DEXes' }))
    const cells = [...container.querySelectorAll('.td-health')]
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      expect(cell.firstElementChild?.className).toBe('n')
      expect(cell.lastElementChild?.classList.contains('grade')).toBe(true)
      expect(within(cell as HTMLElement).getByRole('img', { name: /^Grade [ABCDF]$/ })).toBeTruthy()
    }
  })
})
