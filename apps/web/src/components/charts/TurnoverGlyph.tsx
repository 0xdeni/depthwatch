/**
 * The turnover glyph of the gap rows (docs/design/visual-v4.md §5.8, §5.9.8): the gap score on its
 * own log scale (core's `computeGap`: 1× turnover is 0, 10× is 50, 100× is 100) as a 72 × 10 bar in
 * ink on a `--surface-2` track, with a 2 px tick at the meaningful-gap threshold (3× turnover, a
 * score of 24), then the score at 800. Rows under 3× are drawn quiet (a `--text-2` fill). Its fill
 * grows with its block in the first view when the rows sit over the band (`data-bar`).
 */
import { computeGap, MEANINGFUL_GAP_TURNOVER } from '@depthwatch/core'
import { score } from '../../lib/format.js'
import { vars } from './useChartWidth.js'
import './glyphs.css'

/**
 * A pool trading 3× its ±2 % depth a day or more has a meaningful gap (TB9), on every screen: core's
 * threshold (docs/METRICS.md, "Gap score and the gaps feed"), the one the API counts by.
 */
export { MEANINGFUL_GAP_TURNOVER }

/** The threshold's gap score (23.9) from core, so the tick can never disagree with the scores. */
export const MEANINGFUL_GAP_SCORE = computeGap(MEANINGFUL_GAP_TURNOVER, 1).gapScore ?? 0

/**
 * The meter's accessible name, in plain words: the score, and which side of the tick it sits on
 * ("Gap score 100 of 100: trades 3 times its depth a day or more").
 */
export function turnoverLabel(gapScore: number | null): string {
  if (gapScore === null) return 'Gap score unknown'
  const times = `${MEANINGFUL_GAP_TURNOVER} times its depth a day`
  const trades = gapScore >= MEANINGFUL_GAP_SCORE ? `${times} or more` : `under ${times}`
  return `Gap score ${score(gapScore)} of 100: trades ${trades}`
}

export function TurnoverGlyph({
  gapScore,
  quiet = false,
}: {
  gapScore: number | null
  /** A row under the 3× threshold. */
  quiet?: boolean
}) {
  const v = gapScore === null ? 0 : Math.min(1, Math.max(0, gapScore / 100))
  return (
    <span className={`gbar${quiet ? ' quiet' : ''}`}>
      <span
        className="tmeter"
        role="img"
        aria-label={turnoverLabel(gapScore)}
        style={vars({ '--v': v, '--t': MEANINGFUL_GAP_SCORE / 100 })}
      >
        <i className="m-fill" data-bar="" />
        <b className="m-tick" />
      </span>
      <span className="num" aria-hidden="true">
        {score(gapScore)}
      </span>
    </span>
  )
}
