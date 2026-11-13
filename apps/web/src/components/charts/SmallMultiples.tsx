/**
 * Time-series small multiples (CH5, docs/design/visual-v4.md §5.9.6): Pool "over time" (depth ±2 %
 * and spread at $10K) and the scorecard's series. One multiple per metric, 132 px tall (120 on
 * phones), drawn at the container's width so 12 px text stays 12 px. The head holds the label and
 * the latest (or scrubbed) value; a 3 px ink line with round joins runs through 10 px square points
 * and nothing is filled. The y range is cropped to the data and labelled: a 2 px bracket at the
 * right spans it with the maximum and the minimum at its ends. The x axis spans only the window's
 * own samples, with ticks every 15 minutes up to 2 hours, then time landmarks. Gaps are never
 * interpolated: they are dashed segments. A window with fewer than 2 samples is a sentence.
 *
 * A window switch morphs the fitted domain on the tween clock (§4.3); scrubbing (pointer or arrow
 * keys) moves a crosshair over every multiple and rewrites each head value.
 */
import { type ReactNode, useRef, useState } from 'react'
import { abs, full } from '../../lib/format.js'
import { clearOfEdges, fittedTimeTicks, linear, mix2 } from '../../lib/scale.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import {
  fittedDomain,
  Multiple,
  type MultipleSeries,
  SM_LEFT,
  SM_RIGHT,
  seriesYDomain,
} from './Multiple.js'
import { ShowData } from './ShowData.js'
import { useChartWidth } from './useChartWidth.js'
import { useMorph } from './useMorph.js'
import './charts.css'
import './series.css'

export type { MultipleSeries } from './Multiple.js'

export interface SmallMultiplesProps<T extends { timestamp: number }> {
  /** Ascending; may extend past `domain` (the 7 d series under a 24 h window). */
  points: readonly T[]
  series: readonly MultipleSeries<T>[]
  /** The window, unix seconds: the axis fits the samples inside it. */
  domain: readonly [number, number]
  /** "24 hours", "7 days": for the accessible summary. */
  windowLabel: string
  /** The latest window change came from the keyboard: no morph. */
  instant?: boolean
  /**
   * Every multiple shares one y domain, the union of theirs: for series of the same unit compared
   * by height (the market maker's spread over the whole pool's).
   */
  sharedY?: boolean
  onScrub?: (p: T | null) => void
  children?: ReactNode
}

/** The union of y domains, for multiples that share one scale. */
export function unionDomain(domains: readonly (readonly [number, number])[]): [number, number] {
  if (!domains.length) return [0, 1]
  return [Math.min(...domains.map((d) => d[0])), Math.max(...domains.map((d) => d[1]))]
}

interface View {
  dom: [number, number]
  yds: [number, number][]
}

export function SmallMultiples<T extends { timestamp: number }>({
  points,
  series,
  domain,
  windowLabel,
  instant = false,
  sharedY = false,
  onScrub,
  children,
}: SmallMultiplesProps<T>) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const W = useChartWidth(wrapRef)
  const phone = useIsPhone()
  const [scrub, setScrub] = useState(-1)
  const inWindow = points.filter(
    (p) => p.timestamp >= domain[0] - 1 && p.timestamp <= domain[1] + 1,
  )
  const fitted = fittedDomain(inWindow, domain)
  const own = series.map((s) => seriesYDomain(inWindow, s))
  const shared = sharedY ? unionDomain(own) : null
  const target: View = { dom: fitted, yds: shared ? own.map(() => shared) : own }
  const { state, morphing } = useMorph(target, {
    same: (a, b) => a.dom[0] === b.dom[0] && a.dom[1] === b.dom[1],
    mix: (a, b, e) => ({
      dom: mix2(a.dom, b.dom, e),
      yds: b.yds.map((y, i) => mix2(a.yds[i] ?? y, y, e)),
    }),
    instant,
    settleRef: wrapRef,
  })
  const plotR = W - SM_RIGHT
  const fx = linear(state.dom[0], state.dom[1], SM_LEFT, plotR)
  const latest = inWindow[inWindow.length - 1]
  const cur = scrub >= 0 && !morphing ? points[scrub] : undefined
  const inDom = (p: T) => p.timestamp >= fitted[0] - 1 && p.timestamp <= fitted[1] + 1

  const scrubTo = (i: number) => {
    setScrub(i)
    onScrub?.(i >= 0 ? (points[i] ?? null) : null)
  }
  const visibleIdx = () => points.flatMap((p, i) => (inDom(p) ? [i] : []))
  const nearest = (x: number) => {
    const t = fx.invert(x)
    let best = -1
    let bd = Number.POSITIVE_INFINITY
    points.forEach((p, i) => {
      if (!inDom(p)) return
      const d = Math.abs(p.timestamp - t)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }

  if (inWindow.length < 2) {
    return <p className="chart-note">Fewer than 2 snapshots in this window.</p>
  }
  const ticks = clearOfEdges(fittedTimeTicks(state.dom), fx, 0, W)
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable group of plots scrubbed with the arrow keys (CH2) */}
      <div
        ref={wrapRef}
        className="sms chart-focus"
        role="group"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys scrub the series (CH2)
        tabIndex={0}
        aria-label={`${series.map((s) => s.label).join(' and ')} over ${windowLabel}. Use the arrow keys to read each snapshot.`}
        onPointerMove={(e) => {
          if (morphing) return
          const r = e.currentTarget.getBoundingClientRect()
          const i = nearest(e.clientX - r.left)
          if (i >= 0 && i !== scrub) scrubTo(i)
        }}
        onPointerLeave={() => scrubTo(-1)}
        onBlur={() => scrubTo(-1)}
        onKeyDown={(e) => {
          const idx = visibleIdx()
          if (!idx.length) return
          let k = idx.indexOf(scrub)
          if (e.key === 'ArrowLeft') k = k < 0 ? idx.length - 1 : Math.max(0, k - 1)
          else if (e.key === 'ArrowRight')
            k = k < 0 ? idx.length - 1 : Math.min(idx.length - 1, k + 1)
          else if (e.key === 'Escape') return scrubTo(-1)
          else return
          e.preventDefault()
          scrubTo(idx[k] ?? -1)
        }}
      >
        {series.map((s, si) => (
          <Multiple
            key={s.key}
            s={s}
            W={W}
            H={s.height ? Math.round(phone ? (s.height * 120) / 132 : s.height) : phone ? 120 : 132}
            yd={state.yds[si] ?? [0, 1]}
            fx={fx}
            drawn={points.filter(inDom)}
            data={inWindow}
            ticks={ticks}
            cur={cur ?? null}
            latest={latest ?? null}
            windowLabel={windowLabel}
            curTime={cur && cur !== latest ? abs(cur.timestamp) : null}
          />
        ))}
        <span className="sr-only" aria-live="polite">
          {cur
            ? `${full(cur.timestamp)}: ${series.map((s) => `${s.label} ${(s.head ?? s.format)(s.value(cur))}`).join(', ')}`
            : ''}
        </span>
      </div>
      <ShowData>{children}</ShowData>
    </>
  )
}
