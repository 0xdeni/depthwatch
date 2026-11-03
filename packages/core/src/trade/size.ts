/**
 * The USD size cap of a swap (docs/METRICS.md, "Swap checks"), valued at the snapshot's USD
 * prices (docs/METRICS.md, "USD prices"). The comparison with the cap is exact; the USD figure
 * shown to a person is the one `number` step.
 */

import { numberToFraction, pow10, rawToHuman } from '../math.js'

/** A raw token amount and its token's snapshot USD price (null when the snapshot has none). */
export interface UsdPricedAmount {
  amount: bigint
  decimals: number
  usdPrice: number | null
}

function isUsablePrice(price: number | null): price is number {
  return price !== null && Number.isFinite(price) && price > 0
}

function checkAmounts(amounts: readonly UsdPricedAmount[], caller: string): void {
  for (const { amount } of amounts)
    if (amount < 0n) throw new RangeError(`${caller}: negative amount: ${amount}`)
}

/**
 * USD value of a trade for display: the largest of the priced amounts' values,
 * `amount / 10^decimals × usdPrice`. Null when no amount has a usable (positive, finite) price.
 */
export function tradeSizeUsd(amounts: readonly UsdPricedAmount[]): number | null {
  checkAmounts(amounts, 'tradeSizeUsd')
  let largest: number | null = null
  for (const { amount, decimals, usdPrice } of amounts) {
    if (!isUsablePrice(usdPrice)) continue
    const value = rawToHuman(amount, decimals) * usdPrice
    if (largest === null || value > largest) largest = value
  }
  return largest
}

/**
 * Whether a trade is above `maxUsd`, compared exactly: true when any priced amount's value
 * (`amount × usdPrice / 10^decimals > maxUsd`, both prices taken at their exact double value) is
 * above the cap, false when every priced amount is at or below it, null when none is priced (the
 * size is unknown, and the caller fails closed).
 *
 * Pass both sides of the swap: the input and the quoted output. Taking the larger value means a
 * snapshot price that is stale or low on one token cannot slip a large trade under the cap. Throws
 * RangeError for a negative amount or a `maxUsd` that is not a positive finite number.
 */
export function tradeSizeAboveUsd(
  amounts: readonly UsdPricedAmount[],
  maxUsd: number,
): boolean | null {
  checkAmounts(amounts, 'tradeSizeAboveUsd')
  if (!Number.isFinite(maxUsd) || !(maxUsd > 0))
    throw new RangeError(`tradeSizeAboveUsd: invalid maxUsd ${maxUsd}`)
  const cap = numberToFraction(maxUsd)
  let priced = false
  for (const { amount, decimals, usdPrice } of amounts) {
    if (!isUsablePrice(usdPrice)) continue
    priced = true
    const price = numberToFraction(usdPrice)
    // amount × price / 10^decimals > cap, with every denominator multiplied out.
    if (amount * price.num * cap.den > cap.num * pow10(decimals) * price.den) return true
  }
  return priced ? false : null
}
