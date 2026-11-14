/**
 * The gas limit of the EOA path: the approval and the swap go out with `gas` set to the wallet's
 * `eth_estimateGas` of the exact transaction (suffix included) × 125 / 100, rounded up, plus
 * 150,000 (send.ts `GAS_ALLOWANCE`), so a wallet that would sign at the bare estimate does not run
 * out of gas inside the router or the pool's fee lookup. An estimate that reverts sends nothing; a
 * wallet that cannot estimate is left to set the limit; a smart wallet's `wallet_sendCalls`
 * carries no gas. The review's network fee is the same estimate of the swap, at the wallet's
 * `eth_gasPrice`, a read that sends nothing; it is left to the wallet before an approval, for a
 * smart wallet and when it cannot be read. Hermetic: the fake wallet of testing/fakeWallet.ts.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ACCOUNT } from '../testing/fakeWallet.js'
import {
  connect,
  enter,
  ONE_ETH,
  renderPanel,
  review,
  SUFFIX,
  suffixCount,
  UNISWAP,
  USDC,
  wallet,
} from '../testing/tradeHarness.js'

afterEach(() => cleanup())

describe('the gas limit of an EOA’s transactions', () => {
  it('is the estimate of the exact transaction × 1.25, rounded up, plus 150,000, for the approval and the swap', async () => {
    const fake = wallet()
    fake.state.estimate = 180_001n
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and swap' }))
    await screen.findByRole('heading', { name: 'Swap complete' })
    expect(fake.state.sent.map((tx) => [tx.to, tx.gas])).toEqual([
      [USDC, 375_002n],
      [UNISWAP.router, 375_002n],
    ])
    // Each estimate is of the bytes then sent: from the account, the suffix once, at the end.
    expect(fake.state.estimates).toEqual(fake.state.sent.map(({ gas: _gas, ...tx }) => tx))
    for (const tx of fake.state.sent) {
      expect(tx.from).toBe(ACCOUNT)
      expect(tx.data.endsWith(SUFFIX)).toBe(true)
      expect(suffixCount(tx.data)).toBe(1)
    }
  })

  it('estimates an ETH-in swap with its value', async () => {
    const fake = wallet()
    fake.state.estimate = 100_000n
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Swap complete' })
    // The review's network fee, then the swap step's own estimate of what it signs.
    expect(fake.state.estimates.map((tx) => tx.value)).toEqual([ONE_ETH / 10n, ONE_ETH / 10n])
    expect(fake.state.sent.map((tx) => tx.gas)).toEqual([275_000n])
  })

  it('sends nothing when the estimate of the swap reverts', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fake.state.estimate = 'revert'
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toMatch(
      /^The swap would fail right now, so nothing was sent/,
    )
    // The review's estimate (a read for its fee) and the swap step's, which reverted.
    expect(fake.state.estimates).toHaveLength(2)
    expect(fake.state.methods).not.toContain('eth_sendTransaction')
  })

  it('sends nothing when the estimate of the approval reverts', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fake.state.estimate = 'revert'
    fireEvent.click(screen.getByRole('button', { name: 'Approve and swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toBe(
      'The approval would fail right now, so nothing was sent.',
    )
    expect(fake.state.sent).toEqual([])
  })

  for (const answer of ['unsupported', 'error'] as const)
    it(`sends without a gas limit, the suffix once, when the estimate is ${answer}`, async () => {
      const fake = wallet()
      fake.state.estimate = answer
      renderPanel(fake)
      await connect()
      await enter('100', 'USDC')
      await review()
      fireEvent.click(screen.getByRole('button', { name: 'Approve and swap' }))
      await screen.findByRole('heading', { name: 'Swap complete' })
      expect(fake.state.estimates).toHaveLength(2)
      expect(fake.state.sent.map((tx) => tx.gas)).toEqual([null, null])
      for (const tx of fake.state.sent) {
        expect(tx.data.endsWith(SUFFIX)).toBe(true)
        expect(suffixCount(tx.data)).toBe(1)
      }
    })
})

describe('a smart wallet’s call bundle', () => {
  it('asks for no estimate and carries no gas', async () => {
    const fake = wallet({ dataSuffix: true })
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and swap' }))
    await screen.findByRole('heading', { name: 'Swap complete' })
    expect(fake.state.methods).not.toContain('eth_estimateGas')
    expect(fake.state.bundles).toHaveLength(2)
    for (const bundle of fake.state.bundles) {
      expect(Object.keys(bundle.calls[0] ?? {}).sort()).toEqual(['data', 'to', 'value'])
      expect(suffixCount(bundle.calls[0]!.data)).toBe(0)
    }
  })
})

describe('the network fee on the review', () => {
  /** The fake wallet with `eth_gasPrice` answered at 0.005 gwei. */
  function priced(extra: Parameters<typeof wallet>[0] = {}) {
    const fake = wallet(extra)
    const inner = fake.provider.request.bind(fake.provider)
    fake.provider.request = async (args: { method: string; params?: unknown }) =>
      args.method === 'eth_gasPrice' ? '0x4c4b40' : inner(args)
    return fake
  }
  const feeRow = () => screen.getByText('Network fee').nextElementSibling?.textContent

  it('is the estimate of the swap at the wallet’s gas price, a read that sends nothing', async () => {
    const fake = priced()
    fake.state.estimate = 130_000n
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    await waitFor(() => expect(feeRow()).toBe('Under $0.01'))
    // Base's data fee is not in the estimate: the note under the figures says so.
    const note = screen.getByText(/The network fee goes to Base, not to Depthwatch/).textContent
    expect(note).toContain('Base also charges a small fee for the transaction’s data')
    // The estimate is of the swap as it would be signed: to the router, from the account, the
    // suffix once at the end, the input as value.
    expect(fake.state.estimates).toHaveLength(1)
    const [estimate] = fake.state.estimates
    expect(estimate).toMatchObject({ from: ACCOUNT, to: UNISWAP.router, value: ONE_ETH / 10n })
    expect(estimate!.data.endsWith(SUFFIX)).toBe(true)
    expect(suffixCount(estimate!.data)).toBe(1)
    expect(fake.state.methods).not.toContain('eth_sendTransaction')
  })

  it('is left to the wallet before an approval, for a smart wallet, and when it cannot be read', async () => {
    const cases: [string, ReturnType<typeof wallet>, string][] = [
      ['an approval first', priced(), '100'],
      ['a smart wallet', priced({ dataSuffix: true }), '0.1'],
      ['no gas price', wallet(), '0.1'],
    ]
    for (const [label, fake, amount] of cases) {
      renderPanel(fake)
      await connect()
      await enter(amount, amount === '100' ? 'USDC' : undefined)
      await review()
      await waitFor(() => expect(feeRow(), label).toBe('In your wallet'))
      if (label !== 'no gas price') expect(fake.state.estimates, label).toEqual([])
      cleanup()
    }
  })
})
