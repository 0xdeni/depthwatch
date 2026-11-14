/**
 * The swap panel's review: what the reader sends exactly and receives at least, then the figures
 * that matter before signing (rate, cost against the pool's price with its fee, slippage, network
 * fee), the wallet requests to expect, and under "Contracts and addresses" each token, the pool,
 * the DEX contract and the recipient, named and linked to Basescan (closed below 840 px, open
 * from 840 px). The action row stays at the bottom of the screen while the review is in view, so
 * on a phone Swap is visible as the review opens, and the page scrolls focus clear of it; a price
 * that moved below the reviewed minimum is said there, at the button. Presentational: `TradeSwap`
 * owns the state and the actions. The later views live in TradeSteps.tsx and are exported from
 * here as well.
 */

import { type RefObject, useContext, useEffect, useRef, useState } from 'react'
import type { PoolDetail } from '../api/types.js'
import { Button } from '../components/ui/Button.js'
import { Disclosure } from '../components/ui/Disclosure.js'
import { amount, dexLabel, feeText, group, NB, price, shortAddress, usd } from '../lib/format.js'
import { rawToDecimal } from '../lib/raw.js'
import { BUILDER_CODE } from './builderCode.js'
import type { Plan, Side } from './flow.js'
import { type FeeEstimate, reviewFee } from './reads.js'
import { AddressLink, type Confirmed, contractName, PanelContext, unitOf } from './TradeSteps.js'
import {
  bpsPercent,
  DATA_FEE,
  exactAmount,
  floorAmount,
  movedText,
  networkFeeText,
} from './text.js'
import { useStepFocus } from './useStepFocus.js'
import './review.css'

export {
  type ApprovalLeft,
  type Confirmed,
  contractName,
  DoneView,
  FailedView,
  PanelContext,
  type PanelShared,
  SentNote,
  type SentTx,
  TxLink,
  unitOf,
  WorkingView,
} from './TradeSteps.js'

/** The review's network fee, read once per reviewed plan through the panel's wallet. */
function useReviewFee(plan: Plan): FeeEstimate {
  const shared = useContext(PanelContext)
  const env = shared?.env ?? null
  const [fee, setFee] = useState<FeeEstimate>({ kind: env ? 'reading' : 'wallet' })
  useEffect(() => {
    if (!env) return
    let live = true
    setFee({ kind: 'reading' })
    void reviewFee(env, plan).then((next) => {
      if (live) setFee(next)
    })
    return () => {
      live = false
    }
  }, [env, plan])
  return fee
}

/**
 * Focus is never covered (base.css, Focus A2): a control in the review that takes focus under the
 * action row, which sticks to the bottom of the screen, is scrolled just above it. Browsers count
 * such a control as in view and leave it there; the row's own controls never move the page.
 */
function useClearOfRow(
  review: RefObject<HTMLDivElement | null>,
  row: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const box = review.current
    if (!box) return
    const onFocus = (event: FocusEvent) => {
      const bar = row.current
      const target = event.target
      if (!bar || !(target instanceof Element) || bar.contains(target)) return
      const over = target.getBoundingClientRect().bottom - bar.getBoundingClientRect().top
      if (over > 0) window.scrollBy({ top: over + 8, behavior: 'instant' })
    }
    box.addEventListener('focusin', onFocus)
    return () => box.removeEventListener('focusin', onFocus)
  }, [review, row])
}

/** A human amount of raw units, for rates and dollar values only (never for what is signed). */
function human(raw: bigint, decimals: number): number {
  return Number(rawToDecimal(raw.toString(), decimals, 18) ?? 0)
}

/** "1 ETH = 3,840.15 USDC", the larger unit first. */
function rateText(plan: Plan, inUnit: string, outUnit: string): string {
  const { side, amountIn, quoted } = plan
  const inH = human(amountIn, side.tokenIn.decimals)
  const outH = human(quoted.live.amountOut, side.tokenOut.decimals)
  if (inH <= 0 || outH <= 0) return '—'
  const rate = outH / inH
  return rate >= 1
    ? `1${NB}${inUnit} = ${price(rate)}${NB}${outUnit}`
    : `1${NB}${outUnit} = ${price(1 / rate)}${NB}${inUnit}`
}

/** The input's dollar value at the snapshot's price, or null without one. */
function sendUsd(plan: Plan, detail: PoolDetail): number | null {
  const { pool, latest } = detail
  const first = plan.side.tokenIn.address === pool.token0.address.toLowerCase()
  const each = first ? latest?.token0Usd : latest?.token1Usd
  return each == null ? null : human(plan.amountIn, plan.side.tokenIn.decimals) * each
}

/** The wallet requests to expect, and why a token needs an approval when ETH does not. */
function stepsText(plan: Plan, send: string, to: string): string {
  const { side } = plan
  if (plan.needsApproval)
    return `Your wallet will ask twice: first to let ${to} use exactly ${send}, and no more, then to swap. A token such as ${side.tokenIn.symbol} needs that approval before a contract can move it; ETH doesn’t.`
  if (side.ethIn) return 'Your wallet will ask once, to swap. ETH needs no approval.'
  return `Your wallet will ask once, to swap: an earlier approval already covers ${send}.`
}

/** The tokens' line in "Contracts and addresses": "ETH, sent as WETH Wrapped Ether". */
function tokenLine(side: Side, dir: 'in' | 'out') {
  const token = dir === 'in' ? side.tokenIn : side.tokenOut
  const eth = dir === 'in' ? side.ethIn : side.ethOut
  return (
    <span>
      {eth ? `ETH, ${dir === 'in' ? 'sent as' : 'paid out from'} ` : null}
      <strong>{token.symbol}</strong> {token.name}
    </span>
  )
}

export function ReviewView({
  plan,
  detail,
  router,
  account,
  suffixMayBeLost,
  note,
  onConfirm,
  onBack,
}: {
  plan: Plan
  detail: PoolDetail
  router: string
  account: string
  suffixMayBeLost: boolean
  /** What TradeSwap adds after a price move: what an approval made before it still covers. */
  note: string | null
  onConfirm: () => void
  onBack: () => void
}) {
  const shared = useContext(PanelContext)
  const moved = plan.movedFrom !== undefined
  // After a price move, focus goes to the note at the button, not back to the top: one of the two
  // is drawn.
  const focusKey = `review:${plan.minOut}:${moved}:${note}`
  const focus = useStepFocus(focusKey)
  const focusNote = useStepFocus<HTMLParagraphElement>(focusKey)
  const networkFee = useReviewFee(plan)
  const box = useRef<HTMLDivElement | null>(null)
  const row = useRef<HTMLDivElement | null>(null)
  useClearOfRow(box, row)
  const { side, amountIn, quoted } = plan
  const inUnit = unitOf(side.tokenIn, side.ethIn)
  const outUnit = unitOf(side.tokenOut, side.ethOut)
  const send = `${exactAmount(amountIn, side.tokenIn.decimals)}${NB}${inUnit}`
  const minText = `${floorAmount(plan.minOut, side.tokenOut.decimals)}${NB}${outUnit}`
  const decision = quoted.decision
  const impact = decision.kind === 'refuse' ? 0 : Math.max(0, decision.priceImpactBps)
  const dollars = sendUsd(plan, detail)
  const name = contractName(router)
  const to = `${name} (${shortAddress(router)})`
  const confirm = () => {
    // After a price move, an approval sent for this swap before it still belongs to it.
    const prev = shared?.confirmed.current ?? null
    const kept = moved && prev?.send === send ? prev.approvalHash : null
    const memo: Confirmed = { send, twoSteps: plan.needsApproval, approvalHash: kept }
    if (shared) shared.confirmed.current = memo
    onConfirm()
  }
  const movedNote =
    plan.movedFrom === undefined
      ? null
      : [movedText(plan.movedFrom, plan.minOut, side.tokenOut.decimals, outUnit), note]
          .filter(Boolean)
          .join(' ')
  const label = plan.needsApproval ? 'Approve and swap' : moved ? 'Swap at the new price' : 'Swap'
  return (
    <div className="trade-review" ref={box}>
      <h3 className="trade-h" tabIndex={-1} ref={moved ? undefined : focus}>
        Review the swap
      </h3>
      <p className="trade-say">
        You send exactly <strong className="num">{send}</strong>
        {dollars === null ? '' : ` (about ${usd(dollars)})`}.
      </p>
      <p className="trade-say">
        You receive at least <strong className="num">{minText}</strong>, or the swap fails and you
        pay only the network fee.
      </p>
      <p className="muted">
        About {amount(quoted.live.amountOut.toString(), side.tokenOut.decimals)}
        {NB}
        {outUnit} at the price of block {group(quoted.live.blockNumber)}.
      </p>
      {decision.kind === 'warn' ? (
        <p className="trade-warn">
          This swap costs {bpsPercent(impact)} against the pool’s price, its fee included: you get
          noticeably less than the pool’s price.
        </p>
      ) : null}
      <dl className="trade-figs review-figs">
        <div>
          <dt>Rate</dt>
          <dd className="num">{rateText(plan, inUnit, outUnit)}</dd>
        </div>
        <div>
          <dt>Cost against the pool’s price</dt>
          <dd className="num">{bpsPercent(impact)}, fee included</dd>
        </div>
        <div>
          <dt>Live pool fee</dt>
          <dd className="num">{feeText({ dex: detail.pool.dex, feePips: quoted.live.feePips })}</dd>
        </div>
        <div>
          <dt>Slippage tolerance</dt>
          <dd className="num">{bpsPercent(plan.slippageBps)}</dd>
        </div>
        <div>
          <dt>Network fee</dt>
          <dd className="num" aria-busy={networkFee.kind === 'reading'}>
            {networkFeeText(networkFee)}
          </dd>
        </div>
      </dl>
      <p className="muted small">
        {dollars === null ? '' : 'Dollar values use the latest snapshot’s prices. '}
        {DATA_FEE} The network fee goes to Base, not to Depthwatch, and Depthwatch adds no fee to
        this swap.
      </p>
      <p>{stepsText(plan, send, to)}</p>
      {plan.unlimitedAllowance ? (
        <p className="muted small">
          This wallet already lets the DEX contract use any amount of {side.tokenIn.symbol}, from an
          earlier approval. Depthwatch never asks for that; you can remove it in your wallet.
        </p>
      ) : null}
      {suffixMayBeLost ? (
        <p className="muted small">
          Your account is a smart contract wallet that does not say it can carry Depthwatch’s
          Builder Code, so the code may not be recorded for this swap. The swap itself is not
          affected.
        </p>
      ) : null}
      <Disclosure label="Contracts and addresses" phoneOnly className="review-addr">
        <dl className="about is-one-col trade-facts">
          <div>
            <dt>You send</dt>
            <dd>
              {tokenLine(side, 'in')}
              <AddressLink
                kind="token"
                value={side.tokenIn.address}
                name={`${side.tokenIn.symbol} token`}
              />
            </dd>
          </div>
          <div>
            <dt>You receive</dt>
            <dd>
              {tokenLine(side, 'out')}
              <AddressLink
                kind="token"
                value={side.tokenOut.address}
                name={`${side.tokenOut.symbol} token`}
              />
            </dd>
          </div>
          <div>
            <dt>Pool</dt>
            <dd>
              <span>{dexLabel(detail.pool.dex)} pool</span>
              <AddressLink
                kind="address"
                value={detail.pool.address ?? ''}
                name={`${dexLabel(detail.pool.dex)} pool`}
              />
            </dd>
          </div>
          <div>
            <dt>DEX contract</dt>
            <dd>
              <span>{name}</span>
              <AddressLink kind="address" value={router} name={name} />
            </dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd>
              <span>Your account</span>
              <span className="addr" title={account}>
                {shortAddress(account)}
              </span>
            </dd>
          </div>
        </dl>
        <p className="muted small">
          Each transaction carries Depthwatch’s public Builder Code ({BUILDER_CODE}), a short tag
          Base uses to count app activity. It adds no fee.
        </p>
      </Disclosure>
      <div className="review-act" ref={row}>
        {movedNote ? (
          <p className="trade-note review-moved" tabIndex={-1} ref={focusNote}>
            {movedNote}
          </p>
        ) : null}
        <div className="trade-actions">
          <Button variant="primary" onClick={confirm}>
            {label}
          </Button>
          <Button onClick={onBack}>Back</Button>
        </div>
      </div>
    </div>
  )
}
