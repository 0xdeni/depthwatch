/**
 * The swap form, drawn from TradeSwap's state: what to sell, ETH or WETH, the amount, the slippage
 * tolerance, the live quote and Review. It decides what the form says while the reader types: the
 * amount's problem only once typing pauses (`settled`), the quote card's view (the last quote,
 * dimmed, until the next one is in), an amount within the swap limit when a swap is above it, and
 * why Review is not available yet (its description, for a screen reader).
 */
import { TOKENS } from '@depthwatch/chain/addresses'
import type { TokenInfo } from '@depthwatch/core'
import { type Ref, useId, useRef } from 'react'
import type { PoolDetail } from '../api/types.js'
import { Button } from '../components/ui/Button.js'
import { SegmentedControl } from '../components/ui/SegmentedControl.js'
import { NB } from '../lib/format.js'
import {
  AmountField,
  amountProblem,
  capAmount,
  fieldText,
  maxRoom,
  SlippageField,
} from './AmountField.js'
import type { Side, TradeEnv } from './flow.js'
import { type QuoteOutcome, QuotePreview, type QuoteView, usdValueText } from './QuotePreview.js'
import { unitOf } from './TradeReview.js'
import { parseAmount } from './text.js'

/** A quote's outcome and the inputs it was for (`key`), of which the side (`sideKey`). */
export type KeyedQuote = QuoteOutcome & { key: string; sideKey: string }

export interface SwapFormProps {
  env: TradeEnv
  detail: PoolDetail
  side: Side
  presets: readonly number[]
  /** True when the first token is sold; false for the second. */
  sellFirst: boolean
  onSellFirst: (first: boolean) => void
  /** Null when the pair has no WETH. */
  useEth: boolean | null
  onUseEth: (eth: boolean) => void
  amountText: string
  onAmountText: (text: string) => void
  slippageBps: number
  onSlippage: (bps: number) => void
  /** The input token's balance in raw units; null while it is read. */
  balance: bigint | null
  /** The amount in raw units; null when the text is not an amount. */
  parsed: bigint | null
  /** The inputs have been still for the quote delay. */
  settled: boolean
  /** The last quote of this side (direction, ETH or WETH), for these inputs or earlier ones. */
  last: KeyedQuote | null
  /** The last quote when it is for these inputs. */
  fresh: KeyedQuote | null
  overBalance: boolean
  canReview: boolean
  /** A note after a review that did not go ahead. */
  note: string | null
  reviewing: boolean
  heading: Ref<HTMLHeadingElement>
  onReview: () => void
}

/** Why Review is not available, for a screen reader; null when it is (or while it runs). */
function reviewReason(props: SwapFormProps, noAmount: boolean): string | null {
  const { canReview, fresh } = props
  if (canReview || props.reviewing) return null
  if (noAmount) return 'Enter an amount to review the swap.'
  if (props.overBalance) return 'The amount is more than your balance.'
  if (fresh === null) return 'Getting a live price for this amount.'
  if (fresh.q === 'error') return 'There is no live price for this amount.'
  const decision = fresh.quoted.decision
  if (decision.kind === 'refuse' && decision.reason === 'size-above-max')
    return 'The amount is above the swap limit.'
  return 'The checks on the live price refused this swap.'
}

/**
 * The amount to offer instead of one above the swap limit, as the field would show it: within the
 * limit on both sides (`capAmount`, the amount received at the quote's pool price), below the
 * amount refused and never above Max; null otherwise.
 */
function fitAmount(props: SwapFormProps, usdOf: (token: TokenInfo) => number | null) {
  const { fresh, side, balance, env } = props
  if (fresh?.q !== 'ok' || balance === null) return null
  const { decision, live } = fresh.quoted
  if (decision.kind !== 'refuse' || decision.reason !== 'size-above-max') return null
  const mid = live.poolMid
  // The pool's price is token1 per token0; what one unit sent buys is that or its inverse.
  const perSent =
    mid === null || side.tokenIn.address === env.token0.address
      ? mid
      : { num: mid.den, den: mid.num }
  const cap = capAmount(
    decision.limit ?? env.flagsAtLoad.maxUsd,
    { decimals: side.tokenIn.decimals, usdPrice: usdOf(side.tokenIn) },
    { decimals: side.tokenOut.decimals, usdPrice: usdOf(side.tokenOut), perSent },
    maxRoom(balance, side.ethIn),
  )
  if (cap === null) return null
  const text = fieldText(cap, side.tokenIn.decimals)
  const shown = parseAmount(text, side.tokenIn.decimals)
  return shown !== null && shown > 0n && shown < fresh.amountIn ? text : null
}

/** What the ETH box does on this side, ticked or not. */
function ethNote(side: Side, useEth: boolean): string {
  if (side.tokenIn.address === TOKENS.WETH.address)
    return useEth
      ? 'You pay with ETH from your wallet, not WETH.'
      : 'You pay with WETH from your wallet.'
  return useEth ? 'You get ETH in your wallet, not WETH.' : 'You get WETH in your wallet.'
}

export function SwapForm(props: SwapFormProps) {
  const { env, side, parsed, last, fresh } = props
  const { token0, token1 } = env
  const whyId = useId()
  const ethNoteId = useId()
  const input = useRef<HTMLInputElement>(null)
  const inUnit = unitOf(side.tokenIn, side.ethIn)
  const outUnit = unitOf(side.tokenOut, side.ethOut)
  const usdOf = (token: TokenInfo) =>
    token.address === token0.address ? env.snapshot.token0Usd : env.snapshot.token1Usd
  const symbol = (token: TokenInfo) =>
    unitOf(token, props.useEth === true && token.address === TOKENS.WETH.address)
  const noAmount = parsed === null || parsed === 0n

  // The amount's problem, and the card giving way to it, only once typing pauses.
  const problem = props.settled
    ? amountProblem(props.amountText, side.tokenIn.decimals, inUnit)
    : null
  const fieldError =
    problem ?? (props.settled && props.overBalance ? 'That is more than your balance.' : null)
  const view: QuoteView = noAmount
    ? { v: 'idle', hint: problem === null }
    : last
      ? { v: 'quote', outcome: last, updating: fresh === null }
      : { v: 'loading' }
  const fit = fitAmount(props, usdOf)
  const why = reviewReason(props, noAmount)

  return (
    <form
      className="trade-form"
      onSubmit={(event) => {
        event.preventDefault()
        props.onReview()
      }}
    >
      <h3 className="trade-h" tabIndex={-1} ref={props.heading}>
        Your swap
      </h3>
      <SegmentedControl
        label="What to sell"
        options={[
          { value: '0', label: `Sell ${symbol(token0)}` },
          { value: '1', label: `Sell ${symbol(token1)}` },
        ]}
        value={props.sellFirst ? '0' : '1'}
        onChange={(value) => props.onSellFirst(value === '0')}
      />
      {props.useEth !== null ? (
        <div className="trade-eth">
          <label className="check">
            <input
              type="checkbox"
              checked={props.useEth}
              aria-describedby={ethNoteId}
              onChange={(event) => props.onUseEth(event.target.checked)}
            />
            <span>Use ETH instead of WETH</span>
          </label>
          <p className="small trade-check-note" id={ethNoteId}>
            {ethNote(side, props.useEth)}
          </p>
        </div>
      ) : null}
      <AmountField
        unit={inUnit}
        decimals={side.tokenIn.decimals}
        text={props.amountText}
        onText={props.onAmountText}
        balance={props.balance}
        ethIn={side.ethIn}
        error={fieldError}
        usdText={noAmount ? null : usdValueText(parsed, side.tokenIn.decimals, usdOf(side.tokenIn))}
        maxUsd={env.flagsAtLoad.maxUsd}
        inputRef={input}
      />
      <SlippageField
        presets={props.presets}
        value={props.slippageBps}
        onChange={props.onSlippage}
      />
      <QuotePreview
        view={view}
        detail={props.detail}
        side={side}
        inUnit={inUnit}
        outUnit={outUnit}
        slippageBps={props.slippageBps}
        inUsdPrice={usdOf(side.tokenIn)}
        fit={
          fit === null
            ? null
            : {
                text: `${fit}${NB}${inUnit}`,
                // The button goes with the refusal: the field, which now holds the amount, takes
                // the focus.
                use: () => {
                  props.onAmountText(fit)
                  input.current?.focus()
                },
              }
        }
      />
      {props.note ? (
        <p className="trade-note" role="alert">
          {props.note}
        </p>
      ) : null}
      <div className="trade-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={!props.canReview}
          loading={props.reviewing}
          aria-describedby={why === null ? undefined : whyId}
        >
          Review swap
        </Button>
        <span className="sr-only" id={whyId}>
          {why}
        </span>
      </div>
    </form>
  )
}
