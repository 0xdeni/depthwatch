/**
 * What the swap panel says and does when things go sideways after a signature request was
 * possible: a smart wallet's user operation reverting inside a bundle that succeeds, a swap
 * included with no payment found, the panel leaving or the account changing while an approval is
 * pending or while a swap with no approval is being checked (no further wallet prompt), a wallet
 * that left Base without saying so, a quote that would fill only part of the input, an allowance
 * that changed between the review and the click, an approval that went through before the swap
 * was cancelled or would fail, and a smart contract account that does not offer the `dataSuffix`
 * capability (its code not found in the transaction's input). Hermetic: the fake wallet of
 * testing/fakeWallet.ts.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ACCOUNT } from '../testing/fakeWallet.js'
import {
  callTo,
  connect,
  details,
  enter,
  type Fake,
  holdRequest,
  pageText,
  renderPanel,
  review,
  UNISWAP,
  USDC,
  wallet,
} from '../testing/tradeHarness.js'

afterEach(() => cleanup())

/** Holds every receipt answer until `release()`: the approval stays pending until then. */
function holdReceipts(fake: Fake) {
  const inner = fake.provider.request.bind(fake.provider)
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  fake.provider.request = async (args: { method: string; params?: unknown }) => {
    if (args.method === 'eth_getTransactionReceipt') await gate
    return inner(args)
  }
  return () => release()
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const OTHER = '0x00000000000000000000000000000000000b0b00'
const PARTIAL = 'The pool can’t fill this whole amount. Try a smaller one.'

describe('outcomes the wallet reports', () => {
  it('says a smart wallet’s reverted user operation swapped nothing, though its bundle succeeded', async () => {
    const fake = wallet({ dataSuffix: true })
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fake.state.revertNext = true
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toBe(
      'Nothing was swapped; you paid only the network fee.',
    )
    expect(screen.queryByRole('heading', { name: 'Swap complete' })).toBeNull()
    // The bundle transaction itself reads as successful: only the wallet's status says otherwise.
    expect(fake.state.methods).toContain('wallet_getCallsStatus')
  })

  it('does not say "Swap complete" when the included swap paid nothing to the account', async () => {
    const fake = wallet()
    const inner = fake.provider.request.bind(fake.provider)
    fake.provider.request = async (args: { method: string; params?: unknown }) => {
      const answer = (await inner(args)) as Record<string, unknown> | null
      return args.method === 'eth_getTransactionReceipt' && answer
        ? { ...answer, logs: [] }
        : answer
    }
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Swap included, not confirmed' })
    expect(pageText()).toContain('found no payment to your account in it')
    expect(screen.getByRole('link', { name: 'View the swap on Basescan' })).toBeTruthy()
  })
})

describe('a flow whose panel has gone asks the wallet for nothing more', () => {
  it('sends no swap after the panel unmounts while the approval is pending', async () => {
    const fake = wallet()
    const release = holdReceipts(fake)
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and swap' }))
    await waitFor(() => expect(fake.state.sent).toHaveLength(1))
    cleanup()
    release()
    await settle()
    expect(fake.state.sent).toHaveLength(1)
    expect(fake.state.sent[0]?.to).toBe(USDC)
  })

  it('sends no swap from the old account after the wallet switches account', async () => {
    const fake = wallet()
    const release = holdReceipts(fake)
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and swap' }))
    await waitFor(() => expect(fake.state.sent).toHaveLength(1))
    fake.emit('accountsChanged', ['0x00000000000000000000000000000000000b0b00'])
    release()
    await screen.findByRole('heading', { name: 'Your swap' })
    await settle()
    expect(fake.state.sent).toHaveLength(1)
    expect(fake.state.sent.some((tx) => tx.to === UNISWAP.router)).toBe(false)
  })

  // A swap with no approval step (ETH in): only the check right before the signature stops it.
  for (const [leave, how] of [
    ['the panel unmounts', () => cleanup()],
    ['the wallet switches account', (fake: Fake) => fake.emit('accountsChanged', [OTHER])],
  ] as const)
    it(`sends no swap when ${leave} while the swap is being checked`, async () => {
      const fake = wallet()
      const hold = holdRequest(fake, callTo(UNISWAP.router))
      renderPanel(fake)
      await connect()
      await enter('0.1')
      await review()
      hold.arm()
      fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
      await waitFor(() => expect(hold.reached()).toBe(true))
      how(fake)
      hold.release()
      await settle()
      expect(fake.state.sent).toEqual([])
      expect(fake.state.methods).not.toContain('eth_sendTransaction')
    })
})

describe('checks right before the signature request', () => {
  it('sends nothing when the wallet left Base without saying so', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fake.state.chainId = 1
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toBe(
      'The swap was not sent: the wallet is no longer on Base',
    )
    expect(fake.state.methods).not.toContain('eth_sendTransaction')
  })

  it('refuses a quote that would fill only part of the input, on the form', async () => {
    const fake = wallet()
    fake.state.quoteAtLimit = true
    renderPanel(fake)
    await connect()
    fireEvent.change(screen.getByLabelText(/^You send/), { target: { value: '0.1' } })
    expect(await screen.findByText(PARTIAL)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review swap' })).toHaveProperty('disabled', true)
    expect(fake.state.methods).not.toContain('eth_sendTransaction')
    expect(fake.state.methods).not.toContain('wallet_sendCalls')
  })

  it('refuses a fresh quote that would fill only part of the input, before the signature', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fake.state.quoteAtLimit = true
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toBe(PARTIAL)
    expect(fake.state.sent).toEqual([])
  })
})

describe('an allowance that changed between the review and the click', () => {
  const KEY = `${USDC}:${ACCOUNT}:${UNISWAP.router}`

  it('asks for no approval when the allowance already covers the amount', async () => {
    const fake = wallet()
    fake.state.allowances.set(KEY, 100_000_000n)
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    expect(pageText()).toContain('Your wallet will ask once, to swap: an earlier approval already')
    expect(pageText()).not.toContain('ask twice')
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Swap complete' })
    expect(fake.state.sent.map((tx) => tx.to)).toEqual([UNISWAP.router])
  })

  it('skips the approval when one arrived after the review', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fake.state.allowances.set(KEY, 100_000_000n)
    fireEvent.click(screen.getByRole('button', { name: 'Approve and swap' }))
    const done = await screen.findByRole('heading', { name: 'Swap complete' })
    expect(fake.state.sent.map((tx) => tx.to)).toEqual([UNISWAP.router])
    expect(pageText()).not.toContain('Your approval went through')
    // No approval was sent, though the review expected one: the receipt names none and links none.
    const receipt = done.closest('.trade-done')?.textContent ?? ''
    expect(receipt).not.toMatch(/Your approval|approve exactly|can still use|can’t take more/)
    expect(screen.queryByRole('link', { name: 'View the approval on Basescan' })).toBeNull()
  })

  it('stops with the reason when the allowance fell after the review', async () => {
    const fake = wallet()
    fake.state.allowances.set(KEY, 100_000_000n)
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    // The fake's simulation ignores allowances, as the stop must come first.
    fake.state.allowances.set(KEY, 0n)
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toBe(
      'The approval does not cover this amount yet. Nothing was sent.',
    )
    expect(fake.state.sent).toEqual([])
  })
})

describe('an approval that went through before the swap was not made', () => {
  it('says the swap was cancelled, the approval paid its fee and still allows the amount', async () => {
    const fake = wallet()
    // The approval is signed; the swap's prompt is then turned down.
    const inner = fake.provider.request.bind(fake.provider)
    fake.provider.request = async (args: { method: string; params?: unknown }) => {
      if (args.method === 'eth_sendTransaction' && fake.state.sent.length === 1)
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      return inner(args)
    }
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toBe(
      'You cancelled the swap, so it was not sent.',
    )
    expect(pageText()).toContain(
      'Your approval went through, and you paid its network fee. The DEX contract may still use exactly 100 USDC of yours',
    )
    expect(pageText()).not.toContain('nothing was sent')
    const link = screen.getByRole('link', { name: 'View the approval on Basescan' })
    expect(link.getAttribute('href')).toMatch(/^https:\/\/basescan\.org\/tx\/0x/)
  })

  it('says the swap would fail and was not sent, keeping the approval’s link', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    // Simulations of the approval pass; the swap's simulation (to the router) fails.
    fake.state.failSimulation = true
    fireEvent.click(screen.getByRole('button', { name: 'Approve and swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(fake.state.sent).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toMatch(
      /^The swap would fail right now, so it was not sent\./,
    )
    expect(pageText()).toContain('Your approval went through')
    expect(screen.getByRole('link', { name: 'View the approval on Basescan' })).toBeTruthy()
  })
})

describe('a smart contract account without the dataSuffix capability', () => {
  it('signs on the EOA path and says on the review that the code may not be recorded', async () => {
    const fake = wallet({ accountCode: '0x6080604052' })
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    expect(pageText()).toContain('may not be recorded for this swap')
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Swap complete' })
    expect(fake.state.sent[0]?.from).toBe(ACCOUNT)
  })

  it('says the code was not found when the wallet wrapped the calldata in its own call', async () => {
    const fake = wallet({ accountCode: '0x6080604052', wrapSent: true })
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Swap complete' })
    details()
    expect(pageText()).toContain(
      'Not found in the transaction’s input. The swap itself is not affected.',
    )
    expect(pageText()).not.toContain('read back from')
  })

  it('says nothing of the kind for an EIP-7702 account or an EOA', async () => {
    for (const accountCode of [`0xef0100${'12'.repeat(20)}`, '0x'] as const) {
      renderPanel(wallet({ accountCode }))
      await connect()
      await enter('0.1')
      await review()
      expect(pageText()).not.toContain('may not be recorded')
      cleanup()
    }
  })
})
