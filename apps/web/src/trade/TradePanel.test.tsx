/**
 * The swap panel against a fake EIP-1193 wallet behind viem's `custom()` transport
 * (testing/fakeWallet.ts), up to the review: connect, a cancelled connection, the wrong network,
 * the trade switch read off on connecting, the pool's identity on chain (route, router binding,
 * the factory's `getPool`, the tokens), the way back to the wallet list, the live quote with its
 * block, the tokens' names and addresses on the review, decimals from the allowlist, the balance
 * of the side shown, Max, the size cap, where focus goes when a step fails, the first loading line
 * and no wallet on a phone or a computer. The sends are tradeSend.test.tsx, tradeSafety.test.tsx
 * and tradeOutcomes.test.tsx; "Stop waiting" is tradeStop.test.tsx. Hermetic: the fake answers
 * every request.
 */
import { TOKENS } from '@depthwatch/chain/addresses'
import { minAmountOut } from '@depthwatch/core'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '../App.js'
import {
  client,
  connect,
  detail,
  enter,
  type Fake,
  holdRequest,
  OFF,
  ON,
  ONE_ETH,
  pageText,
  quote,
  renderPanel,
  review,
  SLIP,
  SLIP_POOL,
  UNISWAP,
  USDC,
  V3,
  V3_POOL,
  WETH,
  wallet,
} from '../testing/tradeHarness.js'
import TradePanel, { type TradeDeps } from './TradePanel.js'
import { floorAmount } from './text.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The panel with `deps` of its own (renderPanel's are fixed): discovery; `restHeight` as given. */
function renderWith(deps: Partial<TradeDeps>, restHeight?: number) {
  render(
    <Providers client={client} mock={false} queryClient={new QueryClient()}>
      <TradePanel
        detail={detail}
        venue="uniswap-v3"
        flagsAtLoad={ON}
        deps={{ fetchLiveFlags: async () => ON, pollMs: 1, quoteDelayMs: 0, ...deps }}
        restHeight={restHeight}
      />
    </Providers>,
  )
}

/** A browser whose pointer is coarse (a touch screen) and no wider than a phone. */
function touchScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: coarse') || query.includes('max-width'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

describe('connect and network', () => {
  it('connects through the discovered wallet and checks the pool before quoting', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    expect(screen.getByText(/Connected:/).textContent).toContain('on Base, through Fake Wallet')
    // Identity reads: the pool's factory, the router's factory and the factory's getPool.
    const to = fake.state.calls.map((c) => c.to)
    expect(to).toContain(V3)
    expect(to).toContain(UNISWAP.router)
    expect(to).toContain(UNISWAP.factory)
    expect(fake.state.methods).toContain('wallet_getCapabilities')
  })

  it('says it checks the pool onchain through the wallet while it does', async () => {
    const fake = wallet()
    const pool = holdRequest(fake, (args) => args.method === 'eth_call')
    pool.arm()
    renderPanel(fake)
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    expect(
      await screen.findByText(
        'Checking this pool and its DEX contract onchain, through your wallet…',
      ),
    ).toBeTruthy()
    pool.release()
    await screen.findByRole('heading', { name: 'Your swap' })
  })

  it('says a cancelled connection shared nothing', async () => {
    const fake = wallet()
    fake.state.reject.add('eth_requestAccounts')
    renderPanel(fake)
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'You cancelled the connection in your wallet. Nothing was shared.',
    )
  })

  it('asks a wallet on another network to switch to Base, then goes on', async () => {
    const fake = wallet({ chainId: 1 })
    renderPanel(fake)
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    await screen.findByRole('heading', { name: 'Wrong network' })
    expect(fake.state.calls).toEqual([])
    fake.state.reject.add('wallet_switchEthereumChain')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Base' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'You cancelled the switch to Base in your wallet.',
    )
    fake.state.reject.clear()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Base' }))
    await screen.findByRole('heading', { name: 'Your swap' })
    expect(fake.state.methods).toContain('wallet_switchEthereumChain')
  })

  it('reads the switch again on connecting, and stops before any pool read when it is off', async () => {
    const fake = wallet()
    renderPanel(fake, [OFF])
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    await screen.findByRole('heading', { name: 'Can’t trade this pool' })
    expect(screen.getByRole('alert').textContent).toBe(
      'Swapping in this pool is switched off right now.',
    )
    expect(fake.state.methods).toContain('flags')
    expect(fake.state.calls).toEqual([])
  })

  it('refuses a pool whose factory has no route', async () => {
    // The page's pool answers with another factory: no compiled-in route, so no quote.
    const other = wallet({
      pools: [
        {
          address: V3,
          factory: '0x000000000000000000000000000000000000dead',
          token0: WETH,
          token1: USDC,
          fee: 500,
          tickSpacing: 10,
          sqrtPriceX96: 1n << 96n,
        },
      ],
    })
    renderPanel(other)
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    await screen.findByRole('heading', { name: 'Can’t trade this pool' })
    expect(screen.getByRole('alert').textContent).toMatch(
      /DEX contract is not on Depthwatch’s list/,
    )
    expect(other.state.calls.some((c) => c.to === UNISWAP.quoter)).toBe(false)
  })

  /** Connects to `fake` and expects the pool refused with `reason`, before any quote. */
  async function refused(fake: Fake, reason: RegExp) {
    renderPanel(fake)
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    await screen.findByRole('heading', { name: 'Can’t trade this pool' })
    expect(screen.getByRole('alert').textContent).toMatch(reason)
    expect(fake.state.calls.some((c) => c.to === UNISWAP.quoter)).toBe(false)
  }
  const MISMATCH = /^The pool onchain does not match this page/

  it('refuses a pool its factory does not list for these tokens and fee', async () => {
    // The factory's getPool names another contract (the fake answers with the first match).
    const decoy = { ...V3_POOL, address: '0x0000000000000000000000000000000000b0b000' as const }
    await refused(wallet({ pools: [decoy, V3_POOL, SLIP_POOL] }), MISMATCH)
  })

  it('refuses a pool whose tokens on chain are not the page’s', async () => {
    // The factory lists it for its own tokens: only the comparison with the page stops it.
    const other = { ...V3_POOL, token1: TOKENS.USDBC.address }
    await refused(wallet({ pools: [other, SLIP_POOL] }), MISMATCH)
  })

  it('refuses a route whose router is bound to another factory', async () => {
    const fake = wallet({ routerFactory: '0x000000000000000000000000000000000000dead' })
    await refused(fake, /DEX contract is not on Depthwatch’s list/)
  })

  it('offers another wallet from the wrong network and from a pool it can’t trade', async () => {
    renderPanel(wallet({ chainId: 1 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    await screen.findByRole('heading', { name: 'Wrong network' })
    fireEvent.click(screen.getByRole('button', { name: 'Use another wallet' }))
    await screen.findByRole('heading', { name: 'Connect a wallet' })
    cleanup()
    renderPanel(wallet(), [OFF])
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    await screen.findByRole('heading', { name: 'Can’t trade this pool' })
    fireEvent.click(screen.getByRole('button', { name: 'Use another wallet' }))
    await screen.findByRole('heading', { name: 'Connect a wallet' })
  })

  it('offers another wallet while a connection waits in the wallet', async () => {
    const fake = wallet()
    holdRequest(fake, (args) => args.method === 'eth_requestAccounts').arm()
    renderPanel(fake)
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    await screen.findByRole('heading', { name: 'Connecting' })
    fireEvent.click(screen.getByRole('button', { name: 'Use another wallet' }))
    await screen.findByRole('heading', { name: 'Connect a wallet' })
  })

  it('puts focus back on the heading when the wallet refuses to switch', async () => {
    const fake = wallet({ chainId: 1 })
    renderPanel(fake)
    fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
    const heading = await screen.findByRole('heading', { name: 'Wrong network' })
    fake.state.reject.add('wallet_switchEthereumChain')
    const button = screen.getByRole('button', { name: 'Switch to Base' })
    button.focus()
    fireEvent.click(button)
    await screen.findByRole('alert')
    expect(document.activeElement).toBe(heading)
  })
})

describe('quote and review', () => {
  it('quotes live through the wallet and shows about, at least and the block', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    const text = pageText()
    expect(text).toContain('You receive about 384.0 USDC')
    const min = minAmountOut(quote(ONE_ETH / 10n, WETH), 50)
    expect(text).toContain(`at least ${floorAmount(min, 6)} USDC`)
    expect(text).toContain('block 30,000,000')
    expect(fake.state.calls.some((c) => c.to === UNISWAP.quoter)).toBe(true)
    // The reference pool of the same pair is read too, as a bound only.
    expect(fake.state.calls.some((c) => c.to === SLIP)).toBe(true)
  })

  it('shows each token of the review with its name and address on Base, linked to Basescan', async () => {
    renderPanel(wallet())
    await connect()
    await enter('100', 'USDC')
    await review()
    // Below 840 px "Contracts and addresses" starts closed (from 840 px it is open, with no
    // trigger); jsdom applies no media query, so it is opened here.
    fireEvent.click(screen.getByRole('button', { name: 'Contracts and addresses' }))
    const text = pageText()
    expect(text).toContain('You sendUSDC USD Coin0x8335…2913')
    expect(text).toContain('You receiveETH, paid out from WETH Wrapped Ether0x4200…0006')
    const tokenLinks = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .filter((href) => href?.includes('/token/'))
    expect(tokenLinks).toEqual([
      `https://basescan.org/token/${USDC}`,
      `https://basescan.org/token/${WETH}`,
    ])
    // Each address is named by what it is, its shortened form included (label in name).
    expect(screen.getByRole('link', { name: 'USDC token 0x8335…2913 on Basescan' })).toHaveProperty(
      'title',
      USDC,
    )
    const router = screen.getByRole('link', {
      name: 'Uniswap SwapRouter02 0x2626…e481 on Basescan',
    })
    expect(router.getAttribute('href')).toBe(`https://basescan.org/address/${UNISWAP.router}`)
    expect(
      screen.getByRole('link', { name: 'Uniswap v3 pool 0xd0b5…f224 on Basescan' }),
    ).toBeTruthy()
  })

  it('reads decimals and symbols from the allowlist, not from the page’s data', async () => {
    const pool = { ...detail.pool, token1: { ...detail.pool.token1, decimals: 18 } }
    renderPanel(wallet(), undefined, { ...detail, pool })
    await connect()
    fireEvent.click(screen.getByRole('radio', { name: 'Sell USDC' }))
    expect(await screen.findByText(/Balance: 5,000 USDC/)).toBeTruthy()
  })

  // Another direction, or WETH for ETH: never the last side's raw amount in this side's unit.
  for (const [change, to, token, shown] of [
    ['of direction', () => screen.getByRole('radio', { name: 'Sell USDC' }), USDC, '5,000 USDC'],
    ['from ETH to WETH', () => screen.getByRole('checkbox', { name: /Use ETH/ }), WETH, '1 WETH'],
  ] as const)
    it(`shows no balance and no Max until the balance is read, after a change ${change}`, async () => {
      const fake = wallet()
      const read = holdRequest(fake, (args) => {
        const call = (args.params as { to?: string; data?: string }[] | undefined)?.[0]
        return (
          args.method === 'eth_call' && call?.to === token && !!call.data?.startsWith('0x70a08231')
        )
      })
      renderPanel(fake)
      await connect()
      await screen.findByText(/Balance: 1 ETH/)
      read.arm()
      fireEvent.click(to())
      expect(pageText()).toContain('Balance: reading…')
      expect(screen.queryByRole('button', { name: 'Max' })).toBeNull()
      read.release()
      expect(await screen.findByText(`Balance: ${shown}`, { exact: false })).toBeTruthy()
    })

  it('keeps 0.0005 ETH for network fees on Max', async () => {
    renderPanel(wallet())
    await connect()
    await screen.findByText(/Balance: 1 ETH/)
    fireEvent.click(screen.getByRole('button', { name: 'Max' }))
    expect(screen.getByLabelText(/^You send/)).toHaveProperty('value', '0.9995')
  })

  it('refuses a swap above the size cap with the reason', async () => {
    renderPanel(wallet())
    await connect()
    fireEvent.change(screen.getByLabelText(/^You send/), { target: { value: '0.5' } })
    expect(await screen.findByText(/Swaps are limited to \$1,000 each for now/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review swap' })).toHaveProperty('disabled', true)
  })

  it('puts focus back on the heading when the review fails', async () => {
    const fake = wallet()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    // The review's own quote is refused: the price fell 15 % since the form's.
    fake.state.quoteFactor = 0.85
    const button = screen.getByRole('button', { name: 'Review swap' })
    button.focus()
    fireEvent.click(button)
    expect(await screen.findByText(/would cost .* against the pool’s price/)).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your swap' }))
  })
})

describe('opening and wallets', () => {
  it('shows one loading line, with focus, as tall as the page kept it, until the first look ends', async () => {
    let found: (choices: never[]) => void = () => undefined
    renderWith({ discover: () => new Promise((resolve) => (found = resolve)) }, 224)
    const line = await screen.findByText('Loading the swap panel…')
    expect(document.activeElement).toBe(line)
    expect(screen.queryByRole('heading')).toBeNull()
    // The row's resting height, which the page's own loading line kept: the page holds still.
    expect(line.style.minHeight).toBe('224px')
    found([])
    await screen.findByRole('heading', { name: 'Connect a wallet' })
    expect(document.querySelector('.trade [style*="min-height"]')).toBeNull()
    // Looking again says so under the heading: the panel is already there.
    fireEvent.click(screen.getByRole('button', { name: 'Look again' }))
    expect(await screen.findByText('Looking for wallets in this browser…')).toBeTruthy()
  })

  it('offers a wallet extension on a computer with no wallet', async () => {
    renderWith({ discover: async () => [] })
    expect(await screen.findByText(/Install a wallet extension and reload this page/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open in Coinbase Wallet' })).toBeNull()
  })

  it('offers Coinbase Wallet’s browser and the page’s link on a phone with no wallet', async () => {
    touchScreen()
    renderWith({ discover: async () => [] })
    const open = await screen.findByRole('link', { name: 'Open in Coinbase Wallet' })
    const link = new URL(open.getAttribute('href') ?? '')
    expect(`${link.origin}${link.pathname}`).toBe('https://go.cb-w.com/dapp')
    expect(link.searchParams.get('cb_url')).toBe(window.location.href)
    expect(screen.getByRole('button', { name: 'Copy page link' })).toBeTruthy()
    expect(pageText()).not.toMatch(/extension|Base App/)
  })

  it('gives "Use another wallet" a 44 px touch area', async () => {
    renderPanel(wallet())
    await connect()
    expect(screen.getByRole('button', { name: 'Use another wallet' }).className).toContain(
      'touch-hit',
    )
  })
})
