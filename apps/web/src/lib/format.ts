/**
 * Human-facing formatting for v3 (principles N1–N11 as amended, docs/design/visual-v3.md §2
 * and §7). The web formats and draws only; metrics come from `@depthwatch/core`.
 * Units are glued with a no-break space (U+00A0), minus is U+2212, unknown is "—" (D6).
 */
import { DEXES, type Dex, type HealthGrade, hasDynamicFee, type TokenInfo } from '@depthwatch/core'
import { groupDigits, rawToDecimal } from './raw.js'
import { type NamedToken, unitText } from './tokenNames.js'

export { type RoundTripCost, roundTripCost } from './roundTripCost.js'
export { type NamedToken, pairLabel, tokenText, unitText } from './tokenNames.js'

/** No-break space: between a number and its unit or % (N7). */
export const NB = ' '
/** The true minus sign (N7). */
export const MINUS = '−'
/** The multiplication sign of ratios (N5). */
export const TIMES = '×'
/** Unknown, never 0 (D6). */
export const DASH = '—'

type Num = number | null | undefined

function isNum(v: Num): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function signed(v: number, body: string): string {
  return v < 0 ? `${MINUS}${body}` : body
}

const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  minimumSignificantDigits: 3,
  maximumSignificantDigits: 3,
})
const usdTickFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumSignificantDigits: 2,
})
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/**
 * Money (N1): 3 significant figures with trailing zeros kept ($5.10M beside $6.08M, $7.40K), a
 * bare ".0" dropped before the suffix ($50K, $1M), whole dollars from $1 to $1,000 ($412). Under a
 * dollar it keeps the cents ($0.42), and under half a cent a non-zero value reads "<$0.01": a
 * non-zero amount is never "$0" and never "$0.00".
 */
export function usd(v: Num): string {
  if (!isNum(v)) return DASH
  const a = Math.abs(v)
  if (a === 0) return '$0'
  if (a < 0.005) return signed(v, '<$0.01')
  if (a < 0.995) return signed(v, `$${a.toFixed(2)}`)
  if (Math.round(a) < 1000) return signed(v, `$${whole.format(Math.round(a))}`)
  return signed(v, usdCompact.format(a).replace(/\.0+([KMBT])$/, '$1'))
}

/** Chart ticks keep 2 significant figures; zero is a bare "0" (never "$0.00"). */
export function usdTick(v: Num): string {
  if (!isNum(v)) return DASH
  if (v === 0) return '0'
  return signed(v, usdTickFmt.format(Math.abs(v)))
}

/**
 * From this many basis points a round trip is not a cost a trader can pay (a feasible spread is at
 * most 10,000, docs/METRICS.md): it is not printed as a number. Spreads stored before that rule
 * can be 1e24.
 */
export const SPREAD_UNABSORBED_BPS = 10_000

/**
 * Basis points (N3): 1 decimal below 100, an integer from 100 to 9,999 (never more than 4
 * significant digits): "10.4 bps", "187 bps". From 10,000 it is not a number but "—": where a
 * spread is shown, `spreadText` words it.
 */
export function bps(v: Num): string {
  if (!isNum(v)) return DASH
  const a = Math.abs(v)
  if (Math.round(a) >= SPREAD_UNABSORBED_BPS) return DASH
  const text = a.toFixed(1)
  const body = Number(text) < 100 ? text : whole.format(Math.round(a))
  return signed(v, `${body}${NB}bps`)
}

/** What a pool shows where a spread at `notionalUsd` would be when it cannot absorb the trade. */
export function cantAbsorb(notionalUsd: number): string {
  return `Can’t absorb ${usd(notionalUsd)}`
}

/**
 * A spread at a notional: basis points, or "Can’t absorb $10K" from 10,000 bps (stored before the
 * price impact cap) and for a spread that is null because the round trip did not fill.
 */
export function spreadText(v: Num, notionalUsd: number): string {
  if (!isNum(v) || Math.round(Math.abs(v)) >= SPREAD_UNABSORBED_BPS) return cantAbsorb(notionalUsd)
  return bps(v)
}

/** LP and band shares (N4): integers, "53 %". */
export function share(v: Num): string {
  if (!isNum(v)) return DASH
  return `${Math.round(v * 100)}${NB}%`
}

/** A share of a whole (N4): above 0 and below 1 % reads "under 1 %", never "0 %". */
export function shareOf(v: Num): string {
  if (!isNum(v)) return DASH
  if (v > 0 && v < 0.01) return `under 1${NB}%`
  return share(v)
}

/** Uptime and stability (N4): 1 decimal, a whole value drops ".0": "96.4 %", "100 %". */
export function uptime(v: Num): string {
  if (!isNum(v)) return DASH
  return `${(v * 100).toFixed(1).replace(/\.0$/, '')}${NB}%`
}

/** Ratios (N5): "1.6×" below 10, "51×" from 10. */
export function ratio(r: Num): string {
  if (!isNum(r)) return DASH
  const text = r.toFixed(1)
  return `${Number(text) < 10 ? text : String(Math.round(r))}${TIMES}`
}

/** Health and gap scores (N6): truncated, so the number never contradicts its letter. */
export function score(v: Num): string {
  if (!isNum(v)) return DASH
  return String(Math.floor(v))
}

/** The 1-decimal score, for the score Details and tooltips only (N6). */
export function scoreExact(v: Num): string {
  if (!isNum(v)) return DASH
  return v.toFixed(1)
}

/**
 * A positive number under 1 at 4 significant digits as a plain decimal, never in exponent
 * notation: 3.87e-6 → "0.00000387". `toFixed` writes up to 100 places; below that (no pool price
 * is) it reads "<0.00…01".
 */
function smallDecimal(r: number): string {
  const places = 3 - Math.floor(Math.log10(r))
  if (places > 100) return `<0.${'0'.repeat(99)}1`
  return r.toFixed(places).replace(/0+$/, '')
}

/**
 * Prices (N2): 2 decimals with grouping from 1 ("2,460.32"), else 4 significant digits written
 * out in full, never in exponent notation ("0.00000387"). A value that rounds up to 1 at 4
 * significant digits (0.99996) is a price of 1 and reads "1.00".
 */
export function price(v: Num): string {
  if (!isNum(v)) return DASH
  if (v === 0) return '0'
  const a = Math.abs(v)
  const r = a >= 1 ? a : Number(a.toPrecision(4))
  if (r >= 1)
    return signed(
      v,
      r.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    )
  return signed(v, smallDecimal(r))
}

/** Group the integer part of a plain decimal string: "31510" → "31,510", "812.0" stays. */
function groupDecimal(text: string): string {
  const [int = '', frac] = text.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

/**
 * A raw token amount (decimal string in the smallest unit) at 4 significant figures (N11), with
 * trailing zeros kept so a column keeps its precision (N8): "0.4065", "812.3", "31,510",
 * "6.080M", "14.34M". BigInt down to the human edge; invalid → "—".
 */
export function amount(raw: string | null | undefined, decimals: number): string {
  if (raw === null || raw === undefined) return DASH
  const text = rawToDecimal(raw, decimals, 12)
  if (text === null) return DASH
  const v = Number(text)
  const a = Math.abs(v)
  const sign = v < 0 ? MINUS : ''
  if (a === 0) return '0'
  // The unit is picked after rounding, so 999,950 reads "1.000M", not "1,000,000".
  const at = (unit: number) => (a / unit).toPrecision(4)
  if (Number(at(1e6)) >= 1000) return `${sign}${at(1e9)}B`
  if (Number(a.toPrecision(4)) >= 1e6) return `${sign}${at(1e6)}M`
  const plain = a.toPrecision(4)
  // toPrecision switches to exponent notation for whole numbers of 5 or more digits.
  const body = plain.includes('e') ? whole.format(Number(plain)) : groupDecimal(plain)
  return `${sign}${body}`
}

/**
 * `amount` plus the token as its unit: "1,250 USDC". With the pool's `other` token, the unit is
 * `unitText`, so an amount in an AERO/AERO pool says which AERO.
 */
export function tokenAmount(
  raw: string | null | undefined,
  token: TokenInfo & NamedToken,
  other?: NamedToken,
): string {
  const text = amount(raw, token.decimals)
  return text === DASH ? DASH : `${text}${NB}${other ? unitText(token, other) : token.symbol}`
}

/** Fee in pips (1e-6): "0.05 %", "0.3 %", "1 %". */
export function fee(feePips: number): string {
  const text = (feePips / 10_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return `${text}${NB}%`
}

/**
 * A pool's fee where it names the pool: "0.3 %", or "0.0465 % dynamic" for a DEX whose fee can
 * change every block (core `hasDynamicFee`: both Slipstreams). The fee is the one passed in: the
 * latest snapshot's (the reading at discovery for a pool never snapshotted), or the swap panel's
 * live reading at its quote's block.
 */
export function feeText(pool: { dex: string; feePips: number }): string {
  return `${fee(pool.feePips)}${hasDynamicFee(pool) ? ' dynamic' : ''}`
}

/** A count with grouping: "1,284". */
export function count(v: Num): string {
  if (!isNum(v)) return DASH
  return whole.format(v)
}

/** A block number (a decimal string on the wire) grouped through BigInt: "52,950,000". */
export function group(block: string | number | bigint | null | undefined): string {
  if (block === null || block === undefined) return DASH
  const text = String(block)
  if (!/^\d+$/.test(text)) return DASH
  return groupDigits(BigInt(text).toString())
}

/** v2 name of `group`, still used by the v2 screens. */
export const formatBlock = group

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad2 = (n: number) => String(n).padStart(2, '0')

/** "21 Oct" (UTC). */
export function day(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getUTCDate()}${NB}${MONTHS[d.getUTCMonth()]}`
}

/** "04:00" (UTC), for time ticks under a "Times in UTC" caption. */
export function clockTime(ts: number): string {
  const d = new Date(ts * 1000)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

/** "Mon" (UTC), for weekday ticks. */
export function weekday(ts: number): string {
  return WEEKDAYS[new Date(ts * 1000).getUTCDay()] ?? ''
}

/** "21 Oct, 04:00" (UTC; the caller says so once, e.g. a "Times in UTC" caption). */
export function abs(ts: Num): string {
  if (!isNum(ts)) return DASH
  return `${day(ts)}, ${clockTime(ts)}`
}

/** "21 Oct, 04:00 UTC": every absolute time a reader sees on its own (N10). */
export function full(ts: Num): string {
  if (!isNum(ts)) return DASH
  return `${abs(ts)}${NB}UTC`
}

/** "2026" (UTC). */
export function year(ts: number): string {
  return String(new Date(ts * 1000).getUTCFullYear())
}

/** "25 Oct 2026, 14:02 UTC": a time with its year, for a published snapshot that may be read later. */
export function dated(ts: Num): string {
  if (!isNum(ts)) return DASH
  return `${day(ts)}${NB}${year(ts)}, ${clockTime(ts)}${NB}UTC`
}

/**
 * The data clock of a published live snapshot (a static build of a `live` bundle). How long ago
 * the reader opened the page after the data was read is unknown, so `ago` and `when` give every
 * time as its absolute UTC time on this clock, never "… ago".
 */
export const SNAPSHOT_CLOCK = Number.POSITIVE_INFINITY

/**
 * "2 min ago", "3 h ago" under 24 h, else the full UTC time (N10). `now` is the data clock;
 * `SNAPSHOT_CLOCK` always gives the full UTC time.
 */
export function ago(ts: Num, now: number = Date.now() / 1000): string {
  if (!isNum(ts)) return DASH
  if (now === SNAPSHOT_CLOCK) return full(ts)
  const s = Math.max(0, now - ts)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}${NB}min ago`
  if (s < 86_400) return `${Math.round(s / 3600)}${NB}h ago`
  return full(ts)
}

/** Relative under 24 h, absolute with UTC after (N10). */
export function when(ts: Num, now: number = Date.now() / 1000): string {
  return ago(ts, now)
}

/** A duration in hours: "14 h" under 48 h, else days: "3 d". */
export function hours(h: Num): string {
  if (!isNum(h)) return DASH
  return h < 48 ? `${Math.round(h)}${NB}h` : `${Math.round(h / 24)}${NB}d`
}

/** A signed move: "+2 %", "−5 %", "0 %" (N9). */
export function pct(p: Num): string {
  if (!isNum(p)) return DASH
  const sign = p > 0 ? '+' : p < 0 ? MINUS : ''
  return `${sign}${Math.abs(p)}${NB}%`
}

export const DEX_LABEL: Readonly<Record<Dex, string>> = {
  'uniswap-v3': 'Uniswap v3',
  'uniswap-v4': 'Uniswap v4',
  'aerodrome-v2': 'Aerodrome v2',
  'aerodrome-slipstream': 'Aerodrome Slipstream',
  'aero-v2': 'Aero v2',
  'aero-slipstream': 'Aero Slipstream',
}

export function dexLabel(dex: string): string {
  return (DEX_LABEL as Record<string, string>)[dex] ?? dex
}

/**
 * The pool cell's secondary line: "Aerodrome Slipstream, 0.05 %" (", stable pair"), then the
 * `tieBreak` that tells it from a pool with the same pair, DEX and fee in the same list
 * (`poolTieBreaks`): "…, 0.05 %, tick spacing 50".
 */
export function poolDesc(
  pool: { dex: string; feePips: number; stable?: boolean },
  tieBreak?: string,
): string {
  const desc = `${dexLabel(pool.dex)}, ${feeText(pool)}${pool.stable ? ', stable pair' : ''}`
  return tieBreak ? `${desc}, ${tieBreak}` : desc
}

/** Grade bands (C4): A–B ok (circle), C warn (square), D–F bad (triangle). */
export type Tone = 'ok' | 'warn' | 'bad'
export function gradeTone(grade: HealthGrade): Tone {
  if (grade === 'A' || grade === 'B') return 'ok'
  return grade === 'C' ? 'warn' : 'bad'
}

/** 0x1234…abcd */
export function shortAddress(address: string | null | undefined, chars = 4): string {
  if (!address) return DASH
  if (address.length <= 2 + chars * 2) return address
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`
}

/**
 * True for `${dex}:${address|poolId}` ids. A token's `via` route also carries non-pool sources
 * such as the native ETH ↔ WETH edge `wrap:weth`, which have no pool page to link to.
 */
export function isPoolId(id: string): boolean {
  return DEXES.some((dex) => id.startsWith(`${dex}:`))
}

/** Pool ids contain ":" so they are always encoded in links and decoded in the page. */
export function poolHref(id: string): string {
  return `/pools/${encodeURIComponent(id)}`
}

export function tokenHref(address: string): string {
  return `/tokens/${address.toLowerCase()}`
}
