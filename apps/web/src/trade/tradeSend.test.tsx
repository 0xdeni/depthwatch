/**
 * The swap panel's sends against a fake EIP-1193 wallet behind viem's `custom()` transport: approve
 * then swap with the Builder Code once at the end of the data and the compiled-in router as `to`,
 * ETH in, the smart-wallet capability path (the suffix as `dataSuffix`, never in the calldata), a
 * rejection in the wallet, a revert, a failed simulation, a re-quote that moved and the trade
 * switch turned off between the review and the signature. Hermetic.
 */
import { tradeErc20Abi } from '@depthwatch/chain/addresses'
import { minAmountOut } from '@depthwatch/core'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { decodeFunctionData } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import { ACCOUNT } from '../testing/fakeWallet.js'
import { decodeSwap } from '../testing/swapCalldata.js'
import {
  connect,
  details,
  enter,
  OFF,
  ON,
  ONE_ETH,
  pageText,
  quote,
  renderPanel,
  review,
  SUFFIX,
  suffixCount,
  UNISWAP,
  USDC,
  WETH,
  wallet,
} from '../testing/tradeHarness.js'
import { BUILDER_SUFFIX, decodeBuilderCodes } from './builderCode.js'

afterEach(() => cleanup())

describe('approve and swap (EOA: the suffix in the calldata)', () => {
  it('approves exactly the amount, then swaps USDC for ETH through the router', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('100', 'USDC')
    await review()
    expect(pageText()).toContain('You send exactly 100 USDC.')
    expect(pageText()).toContain('Allow the DEX contract to use exactly 100 USDC')
    fireEvent.click(screen.getByRole('button', { name: /^Approve 100\sUSDC$/ }))
    await screen.findByRole('heading', { name: 'Swap done' })

    const [approve, swap] = fake.state.sent
    expect(fake.state.sent).toHaveLength(2)
    // The approval: to the token, for exactly the input, to the router, suffix once at the end.
    expect(approve?.to).toBe(USDC)
    expect(approve?.data.endsWith(SUFFIX)).toBe(true)
    expect(suffixCount(approve!.data)).toBe(1)
    const { args } = decodeFunctionData({ abi: tradeErc20Abi, data: approve!.data })
    expect(args).toEqual([expect.stringMatching(new RegExp(UNISWAP.router, 'i')), 100_000_000n])
    // The swap: to the compiled-in router, suffix once at the end, recipient never anyone else.
    expect(swap?.to).toBe(UNISWAP.router)
    expect(swap?.data.endsWith(SUFFIX)).toBe(true)
    expect(suffixCount(swap!.data)).toBe(1)
    expect(swap?.value).toBe(0n)
    const decoded = decodeSwap(UNISWAP, swap!.data)!
    expect(decoded.tokenIn).toBe(USDC)
    expect(decoded.tokenOut).toBe(WETH)
    expect(decoded.amountIn).toBe(100_000_000n)
    // SwapRouter02's ADDRESS_THIS, address(2): the router keeps the WETH for unwrapWETH9.
    expect(decoded.recipient).toBe('0x0000000000000000000000000000000000000002')
    expect(decoded.unwrap).toEqual({
      amountMinimum: decoded.amountOutMinimum,
      recipient: expect.stringMatching(new RegExp(ACCOUNT, 'i')),
    })
    expect(decoded.amountOutMinimum).toBe(minAmountOut(quote(100_000_000n, USDC), 50))
    expect(decoded.multicallDeadline).toBe(1_760_000_000n + 300n)
    // Each was simulated as signed (suffix included, from the account) before it was sent.
    for (const tx of [approve!, swap!])
      expect(
        fake.state.calls.some(
          (c) => c.to === tx.to && c.data === tx.data && c.from?.toLowerCase() === ACCOUNT,
        ),
      ).toBe(true)
    // The switch was read right before each signature request (viem asks the chain id between).
    const m = fake.state.methods
    m.forEach((method, i) => {
      if (method === 'eth_sendTransaction')
        expect(m.slice(i - 2, i)).toEqual(['flags', 'eth_chainId'])
    })
    expect(pageText()).toMatch(/You received 0\.02601\d* ETH\./)
    details()
    expect(pageText()).toContain('bc_j6obesn8, read back from the transaction’s input.')
  })

  it('pays ETH in as value with WETH as tokenIn and no approval', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Swap done' })
    expect(fake.state.sent).toHaveLength(1)
    const [swap] = fake.state.sent
    expect(swap?.value).toBe(ONE_ETH / 10n)
    const decoded = decodeSwap(UNISWAP, swap!.data)!
    expect([decoded.tokenIn, decoded.tokenOut, decoded.recipient]).toEqual([WETH, USDC, ACCOUNT])
    expect(decoded.unwrap).toBeNull()
  })
})

describe('smart wallet: the suffix as the dataSuffix capability', () => {
  it('sends wallet_sendCalls with dataSuffix { value, optional: false } and plain calldata', async () => {
    const fake = wallet({ dataSuffix: true })
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Swap done' })
    expect(fake.state.methods).not.toContain('eth_sendTransaction')
    expect(fake.state.bundles).toHaveLength(1)
    const [bundle] = fake.state.bundles
    expect(bundle?.capabilities).toEqual({ dataSuffix: { value: BUILDER_SUFFIX, optional: false } })
    const call = bundle!.calls[0]!
    expect(call.to.toLowerCase()).toBe(UNISWAP.router)
    expect(decodeBuilderCodes(call.data)).toBeNull()
    details()
    expect(fake.state.calls.some((c) => c.to === UNISWAP.router && c.data === call.data)).toBe(true)
    expect(pageText()).toContain('bc_j6obesn8, read back from the transaction’s input.')
  })
})

describe('what can go wrong', () => {
  it('says a swap rejected in the wallet sent nothing', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fake.state.reject.add('eth_sendTransaction')
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toBe('Cancelled; nothing was sent.')
    expect(fake.state.sent).toEqual([])
  })

  it('says a reverted swap cost only the network fee, with the transaction link', async () => {
    const fake = wallet()
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
    expect(
      screen.getByRole('link', { name: /View the transaction on Basescan/ }).getAttribute('href'),
    ).toMatch(/^https:\/\/basescan\.org\/tx\/0x/)
  })

  it('sends nothing when the simulation of the exact transaction fails', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fake.state.failSimulation = true
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toMatch(
      /^The swap would fail right now, so nothing was sent/,
    )
    expect(fake.state.sent).toEqual([])
  })

  it('re-quotes before signing and goes back to the review when the minimum fell', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    fake.state.quoteFactor = 0.99
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    expect(await screen.findByText(/The price moved since you reviewed/)).toBeTruthy()
    expect(fake.state.sent).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Swap done' })
    const decoded = decodeSwap(UNISWAP, fake.state.sent[0]!.data)!
    const lower = (quote(ONE_ETH / 10n, WETH) * 990_000n) / 1_000_000n
    expect(decoded.amountOutMinimum).toBe(minAmountOut(lower, 50))
  })

  it('blocks the send when the switch is turned off between the review and the signature', async () => {
    const fake = wallet()
    const panel = renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    panel.setFlags([OFF])
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(screen.getByRole('alert').textContent).toBe(
      'Swapping in this pool is switched off right now. Nothing was sent.',
    )
    expect(fake.state.sent).toEqual([])
  })

  it('blocks the send when only the read right before the signature says off', async () => {
    const fake = wallet()
    const panel = renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    // On for the fresh quote, then off (unreadable) immediately before the wallet prompt.
    panel.setFlags([ON, null])
    const before = fake.state.methods.length
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await screen.findByRole('heading', { name: 'Not swapped' })
    expect(fake.state.sent).toEqual([])
    const reads = () => fake.state.methods.slice(before).filter((m) => m === 'flags')
    await waitFor(() => expect(reads()).toHaveLength(2))
  })
})
