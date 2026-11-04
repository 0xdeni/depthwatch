/**
 * The swap panel's later views: the review ("you send exactly … you receive at least …", each
 * token with its name and address on Base), a step in progress, and the outcome. Presentational:
 * `TradeSwap` owns the state and the actions.
 */
import type { TokenInfo } from '@depthwatch/core'
import type { PoolDetail } from '../api/types.js'
import { Button } from '../components/ui/Button.js'
import { Disclosure } from '../components/ui/Disclosure.js'
import { amount, dexLabel, feeText, group, NB } from '../lib/format.js'
import { BUILDER_CODE } from './builderCode.js'
import type { Plan, Stage, StepResult } from './flow.js'
import { approvalLeftText, bpsPercent, exactAmount, floorAmount } from './text.js'
import { useStepFocus } from './useStepFocus.js'

const BASESCAN = 'https://basescan.org'

/** The unit of a side: ETH when it travels as ETH, else the token's symbol. */
export function unitOf(token: { symbol: string }, eth: boolean): string {
  return eth ? 'ETH' : token.symbol
}

function Explorer({ kind, value }: { kind: 'address' | 'token' | 'tx'; value: string }) {
  return (
    <a
      className="plink addr"
      href={`${BASESCAN}/${kind}/${value}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      {value}
    </a>
  )
}

export function TxLink({ hash, what = 'transaction' }: { hash: string; what?: string }) {
  return (
    <a className="ulink" href={`${BASESCAN}/tx/${hash}`} target="_blank" rel="noreferrer noopener">
      View the {what} on Basescan
    </a>
  )
}

/**
 * A token of the swap as the allowlist compiles it in: symbol, name and its address on Base,
 * linked to Basescan, so a lookalike symbol can be told apart. ETH travels as WETH.
 */
function TokenFact({ token, eth, dir }: { token: TokenInfo; eth: boolean; dir: 'in' | 'out' }) {
  return (
    <dd>
      <span>
        {eth ? `ETH, ${dir === 'in' ? 'sent as' : 'paid out from'} ` : null}
        <strong>{token.symbol}</strong> {token.name}, on Base
      </span>
      <Explorer kind="token" value={token.address} />
    </dd>
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
  note: string | null
  onConfirm: () => void
  onBack: () => void
}) {
  const focus = useStepFocus(`review:${plan.minOut}:${note}`)
  const { side, amountIn, quoted } = plan
  const inUnit = unitOf(side.tokenIn, side.ethIn)
  const outUnit = unitOf(side.tokenOut, side.ethOut)
  const sendText = `${exactAmount(amountIn, side.tokenIn.decimals)}${NB}${inUnit}`
  const decision = quoted.decision
  const impact = decision.kind === 'refuse' ? 0 : Math.max(0, decision.priceImpactBps)
  return (
    <div className="trade-review">
      <h3 className="trade-h" tabIndex={-1} ref={focus}>
        Review the swap
      </h3>
      {note ? (
        <p className="trade-note" role="alert">
          {note}
        </p>
      ) : null}
      <p className="trade-say">
        You send exactly <strong className="num">{sendText}</strong>.
      </p>
      <p className="trade-say">
        You receive at least{' '}
        <strong className="num">
          {floorAmount(plan.minOut, side.tokenOut.decimals)}
          {NB}
          {outUnit}
        </strong>
        , or the swap fails and you lose only the network fee.
      </p>
      <p className="muted">
        About {amount(quoted.live.amountOut.toString(), side.tokenOut.decimals)}
        {NB}
        {outUnit} at the price of block {group(quoted.live.blockNumber)}.
      </p>
      {decision.kind === 'warn' ? (
        <p className="trade-warn">
          Price impact is high ({bpsPercent(impact)}): you get noticeably less than the pool’s
          price.
        </p>
      ) : null}
      <dl className="about is-one-col trade-facts">
        <div>
          <dt>You send</dt>
          <TokenFact token={side.tokenIn} eth={side.ethIn} dir="in" />
        </div>
        <div>
          <dt>You receive</dt>
          <TokenFact token={side.tokenOut} eth={side.ethOut} dir="out" />
        </div>
        <div>
          <dt>Pool</dt>
          <dd>
            <Explorer kind="address" value={detail.pool.address ?? ''} />
            <span className="muted">{dexLabel(detail.pool.dex)}</span>
          </dd>
        </div>
        <div>
          <dt>DEX contract</dt>
          <dd>
            <Explorer kind="address" value={router} />
          </dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd>
            <span className="addr">{account}</span>
            <span className="muted">your account</span>
          </dd>
        </div>
        <div>
          <dt>Price impact</dt>
          <dd className="num">{bpsPercent(impact)}</dd>
        </div>
        <div>
          <dt>Live pool fee</dt>
          <dd className="num">{feeText({ dex: detail.pool.dex, feePips: quoted.live.feePips })}</dd>
        </div>
        <div>
          <dt>Slippage tolerance</dt>
          <dd className="num">{bpsPercent(plan.slippageBps)}</dd>
        </div>
      </dl>
      <ol className="trade-steps">
        {plan.needsApproval ? (
          <li>Allow the DEX contract to use exactly {sendText}, and no more.</li>
        ) : null}
        <li>Swap, in one wallet prompt.</li>
      </ol>
      {plan.unlimitedAllowance ? (
        <p className="muted small">
          This wallet already lets the DEX contract use any amount of {side.tokenIn.symbol}, from an
          earlier approval. Depthwatch never asks for that; you can remove it in your wallet.
        </p>
      ) : null}
      <p>Depthwatch takes no fee.</p>
      <p className="muted small">
        Each transaction carries Depthwatch’s public Builder Code ({BUILDER_CODE}), a short tag Base
        uses to count app activity.
        {suffixMayBeLost
          ? ' Your account is a smart contract wallet that does not say it can carry the code, so it may not be recorded for this swap. The swap itself is not affected.'
          : null}
      </p>
      <div className="trade-actions">
        <Button variant="primary" onClick={onConfirm}>
          {plan.needsApproval ? `Approve ${sendText}` : 'Swap'}
        </Button>
        <Button onClick={onBack}>Back</Button>
      </div>
    </div>
  )
}

const STAGE_TEXT = {
  approve: {
    checking: 'Checking the approval…',
    sign: 'Confirm the approval in your wallet.',
    wait: 'Waiting for the approval to be included…',
  },
  swap: {
    checking: 'Getting a fresh price and checking the swap…',
    sign: 'Confirm the swap in your wallet.',
    wait: 'Waiting for the swap to be included…',
  },
} as const

export function WorkingView({ what, stage }: { what: 'approve' | 'swap'; stage: Stage }) {
  const focus = useStepFocus(`working:${what}`)
  return (
    <div className="trade-working">
      <h3 className="trade-h" tabIndex={-1} ref={focus}>
        {what === 'approve' ? 'Step 1: approve' : 'Swapping'}
      </h3>
      <p role="status" aria-live="polite">
        {STAGE_TEXT[what][stage.at]}
      </p>
      {stage.at === 'wait' && stage.hash ? <TxLink hash={stage.hash} /> : null}
    </div>
  )
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
  const focus = useStepFocus(`done:${result.hash}`)
  const { tokenOut, ethOut } = plan.side
  const ours = result.codes?.includes(BUILDER_CODE) === true
  // Included but no payment to the account found: say so rather than "done".
  return (
    <div className="trade-done">
      <h3 className="trade-h" tabIndex={-1} ref={focus}>
        {result.received === null ? 'Swap included, not confirmed' : 'Swap done'}
      </h3>
      <p className="trade-say" role="status">
        {result.received === null ? (
          'The transaction is included, but Depthwatch found no payment to your account in it, so it cannot confirm what you received. Check it on Basescan.'
        ) : (
          <>
            You received{' '}
            <strong className="num">
              {exactAmount(result.received, tokenOut.decimals)}
              {NB}
              {unitOf(tokenOut, ethOut)}
            </strong>
            .
          </>
        )}
      </p>
      <TxLink hash={result.hash} />
      <Disclosure label="Details">
        <dl className="about is-one-col trade-facts">
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

/** A transaction a view that has since gone (another account, network or wallet) handed over. */
export function SentNote({ what, hash }: SentTx) {
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
