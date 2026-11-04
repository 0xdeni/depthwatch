/**
 * The gas limit of the EOA path: the approval and the swap go out with `gas` set to the wallet's
 * `eth_estimateGas` of the exact transaction (suffix included) × 125 / 100, rounded up, so a wallet
 * that would sign at the bare estimate does not run out of gas inside the router. An estimate that
 * reverts sends nothing; a wallet that cannot estimate is left to set the limit; a smart wallet's
 * `wallet_sendCalls` carries no gas. Hermetic: the fake wallet of testing/fakeWallet.ts.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react'
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
  it('is the estimate of the exact transaction × 1.25, rounded up, for the approval and the swap', async () => {
    const fake = wallet()
    fake.state.estimate = 180_001n
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fireEvent.click(screen.getByRole('button', { name: /^Approve 100\sUSDC$/ }))
    await screen.findByRole('heading', { name: 'Swap done' })
    expect(fake.state.sent.map((tx) => [tx.to, tx.gas])).toEqual([
      [USDC, 225_002n],
      [UNISWAP.router, 225_002n],
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
    await screen.findByRole('heading', { name: 'Swap done' })
    expect(fake.state.estimates.map((tx) => tx.value)).toEqual([ONE_ETH / 10n])
    expect(fake.state.sent.map((tx) => tx.gas)).toEqual([125_000n])
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
    expect(fake.state.estimates).toHaveLength(1)
    expect(fake.state.methods).not.toContain('eth_sendTransaction')
  })

  it('sends nothing when the estimate of the approval reverts', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    fake.state.estimate = 'revert'
    fireEvent.click(screen.getByRole('button', { name: /^Approve 100\sUSDC$/ }))
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
      fireEvent.click(screen.getByRole('button', { name: /^Approve 100\sUSDC$/ }))
      await screen.findByRole('heading', { name: 'Swap done' })
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
    fireEvent.click(screen.getByRole('button', { name: /^Approve 100\sUSDC$/ }))
    await screen.findByRole('heading', { name: 'Swap done' })
    expect(fake.state.methods).not.toContain('eth_estimateGas')
    expect(fake.state.bundles).toHaveLength(2)
    for (const bundle of fake.state.bundles) {
      expect(Object.keys(bundle.calls[0] ?? {}).sort()).toEqual(['data', 'to', 'value'])
      expect(suffixCount(bundle.calls[0]!.data)).toBe(0)
    }
  })
})
