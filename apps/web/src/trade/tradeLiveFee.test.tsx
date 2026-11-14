/**
 * The pool fee the swap panel shows is the one a swap at the quote's block pays: the pool's `fee()`
 * read through the wallet at that block, with every quote, never the snapshot's. On an Aerodrome
 * Slipstream pool it can be far from the snapshot's and can change by the block the swap lands in
 * (a swap fee module sets it block by block), and stays labelled dynamic. The form shows it as the
 * part of the total cost that is the fee, beside the rest, the price move; a warning on a costly
 * quote says which of the two makes it high. Hermetic: the fake wallet of testing/fakeWallet.ts.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { toHex } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import { BLOCK } from '../testing/fakeChain.js'
import {
  connect,
  enter,
  ON_SLIPSTREAM,
  pageText,
  renderPanel,
  review,
  SLIP,
  slipDetail,
  V3,
  wallet,
} from '../testing/tradeHarness.js'

afterEach(() => cleanup())

/** `fee()` of Uniswap v3 and Slipstream pools. */
const FEE = '0xddca3f43'

/** The pool's `fee()` reads, with the block each was made at. */
const feeReads = (fake: ReturnType<typeof wallet>, pool: string) =>
  fake.state.calls.filter((c) => c.to === pool && c.data === FEE).map((c) => c.block)

describe('the live pool fee', () => {
  it('shows a Slipstream pool’s fee read at the quote’s block, not the snapshot’s', async () => {
    expect(slipDetail.pool.feePips).toBe(400)
    const fake = wallet()
    fake.state.fees.set(SLIP, 150)
    renderPanel(fake, [ON_SLIPSTREAM], slipDetail, 'aerodrome-slipstream')
    await connect()
    await enter('0.1')
    expect(pageText()).toContain('of which pool fee0.015 % dynamic')
    expect(pageText()).not.toContain('0.04 % dynamic')
    expect(feeReads(fake, SLIP)).toEqual([toHex(BLOCK)])
    await review()
    expect(pageText()).toContain('Live pool fee0.015 % dynamic')
    expect(pageText()).not.toContain('0.04 %')
  })

  it('reads the fee again with each quote: the review shows the reading of its own quote', async () => {
    const fake = wallet()
    fake.state.fees.set(SLIP, 150)
    renderPanel(fake, [ON_SLIPSTREAM], slipDetail, 'aerodrome-slipstream')
    await connect()
    await enter('0.1')
    fake.state.fees.set(SLIP, 2_055)
    await review()
    expect(pageText()).toContain('Live pool fee0.2055 % dynamic')
    const reads = feeReads(fake, SLIP)
    expect(reads.length).toBeGreaterThanOrEqual(2)
    expect(new Set(reads)).toEqual(new Set([toHex(BLOCK)]))
  })

  it('shows a Uniswap v3 pool’s fee tier, read the same way, with no "dynamic"', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    expect(pageText()).toContain('of which pool fee0.05 %of which price move')
    expect(feeReads(fake, V3)).toContain(toHex(BLOCK))
  })

  it('gives no price when the fee cannot be read with the quote', async () => {
    const fake = wallet()
    renderPanel(fake, [ON_SLIPSTREAM], slipDetail, 'aerodrome-slipstream')
    await connect()
    fake.state.failFee = true
    fireEvent.change(screen.getByLabelText(/^You send/), { target: { value: '0.1' } })
    expect(
      await screen.findByText('The pool did not return a price. Try again in a moment.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review swap' })).toHaveProperty('disabled', true)
    expect(pageText()).toContain('of which pool fee—')
    expect(pageText()).toContain('Total cost, pool fee included—')
  })
})

/** The quote card's figures as label → value, read from its description list. */
function figures(): Record<string, string> {
  const card = document.querySelector('.trade-quote')
  const out: Record<string, string> = {}
  for (const row of card?.querySelectorAll('dl > div') ?? []) {
    const dt = row.querySelector('dt')?.textContent ?? ''
    out[dt] = (row.querySelector('dd')?.textContent ?? '').replace(/\u00a0/g, ' ')
  }
  return out
}

describe('the total cost and its parts', () => {
  it('splits the total cost into the live fee and the price move, percent and dollars first', async () => {
    const fake = wallet()
    fake.state.quoteFactor = 0.995
    renderPanel(fake)
    await connect()
    await enter('0.1')
    const shown = figures()
    // 0.05 % fee, then 0.5 % less from the quoter: core's impact is 55 bps, rounded up.
    expect(shown['Total cost, pool fee included']).toBe('0.55 %about $2 (55.0 bps)')
    expect(shown['of which pool fee']).toBe('0.05 %')
    expect(shown['of which price move']).toBe('0.5 %')
    expect(pageText()).toContain('its fee included')
  })

  it('says a costly quote is mostly the pool’s fee when the fee is at least half of it', async () => {
    const fake = wallet()
    // A Slipstream pool's fee module can set 2 %; the quoter answers 2 % less than the mid.
    fake.state.fees.set(SLIP, 20_000)
    fake.state.quoteFactor = 0.98
    renderPanel(fake, [ON_SLIPSTREAM], slipDetail, 'aerodrome-slipstream')
    await connect()
    await enter('0.1')
    const warning = await screen.findByText(/^High cost/)
    expect(warning.textContent?.replace(/\u00a0/g, ' ')).toBe(
      'High cost, mostly the pool’s 2 % fee, which any amount pays.',
    )
    expect(warning.className).toContain('trade-warn')
    expect(figures()['of which pool fee']).toBe('2 % dynamic')
  })

  it('says a costly quote comes from the swap’s size when the fee is the smaller part', async () => {
    const fake = wallet()
    fake.state.quoteFactor = 0.98
    renderPanel(fake)
    await connect()
    await enter('0.1')
    const warning = await screen.findByText(/^High cost/)
    expect(warning.textContent).toBe(
      'High cost, mostly from this swap’s size: a smaller one costs less.',
    )
    expect(pageText()).not.toContain('Total cost: how much less')
  })
})
