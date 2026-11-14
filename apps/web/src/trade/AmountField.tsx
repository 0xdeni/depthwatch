/**
 * The form's two inputs. The amount the reader sends: a labelled decimal field with the unit and
 * Max inside it (Max keeps 0.0005 ETH for network fees when paying with ETH), the swap limit beside
 * the label, the balance under it (6 significant digits, rounded down, so it never reads more than
 * the wallet holds), then one line that holds either the amount's value at the snapshot's prices or,
 * once typing pauses, why the text is not an amount (a polite status, linked to the field). And the
 * slippage tolerance, with a line on what the chosen preset means, said aloud once one is chosen.
 */
import { type Fraction, numberToFraction, pow10 } from '@depthwatch/core'
import { type Ref, useId } from 'react'
import { SegmentedControl } from '../components/ui/SegmentedControl.js'
import { NB } from '../lib/format.js'
import { floorAmount, inputAmount, parseAmount } from './text.js'

/** What Max leaves in the wallet when paying with ETH: 0.0005 ETH for network fees. */
export const ETH_GAS_RESERVE = 500_000_000_000_000n

const wholeUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** The swap limit in whole dollars: "Up to $1,000 per swap". */
export function capText(maxUsd: number): string {
  return `Up to ${wholeUsd.format(maxUsd)} per swap`
}

/**
 * A balance for reading: at least 6 significant digits, and every whole digit, rounded down
 * ("1.88379" for 1.883797759828579704, "5,000" for 5,000, "123,456,789" kept whole).
 */
export function balanceText(raw: bigint, decimals: number): string {
  const whole = raw.toString().length - decimals
  return floorAmount(raw, decimals, Math.max(6, whole))
}

/** The amount Max fills: the balance, less 0.0005 ETH for network fees when paying with ETH. */
export function maxRoom(balance: bigint, ethIn: boolean): bigint {
  const room = ethIn ? balance - ETH_GAS_RESERVE : balance
  return room > 0n ? room : 0n
}

/** A side of the swap as the swap limit values it: the token's decimals and snapshot USD price. */
export interface PricedSide {
  decimals: number
  usdPrice: number | null
}

const usable = (price: number | null): price is number =>
  price !== null && price > 0 && Number.isFinite(price)

/**
 * The largest raw amount to send that is worth at most 99 % of `maxUsd` on both sides of the swap
 * at snapshot USD prices, as core values the limit: the amount sent at its price, and what it buys
 * at `perSent` (raw out per raw in: the pool's price before the swap, which no amount gets better
 * than, as the fee and the price move only lower it) at the other token's price. No more than
 * `room`; null when no side has a usable price, or when the side received is priced but there is
 * no pool price to bound it. The 1 % leaves room for the pool's price to move before the next quote.
 */
export function capAmount(
  maxUsd: number,
  sent: PricedSide,
  received: PricedSide & { perSent: Fraction | null },
  room: bigint | null,
): bigint | null {
  if (!(maxUsd > 0) || !Number.isFinite(maxUsd)) return null
  const cap = numberToFraction(maxUsd)
  const bounds: bigint[] = []
  if (usable(sent.usdPrice)) {
    const price = numberToFraction(sent.usdPrice)
    bounds.push((cap.num * 99n * pow10(sent.decimals) * price.den) / (cap.den * 100n * price.num))
  }
  if (usable(received.usdPrice)) {
    const per = received.perSent
    if (per === null || !(per.num > 0n && per.den > 0n)) return null
    const price = numberToFraction(received.usdPrice)
    bounds.push(
      (cap.num * 99n * pow10(received.decimals) * price.den * per.den) /
        (cap.den * 100n * price.num * per.num),
    )
  }
  const raw = bounds.reduce<bigint | null>((low, b) => (low === null || b < low ? b : low), null)
  if (raw === null) return null
  return room !== null && room < raw ? room : raw
}

/** A raw amount as the field's text, rounded down to 6 significant digits: "0.257658". */
export function fieldText(raw: bigint, decimals: number): string {
  return floorAmount(raw, decimals, 6).replace(/,/g, '')
}

/**
 * Why `text` is not an amount of a token with `decimals` decimals, in a short sentence; null when
 * it is one (or is empty). Each cause has its own sentence, never one sentence for all of them.
 */
export function amountProblem(text: string, decimals: number, unit: string): string | null {
  const clean = text.trim()
  if (clean === '' || parseAmount(clean, decimals) !== null) return null
  // The same text with room for any number of decimals: then only the decimals were too many.
  if (parseAmount(clean, 77) !== null)
    return `${unit} allows at most ${decimals} decimal${decimals === 1 ? '' : 's'}.`
  // "1,250" alone: a decimal comma or a thousands separator. It is refused, never guessed.
  if (/^[1-9]\d{0,2},\d{3}$/.test(clean)) {
    const decimal = clean.replace(',', '.').replace(/\.?0+$/, '')
    return `Unclear: write ${decimal} or ${clean.replace(',', '')}.`
  }
  return 'Enter a number, such as 0.5.'
}

export function AmountField({
  unit,
  decimals,
  text,
  onText,
  balance,
  ethIn,
  error,
  usdText,
  maxUsd,
  inputRef,
}: {
  unit: string
  decimals: number
  text: string
  onText: (text: string) => void
  /** Raw units; null while it is read or when it could not be. */
  balance: bigint | null
  ethIn: boolean
  /** Why the amount cannot be swapped, shown once typing pauses; null when there is nothing. */
  error: string | null
  /** "≈ $19.21 at snapshot prices", or null. */
  usdText: string | null
  /** The swap limit in USD (the switch's `maxUsd`). */
  maxUsd: number
  /** The field itself, for the form to move focus to it. */
  inputRef?: Ref<HTMLInputElement>
}) {
  const id = useId()
  const max = () => {
    if (balance !== null) onText(inputAmount(maxRoom(balance, ethIn), decimals))
  }
  return (
    <div className="trade-field">
      <div className="trade-field-head">
        <label className="trade-label" htmlFor={id}>
          You send ({unit})
        </label>
        <span className="trade-cap" id={`${id}-cap`}>
          {capText(maxUsd)}
        </span>
      </div>
      <div className={`trade-input${balance !== null ? ' has-max' : ''}`}>
        <input
          ref={inputRef}
          id={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.0"
          value={text}
          aria-invalid={error !== null || undefined}
          aria-describedby={`${id}-err ${id}-bal ${id}-cap`}
          onChange={(event) => onText(event.target.value)}
        />
        <span className="trade-unit" aria-hidden="true">
          {unit}
        </span>
        {balance !== null ? (
          <button type="button" className="trade-max" onClick={max}>
            Max
          </button>
        ) : null}
      </div>
      <p className="small muted trade-bal" id={`${id}-bal`}>
        Balance: {balance === null ? 'reading…' : `${balanceText(balance, decimals)} ${unit}`}
        {balance !== null && ethIn ? ' (Max keeps 0.0005 ETH for network fees)' : null}
      </p>
      {/* A div, not a paragraph: the balance stays the field's one small paragraph. */}
      <div className="small trade-field-msg">
        <span className="trade-field-err" id={`${id}-err`} role="status">
          {error}
        </span>
        {error === null ? <span className="muted">{usdText ?? NB}</span> : null}
      </div>
    </div>
  )
}

const SLIPPAGE_NOTES: Readonly<Record<number, string>> = {
  10: 'At least the quote minus 0.1 %. Tight: a small price move can stop the swap.',
  50: 'At least the quote minus 0.5 %; a bigger price move stops the swap.',
  100: 'At least the quote minus 1 %; a bigger price move stops the swap.',
  300: 'At least the quote minus 3 %. Wide: it gives bots more room to trade ahead of you.',
}

/** What a slippage tolerance of `bps` means for the reader, in a line. */
export function slippageNote(bps: number): string {
  const text =
    SLIPPAGE_NOTES[bps] ??
    `At least the quote minus ${bps / 100} %; a bigger price move stops the swap.`
  return text.replace(/ %/g, `${NB}%`)
}

/** The slippage tolerance presets (those at or below the switch's maximum) and their note. */
export function SlippageField({
  presets,
  value,
  onChange,
}: {
  presets: readonly number[]
  value: number
  onChange: (bps: number) => void
}) {
  return (
    <div className="trade-slip">
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
        value={String(value)}
        onChange={(next) => onChange(Number(next))}
      />
      {/* Polite: said once a preset is chosen, never while typing. */}
      <p className="small muted trade-slip-note" aria-live="polite">
        {slippageNote(value)}
      </p>
    </div>
  )
}
