/**
 * A round trip's cost for readers who do not think in bps (N3), re-exported by `format.ts`:
 * percent and dollars first, bps second ("$10K round trip: 0.18 %, about $18 (17.8 bps)"). The
 * bps and the dollars are `bps`'s and `usd`'s, so every surface that words a cost agrees.
 */
import { bps, DASH, MINUS, NB, usd } from './format.js'

const percentFmt = new Intl.NumberFormat('en-US', {
  minimumSignificantDigits: 2,
  maximumSignificantDigits: 2,
})
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** A round trip's cost, each part formatted on its own (a chart or a table lays them out apart). */
export interface RoundTripCost {
  percent: string
  dollars: string
  bps: string
  /** "0.18 %, about $18 (17.8 bps)". */
  text: string
}

/**
 * The percent keeps 2 significant figures and a trailing zero below 10 % ("0.10 %", "0.024 %"),
 * is whole from there, and never reads "100 %" below 10,000 bps (99.5 % and up is cut to one
 * decimal). The dollars are the notional times the spread, a unit change of the stored value,
 * hence "about". Null where `bps` prints no number.
 */
export function roundTripCost(
  spreadBps: number | null | undefined,
  notionalUsd: number,
): RoundTripCost | null {
  const inBps = bps(spreadBps)
  if (typeof spreadBps !== 'number' || inBps === DASH) return null
  const a = Math.abs(spreadBps) / 100
  let body = whole.format(Math.round(a))
  if (a === 0) body = '0'
  else if (a < 10) body = percentFmt.format(a)
  else if (a >= 99.5) body = (Math.floor(a * 10) / 10).toFixed(1)
  const percent = `${spreadBps < 0 ? MINUS : ''}${body}${NB}%`
  const dollars = usd((notionalUsd * spreadBps) / 10_000)
  return { percent, dollars, bps: inBps, text: `${percent}, about ${dollars} (${inBps})` }
}
