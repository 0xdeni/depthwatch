/**
 * Pure helpers of the scorecard pages (docs/design/scorecards.md §7, docs/design/visual-v3.md §7):
 * KPI marks, the embed snippets, list keys, the list order of `GET /api/mm`, breach episodes and
 * the per-day summary of the 7 d and 30 d "Show data".
 */
import type { BreachKind } from '@depthwatch/core'
import type { MmSampleDto, SampleWindow, ScorecardSummaryDto } from '../api/types.js'

/** Hours covered by each sample window, matching the API (`24h` = 24, `7d` = 168, `30d` = 720). */
export const SAMPLE_WINDOW_HOURS: Readonly<Record<SampleWindow, number>> = {
  '24h': 24,
  '7d': 168,
  '30d': 720,
}

/** Route of a scorecard page. Ids are slugs, but encoding keeps any stray id a single segment. */
export function mmHref(id: string): string {
  return `/mm/${encodeURIComponent(id)}`
}

/** Absolute URL of the badge, as embedders fetch it (the API serves the dashboard's origin). */
export function badgeUrl(origin: string, id: string): string {
  return `${origin.replace(/\/$/, '')}/api/mm/${encodeURIComponent(id)}/badge.svg`
}

/** Absolute URL of the scorecard page. */
export function scorecardUrl(origin: string, id: string): string {
  return `${origin.replace(/\/$/, '')}${mmHref(id)}`
}

function escapeAttr(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/** The `<img>` tag to paste into a page: badge linked to the scorecard. */
export function badgeImgSnippet(origin: string, id: string, name: string): string {
  const alt = escapeAttr(`Depthwatch scorecard: ${name}`)
  return `<a href="${scorecardUrl(origin, id)}"><img src="${badgeUrl(origin, id)}" alt="${alt}"></a>`
}

/** The Markdown equivalent for READMEs. */
export function badgeMarkdownSnippet(origin: string, id: string, name: string): string {
  const alt = `Depthwatch scorecard: ${name}`.replaceAll(']', '\\]')
  return `[![${alt}](${badgeUrl(origin, id)})](${scorecardUrl(origin, id)})`
}

export type KpiMark = 'pass' | 'fail' | 'n/a'

/** A KPI the latest sample is judged on (the uptime target is informational and never is). */
export type SampleKpi = 'depthUp' | 'depthDown' | 'spread'

/**
 * Pass / fail of one KPI in a sample, read from the evaluation core stored with it (`withinKpi`,
 * `breaches`: `evaluateKpis` against the KPIs in force when the sample was taken), so a mark can
 * never contradict the status, which reads the same evaluation. `n/a` without a sample or when
 * the sample was not evaluable (rule 2: a USD price was missing); a `noLiquidity` breach fails
 * every KPI. Re-deriving the mark from the attribution against the current KPIs would disagree
 * with the status after a re-registration, and with rule 1 when a side is unpriced.
 */
export function sampleMark(
  sample: Pick<MmSampleDto, 'withinKpi' | 'breaches'> | null | undefined,
  kpi: SampleKpi,
): KpiMark {
  if (!sample || sample.withinKpi === null) return 'n/a'
  if (sample.breaches.includes(kpi) || sample.breaches.includes('noLiquidity')) return 'fail'
  return 'pass'
}

/**
 * Unique React keys for a list of samples: `block:timestamp`, with an occurrence suffix (`:1`,
 * `:2`, …) for samples that share both. A wire sample has no id, and a mandate can hold several
 * samples with one timestamp (a `mm sample` and a `snapshot` in the same block, or, since Denim's
 * 200 ms blocks, in different blocks of one second: about five blocks share each whole-second
 * timestamp; storage orders such ties by id), so the timestamp alone is not a key.
 */
export function sampleKeys(
  samples: readonly Pick<MmSampleDto, 'blockNumber' | 'timestamp'>[],
): string[] {
  const seen = new Map<string, number>()
  return samples.map((sample) => {
    const base = `${sample.blockNumber}:${sample.timestamp}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}:${n}`
  })
}

/** `${dex}:${key}` → its parts; ids without a colon keep the whole id as key and no dex. */
export function splitPoolId(poolId: string): { dex: string | null; key: string } {
  const at = poolId.indexOf(':')
  if (at < 0) return { dex: null, key: poolId }
  return { dex: poolId.slice(0, at), key: poolId.slice(at + 1) }
}

function compareText(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la !== lb) return la < lb ? -1 : 1
  return a === b ? 0 : a < b ? -1 : 1
}

/** List order of `GET /api/mm`: active mandates first, then by name, then by id. */
export function compareScorecards(
  a: Pick<ScorecardSummaryDto, 'mandate'>,
  b: Pick<ScorecardSummaryDto, 'mandate'>,
): number {
  if (a.mandate.active !== b.mandate.active) return a.mandate.active ? -1 : 1
  return compareText(a.mandate.name, b.mandate.name) || compareText(a.mandate.id, b.mandate.id)
}

/**
 * One breach episode (ia-v3 §4.6, §6.2): consecutive breached samples collapsed into one row.
 * `end` is the last breached sample, so the duration is `end − start` (8 samples two hours apart
 * last 14 h, matching the answer's "since 14 h ago"). The lowest depth per side is null when that
 * side was unpriced in every sample of the episode.
 */
export interface BreachEpisode {
  start: number
  end: number
  /** Breached samples in the episode. */
  samples: number
  /** Every kind breached at least once, in `BreachKind` order. */
  kinds: BreachKind[]
  minUpUsd: number | null
  minDownUsd: number | null
  /** The newest evaluable sample is still breached. */
  ongoing: boolean
}

const KIND_ORDER: readonly BreachKind[] = ['depthUp', 'depthDown', 'spread', 'noLiquidity']

function minOrNull(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

/**
 * Breach episodes of a sample series, oldest first. As in core's streak, an unevaluable sample
 * (`withinKpi === null`, a USD price was missing) neither breaches nor interrupts an episode.
 */
export function breachEpisodes(
  points: readonly Pick<MmSampleDto, 'timestamp' | 'withinKpi' | 'breaches' | 'attribution'>[],
): BreachEpisode[] {
  type Open = BreachEpisode & { set: Set<BreachKind> }
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp)
  const out: Open[] = []
  let cur: Open | null = null
  for (const p of sorted) {
    if (p.withinKpi === null) continue
    if (p.withinKpi) {
      if (cur) out.push(cur)
      cur = null
      continue
    }
    if (!cur) {
      cur = {
        start: p.timestamp,
        end: p.timestamp,
        samples: 0,
        kinds: [],
        set: new Set(),
        minUpUsd: null,
        minDownUsd: null,
        ongoing: false,
      }
    }
    cur.end = p.timestamp
    cur.samples++
    for (const k of p.breaches) cur.set.add(k)
    cur.minUpUsd = minOrNull(cur.minUpUsd, p.attribution.depthUpUsd)
    cur.minDownUsd = minOrNull(cur.minDownUsd, p.attribution.depthDownUsd)
  }
  if (cur) {
    cur.ongoing = true
    out.push(cur)
  }
  return out.map(({ set, ...ep }) => ({ ...ep, kinds: KIND_ORDER.filter((k) => set.has(k)) }))
}

/** An episode's length in hours: `end − start`. */
export function episodeHours(ep: Pick<BreachEpisode, 'start' | 'end'>): number {
  return (ep.end - ep.start) / 3600
}

/** What an episode or sample breached, in words: "both sides", "sell side and spread", … */
export function breachSides(kinds: readonly string[]): string {
  if (kinds.includes('noLiquidity')) return 'no liquidity'
  const up = kinds.includes('depthUp')
  const down = kinds.includes('depthDown')
  const parts: string[] = []
  if (up && down) parts.push('both sides')
  else if (up) parts.push('buy side')
  else if (down) parts.push('sell side')
  if (kinds.includes('spread')) parts.push('spread')
  return parts.join(' and ') || 'no breach'
}

/** The median spacing of a series in seconds (the sampling interval); null under two samples. */
export function sampleInterval(points: readonly { timestamp: number }[]): number | null {
  const ts = points.map((p) => p.timestamp).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < ts.length; i++) {
    const gap = (ts[i] ?? 0) - (ts[i - 1] ?? 0)
    if (gap > 0) gaps.push(gap)
  }
  if (!gaps.length) return null
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? (gaps[mid] ?? null) : ((gaps[mid - 1] ?? 0) + (gaps[mid] ?? 0)) / 2
}

/** One UTC day of samples, for the 7 d and 30 d "Show data" (ia-v3 §4.6). */
export interface SampleDay {
  /** Unix seconds of the day's 00:00 UTC. */
  day: number
  samples: number
  /** Evaluable samples (`withinKpi !== null`), the denominator of "3 of 12". */
  evaluable: number
  withinKpi: number
  minUpUsd: number | null
  minDownUsd: number | null
}

/** Samples grouped by UTC day, newest day first. */
export function dailySummary(
  points: readonly Pick<MmSampleDto, 'timestamp' | 'withinKpi' | 'attribution'>[],
): SampleDay[] {
  const days = new Map<number, SampleDay>()
  for (const p of points) {
    const key = Math.floor(p.timestamp / 86_400) * 86_400
    const row = days.get(key) ?? {
      day: key,
      samples: 0,
      evaluable: 0,
      withinKpi: 0,
      minUpUsd: null,
      minDownUsd: null,
    }
    row.samples++
    if (p.withinKpi !== null) row.evaluable++
    if (p.withinKpi) row.withinKpi++
    row.minUpUsd = minOrNull(row.minUpUsd, p.attribution.depthUpUsd)
    row.minDownUsd = minOrNull(row.minDownUsd, p.attribution.depthDownUsd)
    days.set(key, row)
  }
  return [...days.values()].sort((a, b) => b.day - a.day)
}
