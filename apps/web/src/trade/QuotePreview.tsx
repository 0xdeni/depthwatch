/**
 * The form's live quote: what the reader would receive, about and at least, with the price
 * impact, the pool's fee read with the quote (the fee a swap at that block pays, not the
 * snapshot's; it can change by the block the swap lands in), the slippage tolerance and the block
 * the price was read at; core's warning or refusal in a sentence. A polite live region, so a
 * screen reader hears each new quote once.
 */
import type { ReactNode } from 'react'
import type { PoolDetail } from '../api/types.js'
import { amount, feeText, group, NB } from '../lib/format.js'
import { type Quoted, quoteSwap, type Side, type TradeEnv } from './flow.js'
import { TradeStop } from './reads.js'
import { bpsPercent, errorMessage, floorAmount, refusalText, stopText } from './text.js'

export type QuoteOutcome =
  | { q: 'ok'; amountIn: bigint; quoted: Quoted }
  | { q: 'error'; text: string }

export type Preview = ({ q: 'idle' } | { q: 'loading' } | QuoteOutcome) & { key: string }

export function QuotePreview({
  preview,
  detail,
  side,
  outUnit,
  slippageBps,
}: {
  preview: Preview
  detail: PoolDetail
  side: Side
  outUnit: string
  slippageBps: number
}) {
  let body: ReactNode
  if (preview.q === 'idle') body = <p className="muted">Enter an amount to get a live price.</p>
  else if (preview.q === 'loading')
    body = <p className="muted">Getting a live price from the pool…</p>
  else if (preview.q === 'error')
    body = (
      <p className="trade-note" role="alert">
        {preview.text}
      </p>
    )
  else {
    const { live, decision } = preview.quoted
    const about = `${amount(live.amountOut.toString(), side.tokenOut.decimals)}${NB}${outUnit}`
    if (decision.kind === 'refuse')
      body = (
        <>
          <p>
            You would receive about <strong className="num">{about}</strong>.
          </p>
          <p className="trade-note" role="alert">
            {refusalText(decision)}
          </p>
        </>
      )
    else {
      const impact = Math.max(0, decision.priceImpactBps)
      body = (
        <>
          <p>
            You receive about <strong className="num">{about}</strong>, and at least{' '}
            <strong className="num">
              {floorAmount(decision.minAmountOut, side.tokenOut.decimals)}
              {NB}
              {outUnit}
            </strong>
            .
          </p>
          {decision.kind === 'warn' ? (
            <p className="trade-warn">
              Price impact is high ({bpsPercent(impact)}): you get noticeably less than the pool’s
              price.
            </p>
          ) : null}
          <dl className="trade-figs">
            <div>
              <dt>Price impact</dt>
              <dd className="num">{bpsPercent(impact)}</dd>
            </div>
            <div>
              <dt>Live pool fee</dt>
              <dd className="num">{feeText({ dex: detail.pool.dex, feePips: live.feePips })}</dd>
            </div>
            <div>
              <dt>Slippage tolerance</dt>
              <dd className="num">{bpsPercent(slippageBps)}</dd>
            </div>
            <div>
              <dt>Live price</dt>
              <dd className="num">block {group(live.blockNumber)}</dd>
            </div>
          </dl>
        </>
      )
    }
  }
  return (
    <div className="trade-quote" aria-live="polite" aria-busy={preview.q === 'loading'}>
      {body}
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
