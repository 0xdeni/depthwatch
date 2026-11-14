/**
 * "Stop waiting": a wallet that shows no request for a while gets a way out, which ends the run
 * (its swap asks the wallet for nothing more) and starts a fresh form. A request the reader still
 * confirms in the wallet later is sent: it takes the place of the "stopped waiting" note, stays in
 * view after the fresh run sends its own, and an approval sent that way is never credited to a
 * later swap's receipt. Against the fake EIP-1193 wallet (testing/fakeWallet.ts); hermetic.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Providers } from '../App.js'
import {
  client,
  connect,
  detail,
  enter,
  type Fake,
  holdRequest,
  ON,
  ONE_ETH,
  pageText,
  review,
  UNISWAP,
  USDC,
  wallet,
} from '../testing/tradeHarness.js'
import TradePanel from './TradePanel.js'

afterEach(() => cleanup())

/** The panel on `fake`, offering "Stop waiting" as soon as a request shows nothing. */
function renderStoppable(fake: Fake) {
  render(
    <Providers client={client} mock={false} queryClient={new QueryClient()}>
      <TradePanel
        detail={detail}
        venue="uniswap-v3"
        flagsAtLoad={ON}
        deps={{
          discover: async () => [
            { id: 'fake', name: 'Fake Wallet', icon: null, provider: fake.provider },
          ],
          fetchLiveFlags: async () => ON,
          pollMs: 1,
          quoteDelayMs: 0,
          waitHintMs: 1,
        }}
      />
    </Providers>,
  )
}

/** Confirms the review with `button`, then stops waiting for the held request. */
async function stopWaiting(button: string) {
  fireEvent.click(screen.getByRole('button', { name: button }))
  expect(await screen.findByText(/^Don’t see the request\? Open your wallet/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }))
  await screen.findByRole('heading', { name: 'Your swap' })
  expect(pageText()).toContain('You stopped waiting. If your wallet still shows the request')
}

/** Swaps 0.1 ETH in the fresh form, through to its receipt. */
async function swapEth() {
  await enter('0.1')
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
  return screen.findByRole('heading', { name: 'Swap complete' })
}

const isApproval = (data: string) => data.startsWith('0x095ea7b3')
const follows = (a: Node, b: Node) =>
  !!(a.compareDocumentPosition(b) & a.DOCUMENT_POSITION_FOLLOWING)

describe('stop waiting', () => {
  it('ends the run; a swap confirmed later takes the place of the note, above the fresh form', async () => {
    const fake = wallet()
    const hold = holdRequest(fake, (args) => args.method === 'eth_sendTransaction')
    renderStoppable(fake)
    await connect()
    await enter('0.1')
    await review()
    hold.arm()
    await stopWaiting('Swap')
    // The reader confirms it in the wallet after all: it is sent once, and said where the note was.
    hold.release()
    const note = await screen.findByText(/^The swap you stopped waiting for was confirmed/)
    expect(note.textContent).toContain('It may still be pending: check it before you swap again.')
    expect(within(note).getByRole('link', { name: 'View the swap on Basescan' })).toBeTruthy()
    expect(note.getAttribute('role')).toBe('alert')
    expect(pageText()).not.toContain('You stopped waiting.')
    // Below the connection line and above the fresh form, not above the panel's top.
    expect(follows(screen.getByText(/^Connected:/), note)).toBe(true)
    expect(follows(note, screen.getByRole('heading', { name: 'Your swap' }))).toBe(true)
    expect(fake.state.sent).toHaveLength(1)
  })

  it('an approval confirmed later asks for no swap and is not credited to a later swap’s receipt', async () => {
    const fake = wallet()
    const hold = holdRequest(fake, (args) => args.method === 'eth_sendTransaction')
    renderStoppable(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    hold.arm()
    await stopWaiting('Approve and swap')
    // A swap of ETH in the fresh run, then the approval left waiting is confirmed in the wallet.
    const done = (await swapEth()).closest('.trade-done') as HTMLElement
    hold.release()
    await screen.findByText(/^The approval you stopped waiting for was confirmed/)
    // The receipt says nothing of that approval: it was not this swap's, and its 100 USDC is
    // still approved.
    const receipt = (done.textContent ?? '').replace(/ /g, ' ')
    expect(receipt).not.toMatch(/approv|can’t take more/i)
    expect(within(done).queryByRole('link', { name: 'View the approval on Basescan' })).toBeNull()
    // The stopped run asked for no swap: the fresh run's swap, then the late approval, only.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake.state.sent.map((tx) => (isApproval(tx.data) ? 'approval' : 'swap'))).toEqual([
      'swap',
      'approval',
    ])
    expect(fake.state.sent[0]!.value).toBe(ONE_ETH / 10n)
    expect(fake.state.allowances.get(`${USDC}:${fake.state.sent[1]!.from}:${UNISWAP.router}`)).toBe(
      100_000_000n,
    )
  })

  it('keeps an approval confirmed later in view after the fresh run sends its own swap', async () => {
    const fake = wallet()
    const hold = holdRequest(fake, (args) => args.method === 'eth_sendTransaction')
    renderStoppable(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    hold.arm()
    await stopWaiting('Approve and swap')
    hold.release()
    const note = await screen.findByText(/^The approval you stopped waiting for was confirmed/)
    expect(note.textContent).toContain('No swap follows it')
    const done = (await swapEth()).closest('.trade-done') as HTMLElement
    // Still there, with its link, above the receipt of the swap that followed.
    expect(screen.getByText(/^The approval you stopped waiting for was confirmed/)).toBe(note)
    expect(within(note).getByRole('link', { name: 'View the approval on Basescan' })).toBeTruthy()
    expect(follows(note, done)).toBe(true)
    expect(within(done).queryByRole('link', { name: 'View the approval on Basescan' })).toBeNull()
    expect(fake.state.sent.map((tx) => (isApproval(tx.data) ? 'approval' : 'swap'))).toEqual([
      'approval',
      'swap',
    ])
  })
})
