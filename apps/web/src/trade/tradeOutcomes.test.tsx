/**
 * What the swap panel says once the wallet may hold a transaction it cannot read the outcome of,
 * and what it keeps saying about an approval: a call bundle whose status read fails or comes back
 * without receipts and a receipt read that fails (never "not sent", never "Not swapped"); an
 * approval quoted again before its signature request (never asked for a swap that would be
 * refused); an approval that reverted; an approval that went through before the price moved or
 * before ETH out turned out to be unavailable; and a transaction the wallet took in a view that
 * has since gone (another wallet, network or account), still linked. Hermetic: the fake wallet of
 * testing/fakeWallet.ts.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  connect,
  enter,
  type Fake,
  OFF,
  ON,
  pageText,
  renderPanel,
  review,
  USDC,
  wallet,
} from '../testing/tradeHarness.js'

afterEach(() => cleanup())

type Request = { method: string; params?: unknown }

/** Rewrites the fake's answers: `answer` gets each request and the fake's own answer. */
function answering(fake: Fake, answer: (args: Request, inner: () => Promise<unknown>) => unknown) {
  const inner = fake.provider.request.bind(fake.provider)
  fake.provider.request = async (args: Request) => answer(args, () => inner(args))
}

const rpcError = (code: number, message: string) => Object.assign(new Error(message), { code })
const alert = () => screen.getByRole('alert').textContent ?? ''
const APPROVE = { name: /^Approve 100\sUSDC$/ }

describe('a transaction the wallet took but whose outcome could not be read', () => {
  /** The first `wallet_getCallsStatus` answer fails, or comes back 200 with no receipt yet. */
  function badStatus(fake: Fake, how: 'error' | 'no-receipts') {
    let first = true
    answering(fake, async (args, inner) => {
      if (args.method !== 'wallet_getCallsStatus' || !first) return inner()
      first = false
      if (how === 'error') throw rpcError(-32005, 'Request exceeds defined limit.')
      return { ...((await inner()) as object), receipts: [] }
    })
  }

  for (const how of ['error', 'no-receipts'] as const)
    it(`says a smart wallet’s swap may still go through when its status read gives ${how}`, async () => {
      const fake = wallet({ dataSuffix: true })
      badStatus(fake, how)
      renderPanel(fake)
      await connect()
      await enter('0.1')
      await review()
      fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
      await screen.findByRole('heading', { name: 'Swap sent, outcome unknown' })
      expect(fake.state.bundles).toHaveLength(1)
      expect(alert()).toMatch(/^Your wallet took the swap, but Depthwatch lost track of it: /)
      expect(alert()).toContain('It may still go through; check your wallet’s activity')
      expect(pageText()).not.toMatch(/not sent|Not swapped/)
    })

  it('says a smart wallet’s approval may still go through when its status read fails', async () => {
    const fake = wallet({ dataSuffix: true })
    badStatus(fake, 'error')
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fireEvent.click(screen.getByRole('button', APPROVE))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(fake.state.bundles).toHaveLength(1)
    expect(alert()).toBe(
      'Your wallet took the approval, but Depthwatch lost track of it: Request exceeds defined limit. It may still go through; check your wallet’s activity before you try again.',
    )
  })

  it('heads a swap whose receipt read failed as sent with its outcome unknown', async () => {
    const fake = wallet()
    answering(fake, async (args, inner) => {
      if (args.method === 'eth_getTransactionReceipt')
        throw rpcError(-32603, 'An internal error was received.')
      return inner()
    })
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Swap sent, outcome unknown' })
    expect(alert()).toMatch(/^Depthwatch lost track of the swap: .*\. Check it on Basescan\.$/)
    expect(alert()).not.toContain('..')
    expect(screen.getByRole('link', { name: 'View the transaction on Basescan' })).toBeTruthy()
  })
})

describe('an approval is quoted again before its signature request', () => {
  it('asks for no approval of a swap the live limits now refuse', async () => {
    const fake = wallet()
    const panel = renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    panel.setFlags([{ ...ON, maxUsd: 50 }])
    fireEvent.click(screen.getByRole('button', APPROVE))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(alert()).toMatch(/^Swaps are limited to \$50 each for now; .* Nothing was sent\.$/)
    expect(fake.state.sent).toEqual([])
  })

  it('asks for no approval of a swap whose price has moved past the limits', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fake.state.quoteFactor = 0.85
    fireEvent.click(screen.getByRole('button', APPROVE))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(alert()).toMatch(/Nothing was sent\.$/)
    expect(fake.state.sent).toEqual([])
  })

  it('goes back to the review, approval still to come, when the minimum fell', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fake.state.quoteFactor = 0.99
    fireEvent.click(screen.getByRole('button', APPROVE))
    expect(await screen.findByText(/^The price moved since you reviewed\./)).toBeTruthy()
    expect(screen.getByRole('button', APPROVE)).toBeTruthy()
    expect(fake.state.sent).toEqual([])
  })
})

describe('an approval that reverted', () => {
  it('says it cost only its network fee, with its link', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fake.state.revertNext = true
    fireEvent.click(screen.getByRole('button', APPROVE))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(alert()).toBe('The approval failed onchain; you paid only the network fee.')
    expect(screen.getByRole('link', { name: 'View the transaction on Basescan' })).toBeTruthy()
    expect(fake.state.sent.map((tx) => tx.to)).toEqual([USDC])
  })
})

describe('an approval that went through before the price moved', () => {
  /** Sell 100 USDC; the price falls 1 % once the approval is sent, so the swap's quote moved. */
  async function approvedThenMoved() {
    const fake = wallet()
    answering(fake, async (args, inner) => {
      const answer = await inner()
      if (args.method === 'eth_sendTransaction') fake.state.quoteFactor = 0.99
      return answer
    })
    const panel = renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fireEvent.click(screen.getByRole('button', APPROVE))
    expect(
      await screen.findByText(
        'The price moved since you reviewed; your approval of 100 USDC went through and still covers this amount. Check the new amounts before you swap.',
        { normalizer: (text) => text.replace(/ /g, ' ') },
      ),
    ).toBeTruthy()
    expect(fake.state.sent).toHaveLength(1)
    return { fake, panel }
  }

  it('says a swap then cancelled was not sent, and keeps the approval’s link', async () => {
    const { fake } = await approvedThenMoved()
    fake.state.reject.add('eth_sendTransaction')
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(alert()).toBe('You cancelled the swap, so it was not sent.')
    expect(pageText()).not.toContain('nothing was sent')
    expect(pageText()).toContain('Your approval went through, and you paid its network fee.')
    expect(screen.getByRole('link', { name: 'View the approval on Basescan' })).toBeTruthy()
  })

  it('says only the swap was not sent when the switch then went off', async () => {
    const { panel } = await approvedThenMoved()
    panel.setFlags([OFF])
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(alert()).toBe('Swapping in this pool is switched off right now. The swap was not sent.')
    expect(screen.getByRole('link', { name: 'View the approval on Basescan' })).toBeTruthy()
  })

  it('says the approval went through when ETH out turned out to be unavailable', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fake.state.failUnwrap = true
    fireEvent.click(screen.getByRole('button', APPROVE))
    await screen.findByText(/so the swap now pays out WETH/)
    expect(fake.state.sent.map((tx) => tx.to)).toEqual([USDC])
    expect(pageText()).toContain('Your approval went through, and you paid its network fee.')
  })
})

describe('a transaction the wallet took in a view that has since gone', () => {
  /** Swaps 0.1 ETH with every receipt held: the swap is sent and stays pending. */
  async function pendingSwap() {
    const fake = wallet()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    answering(fake, async (args, inner) => {
      if (args.method === 'eth_getTransactionReceipt') await gate
      return inner()
    })
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('link', { name: 'View the transaction on Basescan' })
    // The view that sent it shows it once, as its own.
    expect(pageText()).not.toContain('before this view changed')
    return { fake, release }
  }
  const swapLink = () => screen.getByRole('link', { name: 'View the swap on Basescan' })

  it('keeps the link after "Use another wallet"', async () => {
    const { release } = await pendingSwap()
    fireEvent.click(screen.getByRole('button', { name: 'Use another wallet' }))
    await screen.findByRole('heading', { name: 'Connect a wallet' })
    expect(pageText()).toContain('A swap you signed was sent before this view changed')
    expect(swapLink().getAttribute('href')).toMatch(/^https:\/\/basescan\.org\/tx\/0x/)
    release()
  })

  it('keeps the link on another network and back on Base', async () => {
    const { fake, release } = await pendingSwap()
    fake.emit('chainChanged', '0x1')
    await screen.findByRole('heading', { name: 'Wrong network' })
    expect(swapLink()).toBeTruthy()
    fake.emit('chainChanged', '0x2105')
    await screen.findByRole('heading', { name: 'Your swap' })
    expect(swapLink()).toBeTruthy()
    release()
  })

  it('keeps the link after the wallet switches account', async () => {
    const { fake, release } = await pendingSwap()
    fake.emit('accountsChanged', ['0x00000000000000000000000000000000000b0b00'])
    await screen.findByRole('heading', { name: 'Your swap' })
    await waitFor(() => expect(swapLink()).toBeTruthy())
    release()
  })
})
