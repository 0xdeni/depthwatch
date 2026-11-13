/**
 * The grade glyph (docs/design/visual-v4.md §5.5): the status fill (Green A–B, Tan C, Red D–F),
 * an 8 px shape (circle, square, triangle) and the letter in Gray 100; 26 px high and at least 40
 * wide, radius 6. Large in facts: 36 × 56, 20 px, radius 9, a 10 px shape. The fill is never the
 * only cue: the letter and the shape carry the grade. One chip per row (TB5).
 */
import type { ConcentrationBasis, HealthGrade, UnratedReason } from '@depthwatch/core'
import { gradeTone } from '../../lib/format.js'
import { BASIS_MARK, NOT_RATED, unratedDetail } from '../../lib/rating.js'
import { Glossary } from './Glossary.js'
import { BASIS_SHORT } from './HealthBasis.js'
import { Shape, type ShapeName } from './Icon.js'

const SHAPE_OF = { ok: 'circle', warn: 'square', bad: 'triangle' } as const satisfies Record<
  string,
  ShapeName
>

export function GradeGlyph({
  grade,
  size = 'row',
  label,
}: {
  grade: HealthGrade
  /** `row` 28 × 20 (tables, rows); `fact` 32 × 24 (facts, the Health section). */
  size?: 'row' | 'fact'
  /** Accessible name; defaults to "Grade A". */
  label?: string
}) {
  const tone = gradeTone(grade)
  return (
    <span
      className={`grade tone-${tone}${size === 'fact' ? ' is-fact' : ''}`}
      role="img"
      aria-label={label ?? `Grade ${grade}`}
    >
      <Shape shape={SHAPE_OF[tone]} />
      <span aria-hidden="true">{grade}</span>
    </span>
  )
}

/**
 * The chip of a pool with no grade: neutral, the words "Not rated" instead of a letter, and the
 * plain-words reason on hover, focus or tap ("Too thin to rate", "Too thin on one side", "No USD
 * price"). The same size as the grade glyph's row and fact variants, wider for the words.
 */
export function NotRatedChip({
  reason,
  size = 'row',
}: {
  reason: UnratedReason | null
  size?: 'row' | 'fact'
}) {
  return (
    <span className={`grade tone-none is-unrated${size === 'fact' ? ' is-fact' : ''}`}>
      <Glossary definition={unratedDetail(reason)} anchor="health">
        {NOT_RATED}
      </Glossary>
    </span>
  )
}

/**
 * A grade whose concentration basis differs from the one its list states (`HealthBasis`): the
 * glyph with a small "*" on its top right corner, so the column keeps its alignment. The mark is
 * not a control: the list's header note explains it, and a tap on it opens the row's pool.
 */
function MarkedGrade({
  grade,
  basis,
  size,
}: {
  grade: HealthGrade
  basis: ConcentrationBasis
  size: 'row' | 'fact'
}) {
  return (
    <span className="grade-marked">
      <GradeGlyph grade={grade} size={size} />
      <span className="grade-mark" aria-hidden="true">
        {BASIS_MARK}
      </span>
      <span className="sr-only">{`, ${BASIS_SHORT[basis]}`}</span>
    </span>
  )
}

/**
 * The grade glyph of a rated pool, or the "Not rated" chip with its reason (one chip per row, TB5).
 * `marked`: the grade's concentration basis is not the one its list states, so it carries the "*".
 */
export function RatingGlyph({
  health,
  size = 'row',
  marked = false,
}: {
  health: {
    grade: HealthGrade | null
    rated: boolean
    unratedReason: UnratedReason | null
    concentrationBasis?: ConcentrationBasis | null
  }
  size?: 'row' | 'fact'
  marked?: boolean
}) {
  if (!health.rated || !health.grade)
    return <NotRatedChip reason={health.unratedReason} size={size} />
  const basis = health.concentrationBasis ?? null
  if (marked && basis !== null)
    return <MarkedGrade grade={health.grade} basis={basis} size={size} />
  return <GradeGlyph grade={health.grade} size={size} />
}
