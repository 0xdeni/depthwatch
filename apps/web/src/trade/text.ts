/**
 * The swap panel's words and amounts. Amounts stay bigint until they are written out: what the
 * reader sends is written exactly, what they receive at least is rounded down (so the promise
 * holds), and the estimate is `amount` of lib/format (4 significant figures).
 */
import type { TradeDecision } from '@depthwatch/core'
import { NB, usd } from '../lib/format.js'
import { groupDigits } from '../lib/raw.js'
import { type StopReason, TradeStop } from './reads.js'

/** Digits grouped by thousands with commas, then an optional decimal part: "1,250.5". */
const GROUPED = /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d*)?$/

/**
 * Raw units of a decimal the reader typed, or null when it is not one. The decimal mark is the
 * dot, or a comma (the only mark of a comma-decimal keypad) where it cannot be a thousands
 * separator: a single comma with no dot that is not a thousands group ("0,5", "12,25", "0,125").
 * A comma is read as a thousands separator only in groups followed by a dot ("1,250.5") or with
 * more than one comma ("1,250,000"). "1,250" alone could be either, so it is refused, never
 * guessed: a decimal comma read as a thousands separator multiplies the amount.
 */
export function parseAmount(text: string, decimals: number): bigint | null {
  let clean = text.trim()
  const commas = clean.split(',').length - 1
  if (commas === 1 && !clean.includes('.') && !GROUPED.test(clean)) clean = clean.replace(',', '.')
  else if (commas > 0) {
    if (!GROUPED.test(clean) || (commas === 1 && !clean.includes('.'))) return null
    clean = clean.replace(/,/g, '')
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(clean)
  if (!match || clean === '' || clean === '.') return null
  const [, whole = '', frac = ''] = match
  if (frac.length > decimals) return null
  return BigInt(`${whole || '0'}${frac.padEnd(decimals, '0')}`)
}

function split(raw: bigint, decimals: number): { whole: string; frac: string } {
  const text = raw.toString().padStart(decimals + 1, '0')
  const cut = text.length - decimals
  return { whole: text.slice(0, cut), frac: text.slice(cut) }
}

/** Every digit of a raw amount, grouped: "1,250.5". */
export function exactAmount(raw: bigint, decimals: number): string {
  const { whole, frac } = split(raw, decimals)
  const trimmed = frac.replace(/0+$/, '')
  return `${groupDigits(whole)}${trimmed ? `.${trimmed}` : ''}`
}

/** A raw amount for an input field: every digit, no grouping. */
export function inputAmount(raw: bigint, decimals: number): string {
  return exactAmount(raw, decimals).replace(/,/g, '')
}

/** At most `sig` significant digits, rounded down: a floor the reader can rely on. */
export function floorAmount(raw: bigint, decimals: number, sig = 6): string {
  const digits = raw.toString()
  const drop = Math.max(0, digits.length - sig)
  const scale = 10n ** BigInt(drop)
  return exactAmount((raw / scale) * scale, decimals)
}

/** "0.5 %" from 50 bps. */
export function bpsPercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}${NB}%`
}

/** Why core refused the trade, in a sentence. */
export function refusalText(decision: Extract<TradeDecision, { kind: 'refuse' }>): string {
  const { reason, value, limit } = decision
  const at = (v: number | undefined) => (v === undefined ? '' : ` (${bpsPercent(v)})`)
  switch (reason) {
    case 'limits-invalid':
      return 'The swap limits could not be read, so swapping is off.'
    case 'amount-invalid':
      return 'Enter an amount above zero.'
    case 'slippage-invalid':
    case 'slippage-above-max':
      return 'That slippage tolerance is not allowed here.'
    case 'quote-invalid':
    case 'no-output':
      return 'This amount is too small to get anything back.'
    case 'mid-price-invalid':
      return 'The pool’s current price could not be read. Try again in a moment.'
    case 'size-unpriced':
      return 'This swap can’t be valued in dollars, so it is not allowed here.'
    case 'size-above-max': {
      // Just over the limit, both round to the same figure: say "just over" rather than repeat it.
      const size = usd(value) === usd(limit) ? 'just over that' : `about ${usd(value)}`
      return `Swaps are limited to ${usd(limit)} each for now; this one is ${size}. Try a smaller amount.`
    }
    case 'price-impact-above-max':
      return `This amount would move the price too far${at(value)}; the limit is 5${NB}%. Try a smaller amount.`
    case 'quote-inconsistent':
      return 'The live price and the pool’s state disagree. Try again in a moment.'
    case 'snapshot-price-missing':
      return 'The latest snapshot has no price for this pool to check the live price against.'
    case 'snapshot-deviation-above-max':
      return `The live price is too far from the latest snapshot${at(value)}; the limit is 10${NB}%.`
    case 'reference-price-invalid':
      return 'Another pool of this pair gave an unusable price. Try again in a moment.'
    case 'live-deviation-above-max': {
      // Core compares the effective price (fee and impact included), so the amount is the lever.
      const by = value === undefined ? 'too much' : `by ${bpsPercent(value)}`
      return `At this amount, the price you would get, with the pool fee and price impact, differs ${by} from another live pool of the same pair; the limit is 2${NB}%. Try a smaller amount.`
    }
  }
}

/** The switch read off when the panel connects: nothing has been asked of the wallet yet. */
export const SWITCHED_OFF = 'Swapping in this pool is switched off right now.'

/**
 * Why the panel stopped, in a sentence. `approved`: an approval of this swap went through just
 * before, so "nothing was sent" would be false; the sentence says the swap was not sent instead,
 * and the panel adds what the approval left (`approvalLeftText`).
 */
export function stopText(
  reason: StopReason,
  what: 'approval' | 'swap' = 'swap',
  approved = false,
): string {
  const notSent = approved ? 'The swap was not sent.' : 'Nothing was sent.'
  switch (reason) {
    case 'no-route':
      return 'This pool’s DEX contract is not on Depthwatch’s list, so it can’t be traded here.'
    case 'pool-mismatch':
      return 'The pool onchain does not match this page, so it can’t be traded here.'
    case 'token-not-allowed':
      return 'One of this pool’s tokens is not on the swap list.'
    case 'quote-failed':
      return 'The pool did not return a price. Try again in a moment.'
    case 'partial-fill':
      return 'The pool can’t fill this whole amount. Try a smaller one.'
    case 'switched-off':
      return `${SWITCHED_OFF} ${notSent}`
    case 'simulation-failed':
      return what === 'approval'
        ? 'The approval would fail right now, so nothing was sent.'
        : `The swap would fail right now, so ${approved ? 'it was not sent' : 'nothing was sent'}. Try a smaller amount or a higher slippage tolerance.`
    case 'balance-low':
      return 'Your balance is lower than this amount.'
    case 'allowance-low':
      return `The approval does not cover this amount yet. ${notSent}`
    case 'refused':
      return `The live price no longer passes the checks. ${notSent}`
  }
}

/** What a confirmed approval leaves when its swap is not made: the fee paid, the allowance. */
export function approvalLeftText(sendText: string): string {
  return `Your approval went through, and you paid its network fee. The DEX contract may still use exactly ${sendText} of yours until you swap or remove the approval in your wallet.`
}

/**
 * A step the wallet took whose outcome Depthwatch could not read: never "not sent". `hash`: the
 * transaction's hash is known (the panel links it); else it was a call bundle still without one.
 */
export function lostTrackText(what: 'approval' | 'swap', error: string, hash: boolean): string {
  const why = error.replace(/\.$/, '')
  return hash
    ? `Depthwatch lost track of the ${what}: ${why}. Check it on Basescan.`
    : `Your wallet took the ${what}, but Depthwatch lost track of it: ${why}. It may still go through; check your wallet’s activity before you try again.`
}

/**
 * Why an approve-then-swap step failed. `rejected`: turned down in the wallet; `lost`: the wallet
 * took the request (`hash`: its transaction hash is known), so the outcome is unknown; else the
 * step stopped before its signature request. `approved`: an approval went through just before.
 */
export function failedStepText(
  error: unknown,
  what: 'approval' | 'swap',
  { approved, rejected, lost, hash }: FailedStep,
): string {
  if (rejected) return approved ? SWAP_CANCELLED : CANCELLED
  if (lost) return lostTrackText(what, errorMessage(error), hash !== null)
  if (error instanceof TradeStop) return stopText(error.reason, what, approved)
  return `The ${what} was not sent: ${errorMessage(error)}`
}

interface FailedStep {
  approved: boolean
  rejected: boolean
  lost: boolean
  hash: string | null
}

/** An approval of a plan, as the review wrote its amount (`ApprovalLeft` of TradeReview.tsx). */
type Approved = { amount: string } | null

/** The review again after a fresh quote's minimum fell; an approval of it still covers it. */
export function priceMovedText(approval: Approved): string {
  const kept = approval
    ? `; your approval of ${approval.amount} went through and still covers this amount`
    : ''
  return `The price moved since you reviewed${kept}. Check the new amounts before you swap.`
}

/** Back to the form when only paying out ETH failed its simulation; WETH out is offered. */
export function wethOutText(approval: Approved): string {
  const left = approval ? ` ${approvalLeftText(approval.amount)}` : ''
  return `This DEX contract could not pay out ETH here, so the swap now pays out WETH. Review it again.${left}`
}

/** A wallet's or viem's error as one short line. */
export function errorMessage(error: unknown): string {
  const e = error as { shortMessage?: unknown; message?: unknown } | null
  const text = typeof e?.shortMessage === 'string' ? e.shortMessage : e?.message
  const line = (typeof text === 'string' ? text : String(error)).split('\n')[0]?.trim() ?? ''
  return line.length > 160 ? `${line.slice(0, 157)}…` : line || 'unknown error'
}

export const CANCELLED = 'Cancelled; nothing was sent.'
/** A swap rejected in the wallet after its approval went through. */
export const SWAP_CANCELLED = 'You cancelled the swap, so it was not sent.'
export const NOTHING_SWAPPED = 'Nothing was swapped; you paid only the network fee.'
