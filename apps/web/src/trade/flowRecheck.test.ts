/**
 * The re-check right before a signature request (`recheckedMinOut` of flow.ts): the swap quotes
 * again, and while the fresh quote still pays at least the minimum the reader reviewed it is signed
 * at the higher of that minimum and the fresh quote's own, never below the reviewed one; a fresh
 * quote below the reviewed minimum goes back to the review and asks the wallet for nothing. The
 * re-check changes the minimum only: router, value, deadline, tokens and fee, recipient and the
 * Builder Code suffix are those of the same swap without it. Exact input is the panel's only kind
 * of swap; ETH out carries the same minimum in `unwrapWETH9`. Hermetic: the fake wallet of
 * testing/fakeWallet.ts, the flow's own functions called as TradeSwap calls them.
 */
import { TRADE_TOKENS, type TradeRoute } from '@depthwatch/chain/addresses'
import {
  type Address,
  maxBigint,
  minAmountOut,
  type TokenInfo,
  tradeDeadline,
} from '@depthwatch/core'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TIMESTAMP } from '../testing/fakeChain.js'
import { ACCOUNT } from '../testing/fakeWallet.js'
import { decodeSwap } from '../testing/swapCalldata.js'
import {
  connect,
  enter,
  ON,
  ON_SLIPSTREAM,
  ONE_ETH,
  quote,
  renderPanel,
  review,
  SLIP,
  SLIPSTREAM,
  suffixCount,
  UNISWAP,
  USDC,
  V3,
  WETH,
  wallet,
} from '../testing/tradeHarness.js'
import { withBuilderSuffix } from './builderCode.js'
import {
  approveStep,
  type Plan,
  type Quoted,
  recheckedMinOut,
  reviewSwap,
  type Side,
  type StepResult,
  swapStep,
  type TradeEnv,
} from './flow.js'
import { checkPool, walletClients } from './reads.js'
import { floorAmount } from './text.js'
import { swapCall } from './venue.js'

afterEach(() => cleanup())

const token = (address: string): TokenInfo => TRADE_TOKENS.find((t) => t.address === address)!

/** A fake wallet whose quoter answers `next.out` when set, else the harness's price. */
function movable(extra: Parameters<typeof wallet>[0] = {}) {
  const next: { out: bigint | null } = { out: null }
  const fake = wallet({
    quote: (amountIn, tokenIn) => next.out ?? quote(amountIn, tokenIn),
    ...extra,
  })
  return { fake, next }
}

/** TradePanel's checks of the pool, for `route`'s pool of WETH/USDC, through the fake wallet. */
async function envOf(fake: ReturnType<typeof wallet>, route: TradeRoute): Promise<TradeEnv> {
  const clients = walletClients(fake.provider)
  const uniswap = route === UNISWAP
  const address = (uniswap ? V3 : SLIP) as Address
  const venue = uniswap ? 'uniswap-v3' : 'aerodrome-slipstream'
  const flags = uniswap ? ON : ON_SLIPSTREAM
  const checked = await checkPool(clients.plain, {
    address,
    dex: venue,
    token0: WETH,
    token1: USDC,
  })
  return {
    provider: fake.provider,
    clients,
    account: ACCOUNT,
    path: 'eoa',
    suffixMayBeLost: false,
    active: () => true,
    checked,
    venue,
    token0: token(WETH),
    token1: token(USDC),
    snapshot: { price: 3842.15, token0Usd: 3842.15, token1Usd: 1 },
    references: [],
    flagsAtLoad: flags,
    fetchLiveFlags: async () => flags,
    pollMs: 1,
  }
}

const SIDES = {
  'ETH in': { tokenIn: token(WETH), tokenOut: token(USDC), ethIn: true, ethOut: false },
  'WETH in': { tokenIn: token(WETH), tokenOut: token(USDC), ethIn: false, ethOut: false },
  'ETH out': { tokenIn: token(USDC), tokenOut: token(WETH), ethIn: false, ethOut: true },
} satisfies Record<string, Side>
const AMOUNT = { 'ETH in': ONE_ETH / 10n, 'WETH in': ONE_ETH / 10n, 'ETH out': 100_000_000n }

/** Reviews `side` at 0.5 % slippage and returns the plan, with every allowance in place. */
async function reviewed(
  env: TradeEnv,
  fake: ReturnType<typeof wallet>,
  side: Side,
  amount: bigint,
) {
  if (!side.ethIn)
    fake.state.allowances.set(
      `${side.tokenIn.address}:${ACCOUNT}:${env.checked.route.router}`,
      amount,
    )
  const result = await reviewSwap(env, side, amount, 50)
  if (result.kind !== 'plan') throw new Error(`review: ${result.kind}`)
  expect(result.plan.minOut).toBe(minAmountOut(quote(amount, side.tokenIn.address), 50))
  return result.plan
}

const run = (env: TradeEnv, plan: Plan): Promise<StepResult> =>
  swapStep(
    env,
    plan,
    () => undefined,
    () => true,
  )

/** The swap `plan` signs at `minOut`: the same intent the flow builds, suffix appended. */
function expected(env: TradeEnv, plan: Plan, minOut: bigint) {
  const tx = swapCall({
    route: env.checked.route,
    pool: env.checked.key,
    tokenIn: plan.side.tokenIn.address,
    tokenOut: plan.side.tokenOut.address,
    amountIn: plan.amountIn,
    minOut,
    account: ACCOUNT,
    deadline: tradeDeadline(TIMESTAMP),
    ethIn: plan.side.ethIn,
    ethOut: plan.side.ethOut,
  })
  return { ...tx, data: withBuilderSuffix(tx.data) }
}

describe('recheckedMinOut', () => {
  const quoted = (out: bigint): Quoted =>
    ({
      live: { amountOut: out },
      decision: { kind: 'ok', minAmountOut: minAmountOut(out, 50) },
    }) as unknown as Quoted

  it('never returns less than the reviewed minimum, and the fresh minimum when it is higher', () => {
    const reviewedMin = 1_000_000n
    for (const out of [reviewedMin, reviewedMin + 1n, reviewedMin + 4_999n, 2n * reviewedMin]) {
      const signed = recheckedMinOut(reviewedMin, quoted(out))
      expect(signed, String(out)).not.toBeNull()
      expect(signed! >= reviewedMin, String(out)).toBe(true)
      expect(signed).toBe(maxBigint(minAmountOut(out, 50), reviewedMin))
    }
  })

  it('refuses a fresh quote below the reviewed minimum, by one unit or more', () => {
    for (const out of [999_999n, 990_000n, 0n])
      expect(recheckedMinOut(1_000_000n, quoted(out))).toBeNull()
  })
})

describe('the swap step signs at least the reviewed minimum', () => {
  for (const [name, side] of Object.entries(SIDES) as [keyof typeof SIDES, Side][])
    for (const route of [UNISWAP, SLIPSTREAM])
      it(`${name} on ${route.deployment}: fresh quotes above, at and just above the reviewed minimum`, async () => {
        const amount = AMOUNT[name]
        const reviewedOut = quote(amount, side.tokenIn.address)
        const cases: [string, bigint][] = [
          ['the same quote', reviewedOut],
          ['a quote 1 % higher', (reviewedOut * 101n) / 100n],
          ['a quote at the reviewed minimum', minAmountOut(reviewedOut, 50)],
          ['a quote one unit above the reviewed minimum', minAmountOut(reviewedOut, 50) + 1n],
        ]
        for (const [label, out] of cases) {
          const { fake, next } = movable()
          const env = await envOf(fake, route)
          const plan = await reviewed(env, fake, side, amount)
          next.out = out
          const result = await run(env, plan)
          expect(result.kind, label).toBe('done')
          expect(fake.state.sent, label).toHaveLength(1)
          const sent = fake.state.sent[0]!
          const decoded = decodeSwap(route, sent.data)!
          const signed = decoded.amountOutMinimum
          expect(signed >= plan.minOut, label).toBe(true)
          // The higher of the two minimums: the fresh one only when it beats the reviewed one.
          const fresh = minAmountOut(out, 50)
          expect(signed, label).toBe(maxBigint(fresh, plan.minOut))
          if (side.ethOut) expect(decoded.unwrap?.amountMinimum, label).toBe(signed)
          // Everything else is the swap the review described, at that minimum.
          const want = expected(env, plan, signed)
          expect({ to: sent.to, value: sent.value, data: sent.data }, label).toEqual(want)
          expect(suffixCount(sent.data), label).toBe(1)
        }
      })
})

describe('a fresh quote below the reviewed minimum goes back to the review', () => {
  for (const [label, factor] of [
    ['one unit below', null],
    ['1 % below the reviewed quote', 99n],
  ] as const)
    it(`sends nothing from the swap step for a quote ${label}`, async () => {
      const { fake, next } = movable()
      const env = await envOf(fake, UNISWAP)
      const plan = await reviewed(env, fake, SIDES['ETH in'], ONE_ETH / 10n)
      next.out = factor === null ? plan.minOut - 1n : (plan.quoted.live.amountOut * factor) / 100n
      const before = fake.state.methods.length
      const callsBefore = fake.state.calls.length
      const result = await run(env, plan)
      expect(result.kind).toBe('price-moved')
      if (result.kind !== 'price-moved') return
      expect(result.plan.movedFrom).toBe(plan.minOut)
      expect(result.plan.minOut).toBe(minAmountOut(next.out, 50))
      expect(result.plan.minOut < plan.minOut).toBe(true)
      expect(result.plan.needsApproval).toBe(false)
      expect(fake.state.sent).toEqual([])
      const asked = fake.state.methods.slice(before)
      expect(asked).not.toContain('eth_sendTransaction')
      expect(asked).not.toContain('eth_estimateGas')
      // Not even simulated: the swap was never built at a minimum below the reviewed one.
      const later = fake.state.calls.slice(callsBefore)
      expect(later.some((c) => c.to === UNISWAP.router)).toBe(false)
    })

  it('asks for no approval when the quote fell below the reviewed minimum, and one when it did not', async () => {
    const side = SIDES['ETH out']
    for (const [out, approves] of [
      [(m: bigint) => m - 1n, false],
      [(m: bigint) => m, true],
    ] as const) {
      const { fake, next } = movable()
      const env = await envOf(fake, UNISWAP)
      const result = await reviewSwap(env, side, 100_000_000n, 50)
      if (result.kind !== 'plan') throw new Error('no plan')
      expect(result.plan.needsApproval).toBe(true)
      next.out = out(result.plan.minOut)
      const step = await approveStep(
        env,
        result.plan,
        () => undefined,
        () => true,
      )
      expect(step.kind).toBe(approves ? 'approved' : 'price-moved')
      expect(fake.state.sent).toHaveLength(approves ? 1 : 0)
      if (step.kind === 'price-moved') expect(step.plan.movedFrom).toBe(result.plan.minOut)
    }
  })

  it('shows the review again with the new minimum and a note, and the wallet gets nothing', async () => {
    const { fake, next } = movable()
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    const reviewedMin = minAmountOut(quote(ONE_ETH / 10n, WETH), 50)
    next.out = reviewedMin - 1n
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    expect(await screen.findByText(/The price moved/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Review the swap' })).toBeTruthy()
    const text = (document.body.textContent ?? '').replace(/ /g, ' ')
    expect(text).toContain(`${floorAmount(minAmountOut(next.out, 50), 6)} USDC`)
    expect(fake.state.sent).toEqual([])
    expect(fake.state.methods).not.toContain('eth_sendTransaction')
  })
})
