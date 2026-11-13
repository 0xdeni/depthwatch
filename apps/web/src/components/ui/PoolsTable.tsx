/**
 * The pools table (docs/design/visual-v4.md §5.8), shared by Pools and Token, set in a table sheet
 * (a flush block) by its page.
 *
 * Desktop: a 44 px sticky header over a 2 px `--text-1` rule whose sortable cells are buttons
 * (`aria-sort` on the sorted one), 64 px rows at 15 px / 600 whose pool link stretches over the row
 * (one tab stop), the default columns (pool, health, depth ±2 % with its row glyph on one shared
 * scale, spread at $10K, 24 h volume) and the optional ones from Columns. A table wider than its
 * sheet scrolls inside its wrapper instead of the page. Phones: rows of at least 64 px with the
 * pool cell, the value of the current sort metric (15 px / 750) and the glyph or chip, under a
 * head row that names the metric and holds the grades' info button over their column; the page
 * decides how many rows show.
 */
import { Fragment, useRef } from 'react'
import type { PoolSummary } from '../../api/types.js'
import { NB, price, tokenText } from '../../lib/format.js'
import { basePrice, baseQuote } from '../../lib/orient.js'
import {
  glyphMax,
  OPTIONAL_COLUMNS,
  type OptionalColumn,
  type PoolsSortKey,
  poolTieBreaks,
  SORT_LABEL,
  type TableState,
} from '../../lib/poolsTable.js'
import { useOverflowX } from '../../lib/useOverflowX.js'
import { RatingGlyph } from './GradeGlyph.js'
import { basisMarked, HealthBasisNote, healthBasis } from './HealthBasis.js'
import { type CellKey, DepthCell, HealthCell, metricCell, unknownReason } from './PoolCells.js'
import { PoolCell, SortHeader } from './Table.js'
import { UnknownNote } from './Unknown.js'

const COLUMN_LABEL: Readonly<Record<OptionalColumn, string>> = {
  tvl: 'TVL',
  gap: 'Gap score',
  top: 'Top LP',
  price: 'Price',
  updated: 'Updated',
}
const SORTABLE: ReadonlySet<OptionalColumn> = new Set(['tvl', 'gap', 'top'])

/**
 * The Price column (N2): the price of the pool's base token in its quote token, "2,460.32 USDC"
 * for WETH / USDC and "65,712.95 USDC" for USDC / cbBTC, never the inverse below 1. The cell's
 * title names the pair: "1 cbBTC = 65,712.95 USDC".
 */
function PriceCell({ pool }: { pool: PoolSummary }) {
  const { base, quote } = baseQuote(pool.pool, pool.price)
  const text = price(basePrice(pool.price))
  return (
    <span title={`1${NB}${tokenText(base)} = ${text}${NB}${tokenText(quote)}`}>
      {text}
      <span className="td-unit">
        {NB}
        {tokenText(quote)}
      </span>
    </span>
  )
}

export interface PoolsTableProps {
  rows: readonly PoolSummary[]
  state: TableState
  /** The data clock (unix seconds) for the Updated column. */
  now: number
  phone: boolean
  onSort: (key: PoolsSortKey) => void
  /** The table's (and the phone list's) accessible name. */
  label: string
  /** Id of the sentence that describes the table. */
  describedBy?: string
  /** A quiet heading before row `at` ("Unrated pools"), where the table changes kind of pool. */
  divider?: { at: number; label: string }
}

export function PoolsTable({
  rows,
  state,
  now,
  phone,
  onSort,
  label,
  describedBy,
  divider,
}: PoolsTableProps) {
  const { sort, dir, cols } = state
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)
  const scrolls = useOverflowX(wrapRef, tableRef)
  const ties = poolTieBreaks(rows.map((p) => p.pool))
  // The grades' basis is said once, in the Health header (on phones over the grade column); a
  // minority basis marks its rows.
  const basis = healthBasis(rows.map((p) => p.health))
  if (phone) {
    return (
      <>
        <div className="prow-head">
          <HealthBasisNote basis={basis} />
          <span aria-hidden="true">Pool</span>
          <span aria-hidden="true">{SORT_LABEL[sort]}</span>
        </div>
        <ol className="rowlist prow" aria-label={label}>
          {rows.map((p, i) => (
            <Fragment key={p.pool.id}>
              {divider?.at === i ? <li className="rl-group">{divider.label}</li> : null}
              <li>
                <div className="rl-row">
                  <PoolCell pool={p.pool} tieBreak={ties.get(p.pool.id)} />
                  <span className="metric num">{metricCell(p, sort, now)}</span>
                  <RatingGlyph health={p.health} marked={basisMarked(basis, p.health)} />
                </div>
              </li>
            </Fragment>
          ))}
        </ol>
      </>
    )
  }
  const max = glyphMax(rows)
  // The column's "—" explained once, in its header (D6); health shows the Not rated chip instead.
  const note = (key: CellKey) =>
    key === 'health' ? (
      <HealthBasisNote basis={basis} />
    ) : (
      <UnknownNote reasons={rows.map((p) => unknownReason(p, key))} />
    )
  const header = (key: PoolsSortKey, text: string = SORT_LABEL[key]) => (
    <SortHeader
      key={key}
      label={text}
      active={sort === key}
      dir={dir}
      onSort={() => onSort(key)}
      note={note(key)}
    />
  )
  const optional = OPTIONAL_COLUMNS.map((c) => c.key).filter((c) => cols.includes(c))
  return (
    <div ref={wrapRef} className={`twrap${scrolls ? ' is-scroll' : ''}`}>
      <table ref={tableRef} className="ptable" aria-describedby={describedBy}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">Pool</th>
            {header('health')}
            {header('depth')}
            {header('spread')}
            {header('volume')}
            {optional.map((c) =>
              SORTABLE.has(c) ? (
                header(c as PoolsSortKey, COLUMN_LABEL[c])
              ) : (
                <th key={c} scope="col" aria-label={COLUMN_LABEL[c]}>
                  {COLUMN_LABEL[c]}
                  {note(c)}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <Fragment key={p.pool.id}>
              {divider?.at === i ? (
                <tr className="group-row">
                  <td colSpan={5 + optional.length}>{divider.label}</td>
                </tr>
              ) : null}
              <tr>
                <td>
                  <PoolCell pool={p.pool} linkClass="row-link" tieBreak={ties.get(p.pool.id)} />
                </td>
                <td>
                  <HealthCell health={p.health} marked={basisMarked(basis, p.health)} />
                </td>
                <td>
                  <DepthCell pool={p} max={max} />
                </td>
                <td>{metricCell(p, 'spread')}</td>
                <td>{metricCell(p, 'volume')}</td>
                {optional.map((c) => (
                  <td key={c}>
                    {c === 'price' && p.price !== null ? (
                      <PriceCell pool={p} />
                    ) : (
                      metricCell(p, c, now)
                    )}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
