/**
 * The form's live quote, one card of one height whatever it shows: before an amount, while the
 * first price loads, a quote, the last quote with its figures dimmed while a new one loads
 * ("Updating the price…"), a refusal or an error. Every line is always there (a dash stands in for
 * a value not known), so the card never collapses and nothing under it moves while the reader types.
 *
 * A quote reads: what the reader receives, about and at least, and the rate, fee included; then the
 * total cost against the pool's price before the swap, its fee included (core's price impact:
 * percent first, then dollars and bps; the network fee is extra), split into the pool's fee read
 * with the quote (the fee a swap at that block pays, not the snapshot's; it can change by the block
 * the swap lands in) and the rest, the price move from the amount; the slippage tolerance and the
 * block the price was read at. The amount received has no dollar value: at the other token's
 * snapshot price it would differ from the amount sent by more than the cost whenever the pool's
 * price has moved since the snapshot. Core's warning is a callout that says whether the fee or the
 * amount makes the cost high; a refusal or an error is a sentence. A screen reader hears a quote
 * once it is in, from a summary that keeps its words until the next one, and the message line from
 * a status: never a keystroke's "Updating".
 */
import { rawToHuman, tradeSizeUsd } from '@depthwatch/core'
import type { PoolDetail } from '../api/types.js'
import {
  amount,
  DASH,
  feeText,
  group,
  NB,
  price,
  type RoundTripCost,
  roundTripCost,
  usd,
} from '../lib/format.js'
import { type Quoted, quoteSwap, type Side, type TradeEnv } from './flow.js'
import { TradeStop } from './reads.js'
import { bpsPercent, errorMessage, floorAmount, refusalText, stopText } from './text.js'

export type QuoteOutcome =
  | { q: 'ok'; amountIn: bigint; quoted: Quoted }
  | { q: 'error'; text: string }

/** What the card shows: nothing to quote yet, the first price loading, or a quote's outcome. */
export type QuoteView =
  /** `hint`: false while the amount is not a number (the field says why). */
  | { v: 'idle'; hint: boolean }
  | { v: 'loading' }
  /** `updating`: the outcome is the last one, for other inputs, while a new one loads. */
  | { v: 'quote'; outcome: QuoteOutcome; updating: boolean }

/**
 * The USD value of a raw amount at a snapshot price, as "≈ $384 at snapshot prices", with cents
 * under $100 ("≈ $19.21"); or null.
 */
export function usdValueText(
  raw: bigint,
  decimals: number,
  usdPrice: number | null,
): string | null {
  const value = tradeSizeUsd([{ amount: raw, decimals, usdPrice }])
  if (value === null) return null
  const dollars = value >= 0.995 && value < 99.995 ? `$${value.toFixed(2)}` : usd(value)
  return `≈${NB}${dollars} at snapshot prices`
}

/** "1 ETH = 3,840.20 USDC", the side read that is at least 1. */
function rateText(
  side: Side,
  amountIn: bigint,
  amountOut: bigint,
  inUnit: string,
  outUnit: string,
) {
  const per =
    rawToHuman(amountOut, side.tokenOut.decimals) / rawToHuman(amountIn, side.tokenIn.decimals)
  if (!(per > 0) || !Number.isFinite(per)) return null
  return per >= 1
    ? `1${NB}${inUnit} = ${price(per)}${NB}${outUnit}`
    : `1${NB}${outUnit} = ${price(1 / per)}${NB}${inUnit}`
}

/** The fee's share of a cost in bps: the pool's fee in pips is 1/100 of a bps. */
const feeBps = (feePips: number) => feePips / 100

/**
 * Core's warning on a costly quote (price impact above 1 %), saying what makes the cost high: the
 * pool's own fee, which any amount pays, when it is at least half of the total cost; otherwise the
 * size of the swap.
 */
export function highCostText(impactBps: number, feePips: number): string {
  const fee = feeBps(feePips)
  return fee * 2 >= impactBps
    ? `High cost, mostly the pool’s ${bpsPercent(fee)} fee, which any amount pays.`
    : 'High cost, mostly from this swap’s size: a smaller one costs less.'
}

/**
 * Core's price impact as the total cost, its fee included, then its two parts: the live pool fee
 * and the rest, the price move. The impact is whole bps rounded up, so the move can read up to
 * 0.01 % high; under 1 bps it reads "under 0.01 %". Only the figures dim while a new quote loads.
 */
function Cost({
  impact,
  total,
  fee,
}: {
  impact: number | null
  total: RoundTripCost | null
  fee: { dex: string; feePips: number } | null
}) {
  const move = impact === null || fee === null ? null : impact - feeBps(fee.feePips)
  return (
    <>
      <div className="tq-total">
        <dt>Total cost, pool fee included</dt>
        <dd>
          <span className="num tq-dim">{impact === null ? DASH : bpsPercent(impact)}</span>
          <span className="tq-sub">{total ? `about ${total.dollars} (${total.bps})` : NB}</span>
        </dd>
      </div>
      <div>
        <dt>of which pool fee</dt>
        <dd className="num tq-dim">{fee === null ? DASH : feeText(fee)}</dd>
      </div>
      <div>
        <dt>of which price move</dt>
        <dd className="num tq-dim">
          {move === null ? DASH : move < 1 ? `under 0.01${NB}%` : bpsPercent(move)}
        </dd>
      </div>
    </>
  )
}

export function QuotePreview({
  view,
  detail,
  side,
  inUnit,
  outUnit,
  slippageBps,
  inUsdPrice,
  fit,
}: {
  view: QuoteView
  detail: PoolDetail
  side: Side
  inUnit: string
  outUnit: string
  slippageBps: number
  inUsdPrice: number | null
  /** An amount within the swap limit ("0.25386 ETH"), offered when a swap is above it. */
  fit: { text: string; use: () => void } | null
}) {
  const outcome = view.v === 'quote' ? view.outcome : null
  const quote = outcome?.q === 'ok' ? outcome : null
  const decision = quote?.quoted.decision ?? null
  const figures = decision && decision.kind !== 'refuse' ? decision : null
  const live = quote?.quoted.live ?? null
  const updating = view.v === 'quote' && view.updating
  const busy = updating || view.v === 'loading'

  const about = live
    ? `${amount(live.amountOut.toString(), side.tokenOut.decimals)}${NB}${outUnit}`
    : DASH
  const least = figures
    ? `${floorAmount(figures.minAmountOut, side.tokenOut.decimals)}${NB}${outUnit}`
    : null
  const rate =
    quote && live ? rateText(side, quote.amountIn, live.amountOut, inUnit, outUnit) : null
  const inUsd = quote
    ? tradeSizeUsd([
        { amount: quote.amountIn, decimals: side.tokenIn.decimals, usdPrice: inUsdPrice },
      ])
    : null
  const impact = figures ? Math.max(0, figures.priceImpactBps) : null
  const total = figures && impact !== null ? roundTripCost(impact, inUsd ?? figures.sizeUsd) : null
  const fee = figures && live ? { dex: detail.pool.dex, feePips: live.feePips } : null
  // What a screen reader hears of a quote: its words stay the same while the next one loads, so it
  // is said once that one is in; a refusal or an error is the status's.
  const said =
    least !== null && impact !== null
      ? `Live price: you get about ${about}, at least ${least}. Total cost ${bpsPercent(impact)}${total ? `, about ${total.dollars}` : ''}.`
      : ''

  // The line under the amount: the minimum, or what the card is waiting for.
  let status: string | null = null
  if (view.v === 'idle') status = view.hint ? 'Enter an amount to get a live price.' : NB
  else if (view.v === 'loading') status = 'Getting a live price from the pool…'
  else if (updating) status = 'Updating the price…'

  // The message: core's warning, a refusal or an error; otherwise what the total cost is.
  let message: { tone: 'warn' | 'bad' | 'note'; text: string } | null = null
  if (!updating && outcome?.q === 'error') message = { tone: 'note', text: outcome.text }
  else if (!updating && decision?.kind === 'refuse')
    message = { tone: 'bad', text: refusalText(decision) }
  else if (!updating && decision?.kind === 'warn' && live)
    message = {
      tone: 'warn',
      text: highCostText(Math.max(0, decision.priceImpactBps), live.feePips),
    }

  return (
    <div className={`trade-quote${updating ? ' is-updating' : ''}`} aria-busy={busy}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {said}
      </p>
      <div className="tq-main">
        <p className="tq-lead">
          {figures ? 'You receive about ' : decision ? 'You would receive about ' : 'You receive '}
        </p>
        <p className="tq-out tq-dim">
          <strong className="num tq-fig">{about}</strong>
        </p>
        <p className="tq-min">
          {status !== null ? (
            <span className="muted">{status}</span>
          ) : least !== null ? (
            <>
              and at least <strong className="num">{least}</strong>
            </>
          ) : (
            <span className="muted">at least {DASH}</span>
          )}
        </p>
        <p className="tq-rate small muted">{rate ? `${rate}, fee included` : `Rate ${DASH}`}</p>
      </div>
      <dl className="trade-figs">
        <Cost impact={impact} total={total} fee={fee} />
        <div>
          <dt>Slippage tolerance</dt>
          <dd className="num">{bpsPercent(slippageBps)}</dd>
        </div>
        <div>
          <dt>Live price at</dt>
          <dd className="num tq-dim">{live ? `block ${group(live.blockNumber)}` : DASH}</dd>
        </div>
      </dl>
      <div className="tq-msg">
        <p
          className={
            message
              ? `trade-${message.tone === 'warn' ? 'warn' : 'note'} tq-${message.tone}`
              : 'tq-live'
          }
          role="status"
        >
          {message?.text ?? null}
          {fit &&
          message?.tone === 'bad' &&
          decision?.kind === 'refuse' &&
          decision.reason === 'size-above-max' ? (
            <>
              {' '}
              <button type="button" className="quiet-link trade-linkbtn tq-fit" onClick={fit.use}>
                Use {fit.text} instead
              </button>
            </>
          ) : null}
        </p>
        {message === null ? (
          <p className="muted">
            Total cost: how much less than the pool’s current price you get, its fee included. The
            network fee is extra.
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** The form's live quote, never throwing: an error becomes a sentence. */
export async function previewQuote(
  env: TradeEnv,
  side: Side,
  amountIn: bigint,
  slippageBps: number,
): Promise<QuoteOutcome> {
  try {
    const quoted = await quoteSwap(env, side, amountIn, slippageBps, env.flagsAtLoad)
    return { q: 'ok', amountIn, quoted }
  } catch (error) {
    const text =
      error instanceof TradeStop ? stopText(error.reason) : `No live price: ${errorMessage(error)}`
    return { q: 'error', text }
  }
}
