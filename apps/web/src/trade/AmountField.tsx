/**
 * The amount the reader sends: a labelled decimal field with the unit inside, the balance under
 * it with Max (which keeps 0.0005 ETH for network fees when paying with ETH), and a sentence when
 * the text is not an amount of this token or is more than the balance.
 */
import { useId } from 'react'
import { exactAmount, inputAmount } from './text.js'

/** What Max leaves in the wallet when paying with ETH: 0.0005 ETH for network fees. */
export const ETH_GAS_RESERVE = 500_000_000_000_000n

export function AmountField({
  unit,
  decimals,
  text,
  onText,
  balance,
  ethIn,
  invalid,
  overBalance,
}: {
  unit: string
  decimals: number
  text: string
  onText: (text: string) => void
  /** Raw units; null while it is read or when it could not be. */
  balance: bigint | null
  ethIn: boolean
  invalid: boolean
  overBalance: boolean
}) {
  const id = useId()
  const max = () => {
    if (balance === null) return
    const room = ethIn ? balance - ETH_GAS_RESERVE : balance
    onText(inputAmount(room > 0n ? room : 0n, decimals))
  }
  return (
    <div className="trade-field">
      <label className="trade-label" htmlFor={id}>
        You send ({unit})
      </label>
      <div className="trade-input">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.0"
          value={text}
          aria-invalid={invalid || overBalance || undefined}
          aria-describedby={`${id}-bal`}
          onChange={(event) => onText(event.target.value)}
        />
        <span className="trade-unit" aria-hidden="true">
          {unit}
        </span>
      </div>
      <p className="small muted" id={`${id}-bal`}>
        Balance: {balance === null ? 'reading…' : `${exactAmount(balance, decimals)} ${unit}`}
        {balance !== null ? (
          <>
            {' '}
            <button type="button" className="quiet-link trade-linkbtn" onClick={max}>
              Max
            </button>
            {ethIn ? ' (keeps 0.0005 ETH for network fees)' : null}
          </>
        ) : null}
      </p>
      {invalid ? (
        <p className="trade-note" role="alert">
          Enter a number with at most {decimals} decimals, such as 0.5 or 0,5. A comma followed by
          three digits is unclear: write 1.25 or 1,25 for one and a quarter, 1250 for twelve hundred
          and fifty.
        </p>
      ) : overBalance ? (
        <p className="trade-note" role="alert">
          That is more than your balance.
        </p>
      ) : null}
    </div>
  )
}
