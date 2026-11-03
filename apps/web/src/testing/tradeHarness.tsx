/**
 * Test harness of the swap panel: the WETH/USDC 0.05 % Uniswap v3 pool of the mock world on a
 * fake wallet (testing/fakeWallet.ts) whose quoter answers 3,842.15 USDC per WETH less the fee,
 * the panel rendered with fake discovery and a scripted trade switch, and the steps a reader takes.
 */
import { TOKENS, TRADE_ROUTES } from '@depthwatch/chain/addresses'
import type { TradeFlags } from '@depthwatch/core'
import { QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Hex } from 'viem'
import { Providers } from '../App.js'
import { createMockClient } from '../api/mock.js'
import type { PoolDetail } from '../api/types.js'
import { BUILDER_SUFFIX } from '../trade/builderCode.js'
import TradePanel from '../trade/TradePanel.js'
import { createFakeWallet, type FakePool, type FakeWalletOptions } from './fakeWallet.js'

const NOW = 1_760_000_000
export const V3 = '0xd0b53d9277642d899df5c87a3966a349a798f224'
export const SLIP = '0xb2cc224c1c9fee385f8ad6a55b4d94e92359dc59'
export const WETH = TOKENS.WETH.address
export const USDC = TOKENS.USDC.address
export const ON: TradeFlags = {
  enabled: true,
  venues: ['uniswap-v3'],
  maxUsd: 1000,
  maxSlippageBps: 300,
}
export const OFF: TradeFlags = { enabled: false, venues: [], maxUsd: 1000, maxSlippageBps: 300 }
export const UNISWAP = TRADE_ROUTES.find((r) => r.venue === 'uniswap-v3')!
export const SLIPSTREAM = TRADE_ROUTES.find((r) => r.deployment === 'initial')!
export const SUFFIX = BUILDER_SUFFIX.slice(2)
export const ONE_ETH = 10n ** 18n

export const client = createMockClient({ now: NOW })
export const detail = await client.pool(`uniswap-v3:${V3}`)

/** sqrtPriceX96 of a human price (token1 per token0). */
export function sqrtOf(price: number, dec0: number, dec1: number): bigint {
  return BigInt(Math.round(Math.sqrt(price * 10 ** (dec1 - dec0)) * 2 ** 96))
}

/** 3,842.15 USDC per WETH less the pool's 0.05 % fee, in raw units. */
export function quote(amountIn: bigint, tokenIn: string): bigint {
  return tokenIn === WETH
    ? (amountIn * 384_215n * 9_995n) / 10n ** 18n
    : (amountIn * 9_995n * 10n ** 10n) / 384_215n
}

/** The page's pool on chain, and the reference pool of the same pair. */
export const V3_POOL: FakePool = {
  address: V3,
  factory: UNISWAP.factory,
  token0: WETH,
  token1: USDC,
  fee: 500,
  tickSpacing: 10,
  sqrtPriceX96: sqrtOf(3842.15, 18, 6),
}
export const SLIP_POOL: FakePool = {
  address: SLIP,
  factory: SLIPSTREAM.factory,
  token0: WETH,
  token1: USDC,
  fee: 400,
  tickSpacing: 100,
  sqrtPriceX96: sqrtOf(3842.4, 18, 6),
}

export function wallet(extra: Partial<FakeWalletOptions> = {}) {
  return createFakeWallet({
    routes: TRADE_ROUTES,
    weth: WETH,
    pools: [V3_POOL, SLIP_POOL],
    quote,
    ethBalance: ONE_ETH,
    balances: { [USDC]: 5_000_000_000n, [WETH]: ONE_ETH },
    ...extra,
  })
}

export type Fake = ReturnType<typeof wallet>

/**
 * Renders the panel; `flags` answers each live read of the switch in turn (then the last), the
 * first one when the panel connects; `setFlags` starts a new list from its first answer. `page`:
 * another pool detail than the harness's (the bundle's data, as the page passes it).
 */
export function renderPanel(
  fake: Fake,
  flags: (TradeFlags | null)[] = [ON],
  page: PoolDetail = detail,
) {
  let reads = 0
  const fetchLiveFlags = async () => {
    fake.state.methods.push('flags')
    const answer = flags[Math.min(reads, flags.length - 1)] ?? null
    reads++
    return answer
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client} mock={false} queryClient={queryClient}>
      <TradePanel
        detail={page}
        venue="uniswap-v3"
        flagsAtLoad={ON}
        deps={{
          discover: async () => [
            { id: 'fake', name: 'Fake Wallet', icon: null, provider: fake.provider },
          ],
          fetchLiveFlags,
          pollMs: 1,
          quoteDelayMs: 0,
        }}
      />
    </Providers>,
  )
  return {
    setFlags: (next: (TradeFlags | null)[]) => {
      flags.splice(0, flags.length, ...next)
      reads = 0
    },
  }
}

export async function connect() {
  fireEvent.click(await screen.findByRole('button', { name: 'Fake Wallet' }))
  await screen.findByRole('heading', { name: 'Your swap' })
}

export async function enter(amount: string, sell?: string) {
  if (sell) fireEvent.click(screen.getByRole('radio', { name: `Sell ${sell}` }))
  fireEvent.change(screen.getByLabelText(/^You send/), { target: { value: amount } })
  await screen.findByText(/and at least/)
}

export async function review() {
  fireEvent.click(screen.getByRole('button', { name: 'Review swap' }))
  await screen.findByRole('heading', { name: 'Review the swap' })
}

type Request = { method: string; params?: unknown }

/**
 * Holds the first wallet request `match` picks once `arm()` was called, until `release()`.
 * Install it before `renderPanel`: viem's `custom()` binds `request` when the client is made.
 */
export function holdRequest(fake: Fake, match: (args: Request) => boolean) {
  const inner = fake.provider.request.bind(fake.provider)
  let armed = false
  let reached = false
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  fake.provider.request = async (args: Request) => {
    if (armed && !reached && match(args)) {
      reached = true
      await gate
    }
    return inner(args)
  }
  return {
    arm: () => {
      armed = true
    },
    reached: () => reached,
    release: () => release(),
  }
}

/** An `eth_call` to `to` (lowercase), other than its `factory()` view. */
export const callTo = (to: string) => (args: Request) => {
  const call = (args.params as { to?: string; data?: string }[] | undefined)?.[0]
  return (
    args.method === 'eth_call' &&
    call?.to?.toLowerCase() === to &&
    !call.data?.startsWith('0xc45a0155')
  )
}

/** The page's text with no-break spaces as spaces. */
export const pageText = () => (document.body.textContent ?? '').replace(/\u00a0/g, ' ')

/** Opens the outcome's Details. */
export const details = () => fireEvent.click(screen.getByRole('button', { name: 'Details' }))

/** Occurrences of the suffix in `data`. */
export const suffixCount = (data: Hex) => data.split(SUFFIX).length - 1
