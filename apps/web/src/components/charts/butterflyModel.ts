/**
 * Geometry of the depth butterfly (CH4, docs/design/visual-v4.md §5.9.1), kept pure so it is
 * testable without layout. Every width is a fraction of one shared linear scale whose maximum is
 * the larger total side, so a $15K pool is a sliver next to Base itself. The total row splits
 * each side into the deepest pools as solid segments, out from the spine in row order, then one
 * hatched segment for every other pool. The bracket under it states the deepest pool's share of
 * all depth. A side is null when its token has no USD price; it draws as nothing and reads "—",
 * never as 0. A stale quote (`PoolSummary.staleQuote`, docs/METRICS.md "Stale quotes") keeps its
 * row, but its depth is measured at a price nobody trades, so it stays out of the totals, the
 * segments, the shares and the scale, as it does in the API's depth sums; so does a pool whose
 * stock's transfers are paused (unrated `transfers-paused`, "Stock tradability"), which no swap
 * can use.
 */
import type { Dex } from '@depthwatch/core'
import type { PoolSummary } from '../../api/types.js'
import { countsInDepthSums, transfersPaused } from '../../lib/depthSums.js'
import { dexLabel, feeText, NB, pairLabel, shareOf, usd } from '../../lib/format.js'
import { ticks } from '../../lib/scale.js'

/**
 * The DEX in a row label: the concentrated venues are "CL", since "Slipstream" alone no longer
 * says whose (Aerodrome's or Aero's).
 */
export const DEX_SHORT: Readonly<Record<Dex, string>> = {
  'uniswap-v3': 'Uniswap v3',
  'uniswap-v4': 'Uniswap v4',
  'aerodrome-v2': 'Aerodrome v2',
  'aerodrome-slipstream': 'Aerodrome CL',
  'aero-v2': 'Aero v2',
  'aero-slipstream': 'Aero CL',
}

export const dexShort = (dex: string): string =>
  (DEX_SHORT as Readonly<Record<string, string>>)[dex] ?? dexLabel(dex)

/** At most this many rows (CH4): the 7 deepest plus the largest gap. */
export const BUTTERFLY_ROWS = 8

/** The total row draws this many pools as solid segments; the rest share one hatched segment. */
export const TOTAL_SEGMENTS = 7

const depthOf = (p: PoolSummary) => (p.depth2DownUsd ?? 0) + (p.depth2UpUsd ?? 0)

/** Deepest first by two-sided ±2 % depth; ties keep their order. */
function byDepth(pools: readonly PoolSummary[]): PoolSummary[] {
  return [...pools].sort((a, b) => (b.depth2Usd ?? depthOf(b)) - (a.depth2Usd ?? depthOf(a)))
}

/**
 * The rows of a butterfly: the 7 deepest pools by ±2 % depth, plus the gap pool when it is not
 * among them (ia-v3 §4.1), deepest first.
 */
export function pickButterflyRows(
  pools: readonly PoolSummary[],
  gapPoolId?: string | null,
): PoolSummary[] {
  const rows = byDepth(pools).slice(0, BUTTERFLY_ROWS - 1)
  if (gapPoolId && !rows.some((p) => p.pool.id === gapPoolId)) {
    const gap = pools.find((p) => p.pool.id === gapPoolId)
    if (gap) rows.push(gap)
  }
  return rows
}

export interface ButterflyRow {
  id: string
  pair: string
  dex: string
  /** "Uniswap v3 0.3 %": the row's second line and the readout's pool name. */
  venue: string
  /** USD per side within 2 %; null when that side is unpriced. */
  sell: number | null
  buy: number | null
  /** Fractions of the shared scale. */
  sellW: number
  buyW: number
  /** This pool's share of the scope's two-sided depth; null when left out of it (stale, paused). */
  share: number | null
  /** The pool quotes a stale price: drawn, but outside every total. */
  stale: boolean
  /** The pool's stock has its transfers paused: drawn, but outside every total. */
  paused: boolean
  /** `PoolSummary.priceDeviationBps`, which says how far off a stale quote is. */
  deviationBps: number | null
}

/** One segment of a total side: offset from the spine and width, as scale fractions. */
export interface Segment {
  /** The pool's id; null for the hatched segment of every other pool. */
  id: string | null
  o: number
  w: number
}

export interface ButterflyModel {
  rows: ButterflyRow[]
  total: { sell: number; buy: number }
  /** The shared scale's maximum: the larger total side. 0 when nothing is priced. */
  max: number
  /** Nice ticks on each side, mirrored around the spine (the spine itself is "0"). */
  ticks: number[]
  /** The deepest pools, spine outward, then the hatched rest when any pool is left. */
  segments: { sell: Segment[]; buy: Segment[] }
  /** The pools in the hatched segment: how many, and what they hold per side. */
  rest: { count: number; sell: number; buy: number }
  /** The deepest pool's share of all depth, stated under the total row. */
  bracket: {
    id: string
    pair: string
    dex: string
    venue: string
    share: number
    sellW: number
    buyW: number
  } | null
  /** The pools the totals cover: every pool in scope but the stale quotes and the paused ones. */
  poolCount: number
}

const sum = (xs: readonly (number | null)[]) => xs.reduce<number>((s, v) => s + (v ?? 0), 0)

/** "Uniswap v3 0.3 %", "Aero CL 0.0465 % dynamic" */
export function venueOf(p: PoolSummary): string {
  return `${dexShort(p.pool.dex)}${NB}${feeText(p.pool)}`
}

export function butterflyModel(
  rows: readonly PoolSummary[],
  all: readonly PoolSummary[],
): ButterflyModel {
  const counted = all.filter(countsInDepthSums)
  const total = {
    sell: sum(counted.map((p) => p.depth2DownUsd)),
    buy: sum(counted.map((p) => p.depth2UpUsd)),
  }
  const max = Math.max(total.sell, total.buy)
  // A row left out can hold more than every counted pool together: it stops at the scale's end.
  const frac = (v: number | null) => (max > 0 && v !== null ? Math.min(1, Math.max(0, v) / max) : 0)
  const both = total.sell + total.buy
  const shareOfAll = (p: PoolSummary) => (both > 0 ? depthOf(p) / both : 0)

  const deep = byDepth(counted)
    .filter((p) => depthOf(p) > 0)
    .slice(0, TOTAL_SEGMENTS)
  const deepIds = new Set(deep.map((p) => p.pool.id))
  const others = counted.filter((p) => !deepIds.has(p.pool.id))
  const rest = {
    count: others.length,
    sell: sum(others.map((p) => p.depth2DownUsd)),
    buy: sum(others.map((p) => p.depth2UpUsd)),
  }
  const side = (key: 'depth2DownUsd' | 'depth2UpUsd', restUsd: number): Segment[] => {
    let o = 0
    const out: Segment[] = deep.map((p) => {
      const s = { id: p.pool.id, o, w: frac(p[key]) }
      o += s.w
      return s
    })
    if (others.length) out.push({ id: null, o, w: frac(restUsd) })
    return out
  }
  const top = deep[0]
  return {
    rows: rows.map((p) => ({
      id: p.pool.id,
      pair: pairLabel(p.pool.token0, p.pool.token1),
      dex: dexLabel(p.pool.dex),
      venue: venueOf(p),
      sell: p.depth2DownUsd,
      buy: p.depth2UpUsd,
      sellW: frac(p.depth2DownUsd),
      buyW: frac(p.depth2UpUsd),
      share: countsInDepthSums(p) ? shareOfAll(p) : null,
      stale: p.staleQuote,
      paused: transfersPaused(p),
      deviationBps: p.priceDeviationBps,
    })),
    total,
    max,
    ticks: max > 0 ? ticks(0, max, 3).filter((v) => v > 0 && v <= max) : [],
    segments: { sell: side('depth2DownUsd', rest.sell), buy: side('depth2UpUsd', rest.buy) },
    rest,
    bracket:
      top && counted.length > 1
        ? {
            id: top.pool.id,
            pair: pairLabel(top.pool.token0, top.pool.token1),
            dex: dexLabel(top.pool.dex),
            venue: `${dexLabel(top.pool.dex)} ${feeText(top.pool)}`,
            share: shareOfAll(top),
            sellW: frac(top.depth2DownUsd),
            buyW: frac(top.depth2UpUsd),
          }
        : null,
    poolCount: counted.length,
  }
}

/** "59 % of it sits in one pool: WETH / USDC, Uniswap v3 0.3 %" */
export function bracketText(b: NonNullable<ButterflyModel['bracket']>): string {
  return `${shareOf(b.share)} of it sits in one pool: ${b.pair}, ${b.venue}`
}

/** A tick label's width: 12 px tabular figures run about 7 px a glyph ("$10M" ≈ 28 px). */
const tickWidth = (text: string) => text.length * 7

/**
 * The axis ticks a side can show on a `trackPx`-wide track: the outermost nice tick first, then
 * each inner one only when its label stays `gap` px clear of the one kept before it and of the
 * spine's "0" (the other side mirrors it).
 */
export function axisTicks(
  values: readonly number[],
  max: number,
  trackPx: number,
  label: (v: number) => string,
  gap = 12,
): number[] {
  if (!(max > 0) || !(trackPx > 0)) return []
  const at = (v: number) => (v / max) * trackPx
  const zero = tickWidth('0') / 2
  const kept: number[] = []
  for (const v of [...values].sort((a, b) => b - a)) {
    const w = tickWidth(label(v)) / 2
    if (at(v) - w < zero + gap) continue
    const prev = kept[kept.length - 1]
    if (prev !== undefined && at(prev) - at(v) - tickWidth(label(prev)) / 2 - w < gap) continue
    kept.push(v)
  }
  return kept.reverse()
}

/** The figure's accessible summary: the scope's totals, the concentration, then every row. */
export function butterflyLabel(model: ButterflyModel, scope: string): string {
  const head = `${scope}: ${usd(model.total.sell)} on the sell side and ${usd(model.total.buy)} on the buy side within 2${NB}% of the price.`
  const conc = model.bracket ? ` ${bracketText(model.bracket)}.` : ''
  if (!model.rows.length) return head + conc
  const pools = model.rows
    .map((r) => `${r.pair}, ${r.venue}: ${usd(r.sell)} sell side, ${usd(r.buy)} buy side`)
    .join('; ')
  return `${head}${conc} By pool: ${pools}.`
}

/**
 * "5 % of Base", or for a pool left out "left out of Base’s total: stale price" (or "transfers
 * paused", which a paused pool's stale quote does not hide).
 */
export function shareWords(row: ButterflyRow, scope: string): string {
  if (row.share !== null) return `${shareOf(row.share)} of ${scope}`
  return `left out of ${scope}’s total: ${row.paused ? 'transfers paused' : 'stale price'}`
}

/** A row link's accessible name: both sides and the share of the scope. */
export function rowLinkLabel(row: ButterflyRow, scope: string): string {
  return `${row.pair}, ${row.venue}: ${usd(row.sell)} on the sell side and ${usd(row.buy)} on the buy side within 2${NB}%, ${shareWords(row, scope)}`
}

/** The readout line while a row is lensed: "WETH / cbBTC, Uniswap v3 0.3 %: 5 % of Base". */
export function readoutText(row: ButterflyRow, scope: string): { who: string; share: string } {
  return { who: `${row.pair}, ${row.venue}`, share: shareWords(row, scope) }
}
