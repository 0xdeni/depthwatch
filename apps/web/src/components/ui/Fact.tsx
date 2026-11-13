/**
 * Facts (docs/design/visual-v4.md §5.6): value first, label second; the label carries its
 * comparison (P4: "sell side now, below the $400K KPI"). The value is `--t-kpi` at 820, with a
 * grade glyph or the 14 px breach triangle 14 px after it; the label is 15 px `--text-2` (on the
 * ink block `--on-ink-2`), at most 30ch, 8 px under it. An optional eyebrow ("24 H VOLUME") sits
 * above the value; a grade not resting on LP owners says what it rests on in a short text link
 * under the label, so the label still names the value. The DOM keeps the label first, as a
 * definition list's term; CSS puts the value on top.
 *
 * `FactsRow` is the facts row of Pool and Scorecard: one ink block over the band, 4 or 3 equal
 * columns with 1 px dividers from 1024 px, 2 columns from 600 px, then 2 × 2 at 28 px (Pool) or
 * one column (Scorecard); a note (the gap callout) may follow under a Gray 80 rule.
 */

import type { ConcentrationBasis, HealthGrade } from '@depthwatch/core'
import type { ReactNode } from 'react'
import { GradeGlyph } from './GradeGlyph.js'
import { GradeBasisLink } from './HealthBasis.js'
import { BreachMark } from './StatusWord.js'

/** `home`: rows of one ink block on phones; `pool`: 4 columns, 2 × 2 on phones; `scorecard`: 3. */
export type FactsLayout = 'home' | 'pool' | 'scorecard'

const LAYOUT_CLASS: Readonly<Record<FactsLayout, string>> = {
  home: 'is-rows',
  pool: 'is-grid',
  scorecard: 'is-stack',
}

export function Facts({
  layout = 'pool',
  label,
  className,
  children,
}: {
  layout?: FactsLayout
  /** Accessible name of the list, when the page has more than one. */
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <dl
      className={`facts ${LAYOUT_CLASS[layout]}${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {children}
    </dl>
  )
}

export function Fact({
  value,
  label,
  eyebrow,
  grade,
  gradeBasis,
  breached,
  breachedLabel,
  bullet,
}: {
  value: ReactNode
  label: ReactNode
  /** The mono caps line above the value ("24 h volume"); written in sentence case. */
  eyebrow?: string
  grade?: HealthGrade | null
  /**
   * The grade's concentration basis: a grade not resting on LP owners says what it rests on in a
   * short text link under the label ("Concentration from price ranges").
   */
  gradeBasis?: ConcentrationBasis | null
  /** Adds the 14 px triangle after the value. */
  breached?: boolean
  /** The triangle's accessible name; "Below KPI" by default. */
  breachedLabel?: string
  /** A bullet graph 8 px under the value (scorecard facts). */
  bullet?: ReactNode
}) {
  const mark = (
    <>
      {grade ? <GradeGlyph grade={grade} size="fact" /> : null}
      {breached ? <BreachMark label={breachedLabel} /> : null}
    </>
  )
  return (
    <div className="fact">
      {eyebrow ? <dt className="eyebrow fact-eb">{eyebrow}</dt> : null}
      <dt>{label}</dt>
      {bullet ? (
        <dd className="has-bullet">
          <span className="fv">
            <span className="num">{value}</span>
            {mark}
          </span>
          {bullet}
        </dd>
      ) : (
        <dd>
          <span className="num">{value}</span>
          {mark}
        </dd>
      )}
      {grade ? <GradeBasisLink basis={gradeBasis} /> : null}
    </div>
  )
}

/** The facts row: one ink block over the band holding the facts, then an optional note. */
export function FactsRow({
  layout = 'pool',
  label,
  note,
  className,
  children,
}: {
  layout?: Exclude<FactsLayout, 'home'>
  label?: string
  /** Under a Gray 80 rule: the gap callout ("Liquidity gap: … See all gaps"). */
  note?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`blk ink facts-row${className ? ` ${className}` : ''}`} data-over="">
      <Facts layout={layout} label={label}>
        {children}
      </Facts>
      {note ? <p className="facts-note">{note}</p> : null}
    </div>
  )
}
