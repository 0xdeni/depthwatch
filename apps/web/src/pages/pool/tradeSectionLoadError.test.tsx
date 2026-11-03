/**
 * The swap panel's chunk failing to load (an old tab after a deploy) leaves the page drawn and
 * asks for a reload in place of the panel, with focus on the Reload button.
 */
import type { TradeFlags } from '@depthwatch/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Providers } from '../../App.js'
import { createMockClient } from '../../api/mock.js'
import { TradeSection } from './TradeSection.js'

vi.mock('../../trade/TradePanel.js', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

const ON: TradeFlags = { enabled: true, venues: ['uniswap-v3'], maxUsd: 1000, maxSlippageBps: 300 }

describe('TradeSection', () => {
  it('asks for a reload when the panel cannot load', async () => {
    const client = createMockClient({ now: 1_760_000_000 })
    const detail = await client.pool('uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224')
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <Providers client={client} mock={false} trade={ON}>
        <MemoryRouter>
          <TradeSection detail={detail} />
        </MemoryRouter>
      </Providers>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Swap in this pool' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The swap panel could not load. Reload the page to trade.',
    )
    // Focus lands on Reload, not on the page body.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reload' }))
    quiet.mockRestore()
  })
})
