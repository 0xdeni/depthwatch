/**
 * The swap in a connected, checked pool: direction, ETH or WETH, amount (balance and Max, which
 * keeps 0.0005 ETH for network fees), slippage, the live quote with core's checks, then review,
 * approval (only when the allowance is short, for exactly the amount), swap and outcome. A started
 * approve-then-swap asks nothing more of the wallet once this view is gone (unmounted, or the
 * panel moved to another account or network: `env.active`); each transaction the wallet takes is
 * reported to the panel (`onSent`), which keeps it in view after this one has gone.
 */
import { TOKENS } from '@depthwatch/chain/addresses'
import {
  effectiveMaxSlippageBps,
  TRADE_DEFAULT_SLIPPAGE_BPS,
  validateSlippageBps,
} from '@depthwatch/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PoolDetail } from '../api/types.js'
import { Button } from '../components/ui/Button.js'
import { Checkbox } from '../components/ui/Inputs.js'
import { SegmentedControl } from '../components/ui/SegmentedControl.js'
import { NB } from '../lib/format.js'
import { useDebounced } from '../lib/useDebounced.js'
import { AmountField } from './AmountField.js'
import {
  approveStep,
  isUserRejection,
  type Plan,
  reviewSwap,
  type Side,
  type Stage,
  type StepResult,
  swapStep,
  type TradeEnv,
} from './flow.js'
import { type Preview, previewQuote, QuotePreview } from './QuotePreview.js'
import { TradeStop } from './reads.js'
import {
  type ApprovalLeft,
  DoneView,
  FailedView,
  ReviewView,
  type SentTx,
  unitOf,
  WorkingView,
} from './TradeReview.js'
import {
  errorMessage,
  exactAmount,
  failedStepText,
  NOTHING_SWAPPED,
  parseAmount,
  priceMovedText,
  refusalText,
  stopText,
  wethOutText,
} from './text.js'
import { useBalanceIn } from './useBalanceIn.js'
import { useStepFocus } from './useStepFocus.js'

const SLIPPAGE_PRESETS_BPS = [10, 50, 100, 300]

type Phase =
  | { p: 'form'; note: string | null }
  | { p: 'reviewing' }
  /** `approval`: one that went through for this plan before the price moved. */
  | { p: 'review'; plan: Plan; note: string | null; approval: ApprovalLeft | null }
  | { p: 'working'; plan: Plan; what: 'approve' | 'swap'; stage: Stage }
  | { p: 'done'; plan: Plan; result: Extract<StepResult, { kind: 'done' }> }
  /** `unknown`: the wallet took the swap, but its outcome could not be read. */
  | {
      p: 'failed'
      text: string
      hash: string | null
      approval: ApprovalLeft | null
      unknown: boolean
    }

export function TradeSwap({
  env,
  detail,
  quoteDelayMs,
  onSent,
}: {
  env: TradeEnv
  detail: PoolDetail
  quoteDelayMs: number
  /** Told each transaction the wallet takes; null once this view shows its outcome. */
  onSent: (tx: SentTx | null) => void
}) {
  const { token0, token1 } = env
  const weth = TOKENS.WETH.address
  const hasWeth = token0.address === weth || token1.address === weth
  const maxBps =
    effectiveMaxSlippageBps(env.flagsAtLoad.maxSlippageBps) ?? TRADE_DEFAULT_SLIPPAGE_BPS
  const presets = SLIPPAGE_PRESETS_BPS.filter((bps) => bps <= maxBps)
  const startBps = validateSlippageBps(undefined, env.flagsAtLoad.maxSlippageBps)

  const [sellFirst, setSellFirst] = useState(true)
  const [useEth, setUseEth] = useState(hasWeth)
  const [amountText, setAmountText] = useState('')
  const [slippageBps, setSlippageBps] = useState(startBps.ok ? startBps.bps : maxBps)
  const [phase, setPhase] = useState<Phase>({ p: 'form', note: null })
  const [preview, setPreview] = useState<Preview>({ q: 'idle', key: '' })
  const [balanceTick, setBalanceTick] = useState(0)
  const quoteRun = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const side: Side = useMemo(() => {
    const tokenIn = sellFirst ? token0 : token1
    const tokenOut = sellFirst ? token1 : token0
    return {
      tokenIn,
      tokenOut,
      ethIn: useEth && tokenIn.address === weth,
      ethOut: useEth && tokenOut.address === weth,
    }
  }, [sellFirst, useEth, token0, token1, weth])
  const balanceIn = useBalanceIn(env, side, balanceTick)
  const inUnit = unitOf(side.tokenIn, side.ethIn)
  const outUnit = unitOf(side.tokenOut, side.ethOut)
  const parsed = parseAmount(amountText, side.tokenIn.decimals)
  const key = JSON.stringify([amountText, sellFirst, useEth, slippageBps])
  const settledKey = useDebounced(key, quoteDelayMs)

  // The live quote, once the inputs have been still for `quoteDelayMs`.
  const formOpen = phase.p === 'form'
  useEffect(() => {
    if (!formOpen || settledKey !== key) return
    const id = ++quoteRun.current
    if (parsed === null || parsed === 0n) {
      setPreview({ q: 'idle', key })
      return
    }
    setPreview({ q: 'loading', key })
    void previewQuote(env, side, parsed, slippageBps).then((next) => {
      if (quoteRun.current === id) setPreview({ ...next, key })
    })
  }, [formOpen, settledKey, key, parsed, env, side, slippageBps])

  const overBalance = parsed !== null && balanceIn !== null && parsed > balanceIn
  const fresh = preview.key === key ? preview : null
  const canReview =
    phase.p === 'form' &&
    fresh?.q === 'ok' &&
    fresh.quoted.decision.kind !== 'refuse' &&
    !overBalance

  const review = async () => {
    if (!canReview || fresh?.q !== 'ok') return
    setPhase({ p: 'reviewing' })
    try {
      const result = await reviewSwap(env, side, fresh.amountIn, slippageBps)
      if (result.kind === 'plan')
        setPhase({ p: 'review', plan: result.plan, note: null, approval: null })
      else if (result.kind === 'refused' && result.decision.kind === 'refuse')
        setPhase({ p: 'form', note: refusalText(result.decision) })
      else
        setPhase({
          p: 'form',
          note: stopText(result.kind === 'stopped' ? result.reason : 'refused'),
        })
    } catch (error) {
      const note =
        error instanceof TradeStop
          ? stopText(error.reason)
          : `The swap could not be reviewed: ${errorMessage(error)}`
      setPhase({ p: 'form', note })
    }
  }

  /** Shows a step's result; `approval` is the one confirmed just before this swap, if any. */
  const settle = (
    result: StepResult,
    plan: Plan,
    what: 'approval' | 'swap',
    approval: ApprovalLeft | null,
  ) => {
    const failed = (text: string, hash: string | null = null) =>
      setPhase({ p: 'failed', text, hash, approval, unknown: false })
    const approved = approval !== null
    switch (result.kind) {
      case 'approved':
      case 'abandoned':
        return
      case 'done':
        setBalanceTick((n) => n + 1)
        setPhase({ p: 'done', plan, result })
        return
      case 'reverted':
        return failed(
          what === 'approval'
            ? 'The approval failed onchain; you paid only the network fee.'
            : NOTHING_SWAPPED,
          result.hash,
        )
      case 'not-sent':
        return failed(
          approved
            ? 'The wallet did not send the swap.'
            : 'The wallet did not send it. Nothing was sent.',
        )
      case 'price-moved':
        // The approval, if any, is exactly this plan's input: it still covers the swap.
        setPhase({ p: 'review', plan: result.plan, note: priceMovedText(approval), approval })
        return
      case 'eth-out-unavailable':
        setUseEth(false)
        setPhase({ p: 'form', note: wethOutText(approval) })
        return
      case 'stopped':
        return failed(
          result.reason === 'refused' && result.decision?.kind === 'refuse'
            ? `${refusalText(result.decision)} ${approved ? 'The swap was not sent.' : 'Nothing was sent.'}`
            : stopText(result.reason, what, approved),
        )
    }
  }

  /** `carried`: an approval of this plan that went through before its price moved. */
  const confirm = async (plan: Plan, carried: ApprovalLeft | null) => {
    // This confirm's wallet requests stop once the view is gone or the panel moved on.
    const alive = () => mounted.current && env.active()
    let what: 'approval' | 'swap' = 'approval'
    let approval = carried
    // `sent`: the wallet took the step's request (a hash may not be known yet: a call bundle).
    const seen: { hash: string | null; sent: boolean } = { hash: null, sent: false }
    const track = (stage: Stage, step: 'approve' | 'swap', current: Plan) => {
      if (stage.at === 'wait') {
        seen.sent = true
        if (stage.hash) seen.hash = stage.hash
        onSent({ what: step === 'approve' ? 'approval' : 'swap', hash: seen.hash })
      }
      if (alive()) setPhase({ p: 'working', plan: current, what: step, stage })
    }
    try {
      let current = plan
      if (current.needsApproval) {
        const approved = await approveStep(
          env,
          current,
          (stage) => track(stage, 'approve', current),
          alive,
        )
        if (!alive()) return
        if (approved.kind !== 'approved') {
          onSent(null)
          return settle(approved, current, 'approval', null)
        }
        // A hash means an approval was sent and confirmed now, not an allowance already there.
        if (seen.hash !== null)
          approval = {
            hash: seen.hash,
            amount: `${exactAmount(current.amountIn, current.side.tokenIn.decimals)}${NB}${unitOf(current.side.tokenIn, current.side.ethIn)}`,
          }
        current = { ...current, needsApproval: false }
      }
      what = 'swap'
      seen.hash = null
      seen.sent = false
      const result = await swapStep(env, current, (stage) => track(stage, 'swap', current), alive)
      if (!alive()) return
      onSent(null)
      settle(result, current, 'swap', approval)
    } catch (error) {
      if (!alive()) return
      const { hash, sent } = seen
      const rejected = isUserRejection(error)
      // Once the wallet took the request, the outcome is unknown: never "not sent".
      const lost = !rejected && (hash !== null || sent)
      if (!lost) onSent(null)
      const text = failedStepText(error, what, {
        approved: approval !== null,
        rejected,
        lost,
        hash,
      })
      setPhase({ p: 'failed', text, hash, approval, unknown: lost && what === 'swap' })
    }
  }

  const backToForm = () => setPhase({ p: 'form', note: null })
  // The note is in the key: a review that fails puts focus back on the heading, as the button that
  // had it was disabled while the review ran.
  const focus = useStepFocus(
    `form:${phase.p === 'form' || phase.p === 'reviewing'}:${phase.p === 'form' ? phase.note : ''}`,
  )

  if (phase.p === 'review')
    return (
      <ReviewView
        plan={phase.plan}
        detail={detail}
        router={env.checked.route.router}
        account={env.account}
        suffixMayBeLost={env.suffixMayBeLost}
        note={phase.note}
        onConfirm={() => void confirm(phase.plan, phase.approval)}
        onBack={backToForm}
      />
    )
  if (phase.p === 'working') return <WorkingView what={phase.what} stage={phase.stage} />
  if (phase.p === 'done')
    return <DoneView result={phase.result} plan={phase.plan} onAgain={backToForm} />
  if (phase.p === 'failed')
    return (
      <FailedView
        text={phase.text}
        hash={phase.hash}
        approval={phase.approval}
        unknown={phase.unknown}
        onBack={backToForm}
      />
    )

  const symbol = (token: typeof token0) => unitOf(token, useEth && token.address === weth)
  const invalid = amountText.trim() !== '' && parsed === null
  return (
    <form
      className="trade-form"
      onSubmit={(event) => {
        event.preventDefault()
        void review()
      }}
    >
      <h3 className="trade-h" tabIndex={-1} ref={focus}>
        Your swap
      </h3>
      <SegmentedControl
        label="What to sell"
        options={[
          { value: '0', label: `Sell ${symbol(token0)}` },
          { value: '1', label: `Sell ${symbol(token1)}` },
        ]}
        value={sellFirst ? '0' : '1'}
        onChange={(value) => {
          setSellFirst(value === '0')
          setAmountText('')
        }}
      />
      {hasWeth ? (
        <Checkbox checked={useEth} onChange={(checked) => setUseEth(checked)}>
          Use ETH instead of WETH
        </Checkbox>
      ) : null}
      <AmountField
        unit={inUnit}
        decimals={side.tokenIn.decimals}
        text={amountText}
        onText={setAmountText}
        balance={balanceIn}
        ethIn={side.ethIn}
        invalid={invalid}
        overBalance={overBalance}
      />
      <p className="trade-label" aria-hidden="true">
        Slippage tolerance
      </p>
      <SegmentedControl
        label="Slippage tolerance"
        options={presets.map((bps) => ({
          value: String(bps),
          label: `${bps / 100} %`,
          ariaLabel: `Slippage tolerance ${bps / 100} percent`,
        }))}
        value={String(slippageBps)}
        onChange={(value) => setSlippageBps(Number(value))}
      />
      <QuotePreview
        preview={
          parsed === null || parsed === 0n ? { q: 'idle', key } : (fresh ?? { q: 'loading', key })
        }
        detail={detail}
        side={side}
        outUnit={outUnit}
        slippageBps={slippageBps}
      />
      {phase.p === 'form' && phase.note ? (
        <p className="trade-note" role="alert">
          {phase.note}
        </p>
      ) : null}
      <div className="trade-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={!canReview}
          loading={phase.p === 'reviewing'}
        >
          Review swap
        </Button>
      </div>
    </form>
  )
}
