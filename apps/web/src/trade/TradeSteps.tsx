/**
 * The swap panel's views after the review: a step in progress, the receipt and a failure, and
 * what they share with the review. `TradeSwap` owns the state and the actions and hands these
 * views only the step (`what`, `stage`) or the outcome; the panel adds the rest through
 * `PanelContext`: the connected `env`, what the reader confirmed on the review (the exact amount,
 * one wallet request or two, the approval's hash once known) and a way to stop waiting for a
 * wallet that shows no request. The one read here: after a swap that sent an approval, the receipt
 * reads what the DEX contract may still take, through the wallet, before it says the approval is
 * used up.
 */
import { TRADE_ROUTES } from '@depthwatch/chain/addresses'
import { createContext, type RefObject, useContext, useEffect, useState } from 'react'
import { Button } from '../components/ui/Button.js'
import { Disclosure } from '../components/ui/Disclosure.js'
import { Icon } from '../components/ui/Icon.js'
import { dexLabel, NB, shortAddress } from '../lib/format.js'
import { BUILDER_CODE } from './builderCode.js'
import type { Plan, Stage, StepResult, TradeEnv } from './flow.js'
import { allowanceOf } from './reads.js'
import {
  approvalLeftText,
  approvalUsedText,
  exactAmount,
  floorAmount,
  overMinimumText,
} from './text.js'
import { useStepFocus } from './useStepFocus.js'

const BASESCAN = 'https://basescan.org'

/** What the reader confirmed on the review, for the views that follow it. */
export interface Confirmed {
  /** The exact input and its unit, as the review wrote it: "100 USDC". */
  send: string
  /** An approval comes first: the wallet asks twice. */
  twoSteps: boolean
  /** The approval sent for this swap, once its hash is known (`TradePanel` notes it). */
  approvalHash: string | null
}

/** What the panel shares with its steps (`TradePanel` provides it once connected). */
export interface PanelShared {
  env: TradeEnv
  confirmed: RefObject<Confirmed | null>
  /** Ends this connection's run and shows a fresh form (`TradePanel`). */
  stopWaiting: () => void
  /** How long the wallet's request may show nothing before the step offers to stop waiting. */
  waitHintMs: number
}

export const PanelContext = createContext<PanelShared | null>(null)

/** The unit of a side: ETH when it travels as ETH, else the token's symbol. */
export function unitOf(token: { symbol: string }, eth: boolean): string {
  return eth ? 'ETH' : token.symbol
}

/** A contract's name as the reader's wallet and Basescan show it: "Uniswap SwapRouter02". */
export function contractName(router: string): string {
  const route = TRADE_ROUTES.find((r) => r.router === router.toLowerCase())
  if (!route) return 'the DEX contract'
  return route.routerAbi === 'swap-router-02'
    ? 'Uniswap SwapRouter02'
    : `${dexLabel(route.venue)} SwapRouter`
}

/**
 * A shortened address linked to Basescan, named for a screen reader by what it is: "Uniswap
 * SwapRouter02 0x2626…e481 on Basescan". The full address is the link's title and target.
 */
export function AddressLink({
  kind,
  value,
  name,
}: {
  kind: 'address' | 'token'
  value: string
  name: string
}) {
  const short = shortAddress(value)
  return (
    <a
      className="plink addr touch-hit"
      href={`${BASESCAN}/${kind}/${value}`}
      target="_blank"
      rel="noreferrer noopener"
      title={value}
      aria-label={`${name} ${short} on Basescan`}
    >
      {short}
    </a>
  )
}

/** A transaction on Basescan; 44 px to a finger, like every standalone link (`touch-hit`). */
export function TxLink({ hash, what = 'transaction' }: { hash: string; what?: string }) {
  return (
    <a
      className="ulink touch-hit"
      href={`${BASESCAN}/tx/${hash}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      View the {what} on Basescan
    </a>
  )
}

/** Wallet requests that show nothing for this long get "Don't see the request?". */
export const WAIT_HINT_MS = 20_000

/** "Swap" alone, or the step of two: "Step 1 of 2: approve". */
function stepHeading(what: 'approve' | 'swap', twoSteps: boolean): string {
  if (what === 'approve') return 'Step 1 of 2: approve'
  return twoSteps ? 'Step 2 of 2: swap' : 'Swap'
}

/** The stage in a sentence; the signature request restates what the wallet should show. */
function stageText(what: 'approve' | 'swap', stage: Stage, send: string, to: string): string {
  if (what === 'approve') {
    if (stage.at === 'checking') return 'Checking the price before your wallet asks…'
    if (stage.at === 'wait') return 'Approval sent. Waiting for Base to confirm it…'
    return `Your wallet should now ask you to let ${to} use exactly ${send}. Check the address, then confirm.`
  }
  if (stage.at === 'checking')
    return 'Getting a fresh price and checking the swap before your wallet asks…'
  if (stage.at === 'wait') return 'Swap sent. Waiting for Base to confirm it…'
  return `Your wallet should now ask you to swap exactly ${send} with ${to}. Check the address, then confirm within 5 minutes: after that the swap fails and costs only the network fee.`
}

export function WorkingView({ what, stage }: { what: 'approve' | 'swap'; stage: Stage }) {
  const shared = useContext(PanelContext)
  const confirmed = shared?.confirmed.current ?? null
  const focus = useStepFocus(`working:${what}`)
  const [stuck, setStuck] = useState(false)
  const hintMs = shared?.waitHintMs ?? WAIT_HINT_MS
  // The wallet may show nothing (a closed popup, another window): offer a way out after a while.
  useEffect(() => {
    setStuck(false)
    if (stage.at !== 'sign') return
    const timer = setTimeout(() => setStuck(true), hintMs)
    return () => clearTimeout(timer)
  }, [stage.at, hintMs])
  const router = shared?.env.checked.route.router ?? ''
  const to = router ? `${contractName(router)} (${shortAddress(router)})` : 'the DEX contract'
  const send = confirmed?.send ?? 'the amount you reviewed'
  return (
    <div className="trade-working">
      <h3 className="trade-h" tabIndex={-1} ref={focus}>
        {stepHeading(what, confirmed?.twoSteps === true)}
      </h3>
      <p className="trade-say review-stage" role="status" aria-live="polite">
        {stageText(what, stage, send, to)}
      </p>
      {stage.at === 'wait' && stage.hash ? (
        <TxLink hash={stage.hash} what={what === 'approve' ? 'approval' : 'swap'} />
      ) : null}
      {stuck && shared ? (
        <div className="review-stuck">
          <p role="status">
            Don’t see the request? Open your wallet: it may be waiting there. If nothing is there,
            stop waiting and start again.
          </p>
          <Button onClick={shared.stopWaiting}>Stop waiting</Button>
        </div>
      ) : null}
    </div>
  )
}

/** The ok shape of a receipt: a Green circle with a check (§5.5: shape and word, never colour). */
function OkMark() {
  return (
    <span className="review-ok" aria-hidden="true">
      <Icon name="check" />
    </span>
  )
}

/**
 * What the DEX contract may still take of the input token once the swap is confirmed, read through
 * the wallet when `check`: an approval's amount can be raised in the wallet before it is signed, so
 * the receipt says what is left rather than assume it was used up. Null when it cannot be read.
 */
function useAllowanceLeft(plan: Plan, check: boolean): bigint | 'reading' | null {
  const env = useContext(PanelContext)?.env ?? null
  const read = check && env !== null && !plan.side.ethIn
  const [left, setLeft] = useState<bigint | 'reading' | null>(read ? 'reading' : null)
  useEffect(() => {
    if (!read || !env) return
    let live = true
    const { router } = env.checked.route
    allowanceOf(env.clients.plain, plan.side.tokenIn.address, env.account, router).then(
      (value) => live && setLeft(value),
      () => live && setLeft(null),
    )
    return () => {
      live = false
    }
  }, [read, env, plan])
  return left
}

export function DoneView({
  result,
  plan,
  onAgain,
}: {
  result: Extract<StepResult, { kind: 'done' }>
  plan: Plan
  onAgain: () => void
}) {
  const shared = useContext(PanelContext)
  const focus = useStepFocus(`done:${result.hash}`)
  const { tokenIn, tokenOut, ethIn, ethOut } = plan.side
  const sent = `${exactAmount(plan.amountIn, tokenIn.decimals)}${NB}${unitOf(tokenIn, ethIn)}`
  const outUnit = unitOf(tokenOut, ethOut)
  const ours = result.codes?.includes(BUILDER_CODE) === true
  const approvalHash = shared?.confirmed.current?.approvalHash ?? null
  const left = useAllowanceLeft(plan, approvalHash !== null)
  const received = result.received
  const over = received === null ? null : overMinimumText(received, plan.minOut)
  // Included but no payment to the account found: say so rather than "complete".
  return (
    <div className="trade-done">
      <h3 className="trade-h review-done-h" tabIndex={-1} ref={focus}>
        {received === null ? null : <OkMark />}
        {received === null ? 'Swap included, not confirmed' : 'Swap complete'}
      </h3>
      <p className="trade-say" role="status">
        {received === null ? (
          'The transaction is included, but Depthwatch found no payment to your account in it, so it cannot confirm what you received. Check it on Basescan.'
        ) : (
          <>
            You swapped <strong className="num">{sent}</strong> for{' '}
            <strong className="num">
              {floorAmount(received, tokenOut.decimals)}
              {NB}
              {outUnit}
            </strong>
            {over ? `, ${over}` : ''}.
          </>
        )}
      </p>
      {approvalHash ? (
        <p>
          {approvalUsedText(sent, left, tokenIn)} <TxLink hash={approvalHash} what="approval" />
        </p>
      ) : null}
      {plan.unlimitedAllowance ? (
        <p className="muted small">
          An earlier approval still lets the DEX contract use any amount of {tokenIn.symbol}; you
          can remove it in your wallet.
        </p>
      ) : null}
      <TxLink hash={result.hash} what="swap" />
      <Disclosure label="Details">
        <dl className="about is-one-col trade-facts">
          <div>
            <dt>You sent</dt>
            <dd className="num">exactly {sent}</dd>
          </div>
          {received === null ? null : (
            <div>
              <dt>You received</dt>
              <dd className="num">
                exactly {exactAmount(received, tokenOut.decimals)}
                {NB}
                {outUnit}
              </dd>
            </div>
          )}
          <div>
            <dt>Minimum you reviewed</dt>
            <dd className="num">
              {exactAmount(plan.minOut, tokenOut.decimals)}
              {NB}
              {outUnit}
            </dd>
          </div>
          <div>
            <dt>Transaction</dt>
            <dd>
              <span className="addr">{result.hash}</span>
            </dd>
          </div>
          <div>
            <dt>Builder Code</dt>
            <dd>
              {ours
                ? `${BUILDER_CODE}, read back from the transaction’s input.`
                : 'Not found in the transaction’s input. The swap itself is not affected.'}
            </dd>
          </div>
        </dl>
      </Disclosure>
      <div className="trade-actions">
        <Button onClick={onAgain}>Swap again</Button>
      </div>
    </div>
  )
}

/** An approval that went through for a swap that was then not made. */
export interface ApprovalLeft {
  hash: string
  /** The approved amount and unit, as the review wrote it. */
  amount: string
}

export function FailedView({
  text,
  hash,
  approval,
  unknown,
  onBack,
}: {
  text: string
  hash: string | null
  approval: ApprovalLeft | null
  /** The wallet took the swap, but its outcome could not be read: not "Not swapped". */
  unknown: boolean
  onBack: () => void
}) {
  const focus = useStepFocus(`failed:${text}`)
  return (
    <div className="trade-failed">
      <h3 className="trade-h" tabIndex={-1} ref={focus}>
        {unknown ? 'Swap sent, outcome unknown' : 'Not swapped'}
      </h3>
      <p className="trade-note" role="alert">
        {text}
      </p>
      {hash ? <TxLink hash={hash} what={approval ? 'swap' : 'transaction'} /> : null}
      {approval ? (
        <>
          <p>{approvalLeftText(approval.amount)}</p>
          <TxLink hash={approval.hash} what="approval" />
        </>
      ) : null}
      <div className="trade-actions">
        <Button onClick={onBack}>Back to the swap</Button>
      </div>
    </div>
  )
}

/** A transaction the wallet took for the swap panel; `hash` is null until it is known. */
export interface SentTx {
  what: 'approval' | 'swap'
  hash: string | null
}

/**
 * A transaction a view that has since gone (another account, network or wallet) handed over.
 * `stopped`: the reader had stopped waiting for that request and confirmed it in the wallet later;
 * it takes the place of the "stopped waiting" note, as an alert, since a swap may now be on its way.
 */
export function SentNote({ what, hash, stopped = false }: SentTx & { stopped?: boolean }) {
  if (stopped) {
    const then =
      what === 'approval'
        ? 'No swap follows it: the DEX contract may use the approved amount until you swap or remove the approval in your wallet.'
        : 'It may still be pending: check it before you swap again.'
    return (
      <p className="trade-note" role="alert">
        The {what} you stopped waiting for was confirmed in your wallet and{' '}
        {hash ? 'sent' : 'handed over'}. {then}{' '}
        {hash ? <TxLink hash={hash} what={what} /> : 'Check your wallet’s activity.'}
      </p>
    )
  }
  const one = what === 'approval' ? 'An approval' : 'A swap'
  return hash ? (
    <p className="trade-note small" role="status">
      {one} you signed was sent before this view changed and may still be pending.{' '}
      <TxLink hash={hash} what={what} />
    </p>
  ) : (
    <p className="trade-note small" role="status">
      {one} you signed was handed to your wallet before this view changed; check your wallet’s
      activity before you try again.
    </p>
  )
}
