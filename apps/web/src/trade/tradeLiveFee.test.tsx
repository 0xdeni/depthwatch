/**
 * The pool fee the swap panel shows is the one a swap at the quote's block pays: the pool's `fee()`
 * read through the wallet at that block, with every quote, never the snapshot's. On an Aerodrome
 * Slipstream pool it can be far from the snapshot's and can change by the block the swap lands in
 * (a swap fee module sets it block by block), and stays labelled dynamic. Hermetic: the fake
 * wallet of testing/fakeWallet.ts.
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
    expect(pageText()).toContain('Live pool fee0.015 % dynamic')
    expect(pageText()).not.toContain('0.04 %')
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
    expect(pageText()).toContain('Live pool fee0.05 %Slippage')
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
    expect(pageText()).not.toContain('Live pool fee')
  })
})
