/**
 * One small multiple (docs/design/visual-v4.md §5.9.6): the head (label and value), the line
 * through square points, the labelled range bracket at the right, an optional reference line and
 * band, and the multiple's own time axis. Laid out by `SmallMultiples`, which owns the x scale,
 * the morph and the scrub.
 */
import type { TimeTick } from '../../lib/scale.js'
import { linear, median, pathD } from '../../lib/scale.js'
import { seriesRuns } from './seriesRuns.js'

export interface MultipleSeries<T> {
  key: string
  label: string
  /** Desktop height in px; 132 by default (120 on phones). */
  height?: number
  value: (p: T) => number | null
  /** The head value and the bracket's ends: "$812K", "14.8 bps". */
  format: (v: number | null) => string
  /**
   * The head value, and the latest one in the summary, when it reads longer than the bracket's
   * ends can ("0.18 % (17.8 bps)" over ends in bps); `format` when not given.
   */
  head?: (v: number | null) => string
  /**
   * A shorter label for the bracket's ends ("10.4" beside "10.3"); `format` when not given, or
   * when the two ends would print the same.
   */
  tick?: (v: number) => string
  /** A band (the p10–median of the window) shaded behind the line. */
  band?: readonly [number, number] | null
  bandLabel?: string
  /** Never crop the y axis to less than this × the window median. */
  minSpan?: number
  /** A reference level such as a KPI: a dashed line, labelled at its left, always in the plot. */
  reference?: { value: number; label: string } | null
}

/** Plot insets: 8 px at left; 76 px at right for the range bracket and its labels. */
export const SM_LEFT = 8
export const SM_RIGHT = 76

/** The x domain fitted to the samples: their first and last time, or the window when fewer. */
export function fittedDomain(
  points: readonly { timestamp: number }[],
  fallback: readonly [number, number],
): [number, number] {
  const first = points[0]?.timestamp
  const last = points[points.length - 1]?.timestamp
  return first !== undefined && last !== undefined && last > first
    ? [first, last]
    : [fallback[0], fallback[1]]
}

/** The data's own range in the window: what the bracket spans. Null with no values. */
export function dataRange<T>(
  points: readonly T[],
  value: (p: T) => number | null,
): [number, number] | null {
  const vals = points.map(value).filter((v): v is number => v !== null && Number.isFinite(v))
  if (!vals.length) return null
  return [Math.min(...vals), Math.max(...vals)]
}

/** The least span of a level series' y domain, as a share of its median: ±1 %. */
export const FLAT_SPAN = 0.02

/** The bracket's end labels: `tick` when it tells the two ends apart, otherwise `format`. */
export function bracketLabel<T>(
  s: MultipleSeries<T>,
  range: readonly [number, number],
): (v: number) => string {
  const t = s.tick
  return t && t(range[0]) !== t(range[1]) ? t : (v: number) => s.format(v)
}

/**
 * True when the data's two ends print the same: the series moves by less than its display
 * precision, and the chart draws it level with one label instead of a swing between equal numbers.
 */
export function printsLevel<T>(s: MultipleSeries<T>, range: readonly [number, number]): boolean {
  const label = bracketLabel(s, range)
  return label(range[0]) === label(range[1])
}

/**
 * The cropped y domain: the data (with the band and the reference when set), widened to
 * `minSpan` × the median when asked, padded 12 % of its span, and never below 0 for values that
 * are not. A series whose ends print the same is centred in a domain of at least 10× its span and
 * `max(minSpan, 2 %)` of its median, so it draws level at mid-height.
 */
export function seriesYDomain<T>(points: readonly T[], s: MultipleSeries<T>): [number, number] {
  const r = dataRange(points, s.value)
  if (!r) return [0, 1]
  let [lo, hi] = r
  const med = median(points.map(s.value).filter((v): v is number => v !== null))
  if (med !== null && printsLevel(s, r)) {
    const c = (r[0] + r[1]) / 2
    const need = Math.max(10 * (r[1] - r[0]), Math.max(s.minSpan ?? 0, FLAT_SPAN) * Math.abs(med))
    lo = c - need / 2
    hi = c + need / 2
  }
  if (s.band) {
    lo = Math.min(lo, s.band[0])
    hi = Math.max(hi, s.band[1])
  }
  const ref = s.reference?.value
  if (ref !== undefined && Number.isFinite(ref)) {
    lo = Math.min(lo, ref)
    hi = Math.max(hi, ref)
  }
  if (s.minSpan && med !== null && hi - lo < Math.abs(med) * s.minSpan) {
    const c = (hi + lo) / 2
    const need = Math.abs(med) * s.minSpan
    lo = c - need / 2
    hi = c + need / 2
  }
  const pad = (hi - lo || Math.abs(hi) * 0.02 || 1) * 0.12
  return [r[0] >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad]
}

export function Multiple<T extends { timestamp: number }>({
  s,
  W,
  H,
  yd,
  fx,
  drawn,
  data,
  ticks,
  cur,
  latest,
  windowLabel,
  curTime,
}: {
  s: MultipleSeries<T>
  W: number
  H: number
  yd: readonly [number, number]
  fx: (t: number) => number
  /** The samples inside the fitted domain, drawn. */
  drawn: readonly T[]
  /** The window's samples: the bracket spans their range. */
  data: readonly T[]
  ticks: readonly TimeTick[]
  cur: T | null
  latest: T | null
  windowLabel: string
  /** The scrubbed sample's time, when it is not the latest. */
  curTime: string | null
}) {
  const fy = linear(yd[0], yd[1], H - 30, 10)
  const runs = seriesRuns(drawn, s.value)
  const range = dataRange(data, s.value)
  const plotR = W - SM_RIGHT
  const head = cur ? s.value(cur) : latest ? s.value(latest) : null
  const headText = s.head ?? s.format
  const label = range ? bracketLabel(s, range) : (v: number) => s.format(v)
  // Ends that print the same get one label and no bracket: there is no range to span.
  const level = range ? printsLevel(s, range) : false
  const said = range
    ? level
      ? `${s.format(range[1])} throughout, `
      : `between ${s.format(range[0])} and ${s.format(range[1])}, `
    : ''
  const ref = s.reference ?? null
  const bx = plotR + 12
  // Points stand apart only where the samples do; a dense window keeps the line alone.
  const showPts = drawn.length <= Math.max(2, (plotR - SM_LEFT) / 14)
  return (
    <div className="sm">
      <div className="sm-h">
        <span className="meta">
          {s.label}
          {curTime ? <span className="mt"> {curTime}</span> : null}
        </span>
        {s.band && s.bandLabel ? (
          <span className="mband">
            <i />
            {s.bandLabel}
          </span>
        ) : null}
        <b className="num">{headText(head)}</b>
      </div>
      <svg
        className="chart-svg"
        role="img"
        aria-label={`${s.label} over ${windowLabel}: ${said}latest ${headText(latest ? s.value(latest) : null)}.`}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
      >
        {s.band ? (
          <rect
            className="sm-band"
            x={SM_LEFT}
            y={fy(s.band[1]).toFixed(1)}
            width={Math.max(0, plotR - SM_LEFT)}
            height={Math.max(1, fy(s.band[0]) - fy(s.band[1])).toFixed(1)}
          />
        ) : null}
        {ref ? (
          <>
            <line
              className="sm-ref"
              x1={SM_LEFT}
              x2={plotR}
              y1={fy(ref.value)}
              y2={fy(ref.value)}
            />
            <text className="chart-text is-strong" x={SM_LEFT} y={fy(ref.value) - 6}>
              {ref.label}
            </text>
          </>
        ) : null}
        {range ? (
          <g className="sm-range">
            {level ? null : <line x1={bx} x2={bx} y1={fy(range[1])} y2={fy(range[0])} />}
            <text className="chart-text" x={bx + 8} y={fy(range[1]) + 4}>
              {label(range[1])}
            </text>
            {level ? null : (
              <text className="chart-text" x={bx + 8} y={fy(range[0]) + 4}>
                {label(range[0])}
              </text>
            )}
          </g>
        ) : null}
        {runs.gaps.map(([a, b]) => (
          <path
            key={a.timestamp}
            className="sm-gap"
            d={pathD([
              [fx(a.timestamp), fy(a.v)],
              [fx(b.timestamp), fy(b.v)],
            ])}
          />
        ))}
        {runs.solid.map((run) => (
          <path
            key={run[0]?.timestamp}
            className="sm-line"
            d={pathD(run.map((p) => [fx(p.timestamp), fy(p.v)] as const))}
          />
        ))}
        {cur ? (
          <line className="xh" x1={fx(cur.timestamp)} x2={fx(cur.timestamp)} y1={4} y2={H - 24} />
        ) : null}
        {(showPts
          ? runs.solid.flat()
          : runs.solid.flat().filter((p) => p.timestamp === cur?.timestamp)
        ).map((p) => (
          <rect
            key={p.timestamp}
            className={`sm-pt${cur && cur.timestamp === p.timestamp ? ' is-on' : ''}`}
            x={(fx(p.timestamp) - 5).toFixed(1)}
            y={(fy(p.v) - 5).toFixed(1)}
            width={10}
            height={10}
            rx={2.5}
          />
        ))}
        <line className="sm-axis" x1={0} x2={plotR} y1={H - 24} y2={H - 24} />
        {ticks.map(({ t, label: text }) => (
          <text key={t} className="chart-text" x={fx(t).toFixed(1)} y={H - 6} textAnchor="middle">
            {text}
          </text>
        ))}
      </svg>
    </div>
  )
}
