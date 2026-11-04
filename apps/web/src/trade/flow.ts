/**
 * The swap's steps, without the UI: quote, review, approve, swap. Every number is core's
 * (`checkTrade` and the limits of docs/METRICS.md, "Swap checks"); every address is compiled in
 * (`TradeRoute`, the token allowlist); the trade switch is read again, uncached, when the panel
 * connects and immediately before every signature request, and both reads must be on for the
 * venue. A step stops before any signature request once the panel that started it has gone
 * (another account or network, "Use another wallet", another page): `alive()`.
 */
import { TOKENS, type TradeVenue } from '@depthwatch/chain/addresses'
import {
  type Address,
  checkTrade,
  combineTradeFlags,
  type Dex,
  humanPriceToRawPrice,
  type TokenInfo,
  type TradeDecision,
  type TradeFlags,
  type TradeLimits,
  tradeDeadline,
  tradeOnFor,
} from '@depthwatch/core'
import type { Hex } from 'viem'
import {
  allowanceOf,
  balanceOf,
  type CheckedPool,
  type LiveQuote,
  readQuote,
  type StopReason,
  type WalletClients,
} from './reads.js'
import {
  gasLimit,
  type Outcome,
  receivedFrom,
  type SendPath,
  send,
  sentCodes,
  simulate,
  waitFor,
} from './send.js'
import { approveCall, swapCall, type TxRequest } from './venue.js'
import type { Eip1193Provider } from './wallets.js'

/** Everything a connected, checked swap panel works with. */
export interface TradeEnv {
  provider: Eip1193Provider
  clients: WalletClients
  account: Address
  path: SendPath
  /**
   * True when the account has contract code (not an EIP-7702 delegation) and its wallet does not
   * report the `dataSuffix` capability: the code may end up inside the wallet's own call.
   */
  suffixMayBeLost: boolean
  /** False once the panel has moved on (another connection, account or network, or unmounted). */
  active: () => boolean
  checked: CheckedPool
  venue: TradeVenue
  token0: TokenInfo
  token1: TokenInfo
  /** The snapshot's price (token1 per token0, human) and USD prices, for the sanity bounds. */
  snapshot: { price: number | null; token0Usd: number | null; token1Usd: number | null }
  /** Other live pools of the same pair whose price bounds this one's (never a suggestion). */
  references: readonly Address[]
  flagsAtLoad: TradeFlags
  fetchLiveFlags: () => Promise<TradeFlags | null>
  pollMs: number
}

/** Which token goes in and out; ETH travels as WETH through the router. */
export interface Side {
  tokenIn: TokenInfo
  tokenOut: TokenInfo
  ethIn: boolean
  ethOut: boolean
}

export interface Quoted {
  live: LiveQuote
  decision: TradeDecision
}

export interface Plan {
  side: Side
  amountIn: bigint
  slippageBps: number
  quoted: Quoted
  /** `amountOutMinimum` the reader reviewed; a later quote may only raise it. */
  minOut: bigint
  needsApproval: boolean
  /** An earlier approval of 2^128 or more is in place (shown as a note, never asked for). */
  unlimitedAllowance: boolean
}

const UNLIMITED = 1n << 128n

/** The switch for `venue`, read now and combined with the one read at load; null when off. */
export async function switchFor(
  flagsAtLoad: TradeFlags,
  fetchLiveFlags: () => Promise<TradeFlags | null>,
  venue: Dex,
): Promise<TradeFlags | null> {
  let live: TradeFlags | null = null
  try {
    live = await fetchLiveFlags()
  } catch {
    live = null
  }
  const combined = combineTradeFlags(flagsAtLoad, live)
  return tradeOnFor(combined, venue) ? combined : null
}

/** The switch for this panel's venue, read now; null when off. */
export function liveFlagsFor(env: TradeEnv): Promise<TradeFlags | null> {
  return switchFor(env.flagsAtLoad, env.fetchLiveFlags, env.venue)
}

/** A live quote of `amountIn` and core's decision on it. */
export async function quoteSwap(
  env: TradeEnv,
  side: Side,
  amountIn: bigint,
  slippageBps: number,
  limits: TradeLimits,
): Promise<Quoted> {
  const { token0, token1, snapshot } = env
  const zeroForOne = side.tokenIn.address === token0.address
  const live = await readQuote(
    env.clients.plain,
    env.checked,
    side.tokenIn.address,
    amountIn,
    env.references,
  )
  const usd0 = { decimals: token0.decimals, usdPrice: snapshot.token0Usd }
  const usd1 = { decimals: token1.decimals, usdPrice: snapshot.token1Usd }
  const decision = checkTrade({
    direction: zeroForOne ? 'zeroForOne' : 'oneForZero',
    amountIn,
    quotedAmountOut: live.amountOut,
    poolMid: live.poolMid,
    slippageBps,
    limits,
    tokenIn: zeroForOne ? usd0 : usd1,
    tokenOut: zeroForOne ? usd1 : usd0,
    snapshotMid:
      snapshot.price === null
        ? null
        : humanPriceToRawPrice(snapshot.price, token0.decimals, token1.decimals),
    otherPoolMids: live.otherMids,
  })
  return { live, decision }
}

export type ReviewResult =
  | { kind: 'plan'; plan: Plan }
  | { kind: 'refused'; decision: TradeDecision }
  | { kind: 'stopped'; reason: StopReason }

/** Quotes again and builds what the review shows: the amounts, the minimum and the steps. */
export async function reviewSwap(
  env: TradeEnv,
  side: Side,
  amountIn: bigint,
  slippageBps: number,
): Promise<ReviewResult> {
  const quoted = await quoteSwap(env, side, amountIn, slippageBps, env.flagsAtLoad)
  if (quoted.decision.kind === 'refuse') return { kind: 'refused', decision: quoted.decision }
  const balance = await balanceOf(
    env.clients.plain,
    env.account,
    side.ethIn ? null : side.tokenIn.address,
  )
  if (balance < amountIn) return { kind: 'stopped', reason: 'balance-low' }
  const allowance = side.ethIn
    ? 0n
    : await allowanceOf(
        env.clients.plain,
        side.tokenIn.address,
        env.account,
        env.checked.route.router,
      )
  const plan: Plan = {
    side,
    amountIn,
    slippageBps,
    quoted,
    minOut: quoted.decision.minAmountOut,
    needsApproval: !side.ethIn && allowance < amountIn,
    unlimitedAllowance: !side.ethIn && allowance >= UNLIMITED,
  }
  return { kind: 'plan', plan }
}

/** Where a step is: checking (flags, price, simulation), waiting for a signature, or included. */
export type Stage = { at: 'checking' } | { at: 'sign' } | { at: 'wait'; hash: Hex | null }

export type StepResult =
  | { kind: 'approved' }
  | { kind: 'done'; hash: Hex; received: bigint | null; codes: string[] | null }
  | { kind: 'reverted'; hash: Hex }
  | { kind: 'not-sent' }
  /** The panel went away: nothing more is asked of the wallet, and nothing is shown. */
  | { kind: 'abandoned' }
  | { kind: 'price-moved'; plan: Plan }
  | { kind: 'eth-out-unavailable' }
  | { kind: 'stopped'; reason: StopReason; decision?: TradeDecision }

/** True while the panel that started a step is still the one on screen. */
export type Alive = () => boolean

/** `gas`: the limit to sign with (send.ts `gasLimit`), null to leave it to the wallet. */
async function signAndWait(
  env: TradeEnv,
  tx: TxRequest,
  gas: bigint | null,
  onStage: (stage: Stage) => void,
  alive: Alive,
): Promise<Outcome | { kind: 'stopped'; reason: 'switched-off' }> {
  // Immediately before the signature request: the switch, uncached, then the panel still there.
  if ((await liveFlagsFor(env)) === null) return { kind: 'stopped', reason: 'switched-off' }
  if (!alive()) return { kind: 'abandoned' }
  onStage({ at: 'sign' })
  const sent = await send(env.clients, env.path, env.account, tx, gas)
  onStage({ at: 'wait', hash: null })
  return waitFor(env.clients, sent, {
    pollMs: env.pollMs,
    alive,
    onHash: (hash) => onStage({ at: 'wait', hash }),
  })
}

/**
 * Approves the router for exactly the swap's input, unless the allowance already covers it. Before
 * the approval's signature request it quotes again with the switch's limits as read now, so an
 * approval is never asked for a swap core would refuse, or whose minimum has fallen (that goes
 * back to the review, the approval still to come).
 */
export async function approveStep(
  env: TradeEnv,
  plan: Plan,
  onStage: (stage: Stage) => void,
  alive: Alive,
): Promise<StepResult> {
  onStage({ at: 'checking' })
  const flags = await liveFlagsFor(env)
  if (flags === null) return { kind: 'stopped', reason: 'switched-off' }
  const token = plan.side.tokenIn.address
  const router = env.checked.route.router
  const allowance = await allowanceOf(env.clients.plain, token, env.account, router)
  if (allowance >= plan.amountIn) return { kind: 'approved' }
  const fresh = await quoteSwap(env, plan.side, plan.amountIn, plan.slippageBps, flags)
  if (fresh.decision.kind === 'refuse')
    return { kind: 'stopped', reason: 'refused', decision: fresh.decision }
  const minOut = fresh.decision.minAmountOut
  if (minOut < plan.minOut) return { kind: 'price-moved', plan: { ...plan, quoted: fresh, minOut } }
  const tx = approveCall(token, router, plan.amountIn)
  try {
    await simulate(env.clients, env.path, env.account, tx)
  } catch {
    return { kind: 'stopped', reason: 'simulation-failed' }
  }
  // The wallet's estimate of the exact transaction, padded; one that reverts sends nothing.
  const gas = await gasLimit(env.clients, env.path, env.account, tx)
  if (gas === 'reverts') return { kind: 'stopped', reason: 'simulation-failed' }
  const outcome = await signAndWait(env, tx, gas, onStage, alive)
  return outcome.kind === 'confirmed' ? { kind: 'approved' } : outcome
}

/**
 * The swap: the switch, a fresh quote (a lower minimum goes back to the review), balance and
 * allowance, the deadline from the quote's block, the exact transaction simulated and its gas
 * estimated, the switch again, then the one signature request and the wait.
 */
export async function swapStep(
  env: TradeEnv,
  plan: Plan,
  onStage: (stage: Stage) => void,
  alive: Alive,
): Promise<StepResult> {
  onStage({ at: 'checking' })
  const flags = await liveFlagsFor(env)
  if (flags === null) return { kind: 'stopped', reason: 'switched-off' }
  const { side, amountIn } = plan
  const fresh = await quoteSwap(env, side, amountIn, plan.slippageBps, flags)
  if (fresh.decision.kind === 'refuse')
    return { kind: 'stopped', reason: 'refused', decision: fresh.decision }
  const minOut = fresh.decision.minAmountOut
  if (minOut < plan.minOut)
    return { kind: 'price-moved', plan: { ...plan, quoted: fresh, minOut, needsApproval: false } }
  const tokenIn = side.ethIn ? null : side.tokenIn.address
  if ((await balanceOf(env.clients.plain, env.account, tokenIn)) < amountIn)
    return { kind: 'stopped', reason: 'balance-low' }
  const router = env.checked.route.router
  if (
    tokenIn !== null &&
    (await allowanceOf(env.clients.plain, tokenIn, env.account, router)) < amountIn
  )
    return { kind: 'stopped', reason: 'allowance-low' }
  const intent = {
    route: env.checked.route,
    pool: env.checked.key,
    tokenIn: side.tokenIn.address,
    tokenOut: side.tokenOut.address,
    amountIn,
    minOut,
    account: env.account,
    deadline: tradeDeadline(fresh.live.timestamp),
    ethIn: side.ethIn,
    ethOut: side.ethOut,
  }
  const tx = swapCall(intent)
  try {
    await simulate(env.clients, env.path, env.account, tx)
  } catch {
    if (!side.ethOut) return { kind: 'stopped', reason: 'simulation-failed' }
    // ETH out is the one path not checked on a fork: if only the unwrap fails, offer WETH.
    try {
      await simulate(env.clients, env.path, env.account, swapCall({ ...intent, ethOut: false }))
      return { kind: 'eth-out-unavailable' }
    } catch {
      return { kind: 'stopped', reason: 'simulation-failed' }
    }
  }
  // The wallet's estimate of the exact transaction, padded; one that reverts sends nothing.
  const gas = await gasLimit(env.clients, env.path, env.account, tx)
  if (gas === 'reverts') return { kind: 'stopped', reason: 'simulation-failed' }
  const outcome = await signAndWait(env, tx, gas, onStage, alive)
  if (outcome.kind !== 'confirmed') return outcome
  const received = receivedFrom(outcome.logs, {
    token: side.tokenOut.address,
    account: env.account,
    router,
    eth: side.ethOut,
    weth: TOKENS.WETH.address,
  })
  const codes = await sentCodes(env.clients, outcome.hash, env.account)
  return { kind: 'done', hash: outcome.hash, received, codes }
}

/** True for a request the reader turned down in the wallet (EIP-1193 code 4001). */
export function isUserRejection(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 8; depth++) {
    const { code, name, cause } = e as { code?: unknown; name?: unknown; cause?: unknown }
    if (code === 4001 || name === 'UserRejectedRequestError') return true
    e = cause
  }
  return false
}
