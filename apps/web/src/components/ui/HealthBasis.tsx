/**
 * What a list's grades stand on (docs/METRICS.md, "Concentration (max 20)"), said once beside its
 * Health header instead of on every row: an info button (24 × 24, 44 × 44 on a coarse pointer)
 * whose note names the concentration basis most rated rows share. A row whose basis differs, the
 * minority, carries a small "*" the note explains; the chip stays plain and part of the row link.
 * On the pool page the grade's basis is a short text link under the score's label (`GradeBasisLink`).
 * Formatting only: the basis comes from the API.
 */
import { type ConcentrationBasis, OWNER_COVERAGE_MIN } from '@depthwatch/core'
import { NB } from '../../lib/format.js'
import { concentrationBasisDetail } from '../../lib/rating.js'
import { Glossary } from './Glossary.js'
import { Icon } from './Icon.js'

/** The fields of a pool's health the basis reads. */
export interface BasisHealth {
  rated: boolean
  concentrationBasis?: ConcentrationBasis | null
}

/** The basis of a list's rated rows: the one most share, and the others, which carry the mark. */
export interface HealthBasis {
  common: ConcentrationBasis | null
  others: readonly ConcentrationBasis[]
}

/** Fixed order of the bases: ties for the most rows go to the first. */
const ORDER: readonly ConcentrationBasis[] = ['owners', 'ranges', 'neutral']

/** A grade's basis in a few words: the chip's accessible name and the pool page's link. */
export const BASIS_SHORT: Readonly<Record<ConcentrationBasis, string>> = {
  owners: 'concentration from LP owners',
  ranges: 'concentration from price ranges',
  neutral: 'concentration scored neutral',
}

const coverage = `${Math.round(OWNER_COVERAGE_MIN * 100)}${NB}%`

/** How the 20 concentration points were scored, as the end of "is scored …". */
const BASIS_HOW: Readonly<Record<ConcentrationBasis, string>> = {
  owners: 'from the largest LP owner’s share of the liquidity',
  ranges: `from how the liquidity spreads over price ranges, since LP owners are not indexed or cover under ${coverage} of the pool`,
  neutral: 'as a neutral 10 of 20, since LP owners are not indexed',
}

/** The basis most rated rows share and the others present; a row with no basis counts for none. */
export function healthBasis(rows: readonly BasisHealth[]): HealthBasis {
  const counts = new Map<ConcentrationBasis, number>()
  for (const h of rows) {
    const basis = h.rated ? (h.concentrationBasis ?? null) : null
    if (basis !== null) counts.set(basis, (counts.get(basis) ?? 0) + 1)
  }
  let common: ConcentrationBasis | null = null
  for (const basis of ORDER)
    if ((counts.get(basis) ?? 0) > (common === null ? 0 : (counts.get(common) ?? 0))) common = basis
  return { common, others: ORDER.filter((b) => b !== common && counts.has(b)) }
}

/** Whether this row's grade carries the mark: rated, with a basis other than the common one. */
export function basisMarked(basis: HealthBasis, h: BasisHealth): boolean {
  const own = h.rated ? (h.concentrationBasis ?? null) : null
  return own !== null && own !== basis.common
}

/**
 * The note: what the common basis is and, when some rows differ, what their mark means. Null when
 * every grade rests on LP owners (nothing to explain) or no row is rated.
 */
export function healthBasisNote(basis: HealthBasis): string | null {
  if (basis.common === null || (basis.common === 'owners' && !basis.others.length)) return null
  const lead = `Concentration, 20 of a grade’s 100 points, is scored ${BASIS_HOW[basis.common]}.`
  if (!basis.others.length) return lead
  return `${lead} Grades marked * score it ${basis.others.map((b) => BASIS_HOW[b]).join(', or ')}.`
}

/** The info button's accessible name. */
export const BASIS_NOTE_NAME = 'How these grades are scored'

/** The header's info button over the note; nothing when there is nothing to say. */
export function HealthBasisNote({ basis }: { basis: HealthBasis }) {
  const note = healthBasisNote(basis)
  if (note === null) return null
  return (
    <Glossary definition={note} anchor="health" className="th-info">
      {/* Named as a picture, so the button is named and the header's text stays "Health". */}
      <span role="img" aria-label={BASIS_NOTE_NAME}>
        <Icon name="info" />
      </span>
    </Glossary>
  )
}

/**
 * The pool page's grade basis, a fact's last description (`Fact`): under the score and its label,
 * "Concentration from price ranges", whose reason opens on hover, focus or tap. Nothing for an
 * owner-based grade or an unknown basis.
 */
export function GradeBasisLink({ basis }: { basis: ConcentrationBasis | null | undefined }) {
  const detail = concentrationBasisDetail(basis ?? null)
  if (detail === null || !basis) return null
  const short = BASIS_SHORT[basis]
  return (
    <dd className="fact-basis">
      <Glossary definition={detail} anchor="health">
        {short.charAt(0).toUpperCase() + short.slice(1)}
      </Glossary>
    </dd>
  )
}
