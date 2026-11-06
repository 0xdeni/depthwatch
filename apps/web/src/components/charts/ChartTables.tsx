/**
 * The "Show data" tables of the focal charts (CH9, docs/design/visual-v4.md §5.9): the numbers
 * behind each figure, as dense tables (§5.8). Pages pass them to the charts as children. They read
 * the same stored values the charts draw; nothing is recomputed.
 */
import type { MmSampleDto, PoolSnapshotDto, PoolSummary, SampleWindow } from '../../api/types.js'
import { TRANSFERS_PAUSED_DETAIL } from '../../lib/depthSums.js'
import { abs, amount, day, NB, shareOf, tokenText, usd } from '../../lib/format.js'
import { breachSides, dailySummary, sampleKeys } from '../../lib/scorecard.js'
import { staleQuoteDetail } from '../../lib/staleQuote.js'
import { TableScroll } from '../ui/TableScroll.js'
import { Unknown } from '../ui/Unknown.js'
import { butterflyModel, pickButterflyRows } from './butterflyModel.js'
import { asymmetryNote } from './curveModel.js'

/**
 * Butterfly data: each row's pool with both sides within 2 % and its share of the scope, then
 * every other pool together, then the "All of …" total.
 */
export function ButterflyTable({
  pools,
  rows: rowsProp,
  gapPoolId,
  scope = 'Base',
}: {
  pools: readonly PoolSummary[]
  rows?: readonly PoolSummary[]
  gapPoolId?: string | null
  scope?: string
}) {
  const rows = rowsProp ?? pickButterflyRows(pools, gapPoolId)
  const m = butterflyModel(rows, pools)
  // A stale or paused row is listed but outside the totals, so "every other pool" is what the
  // totals hold beyond the counted rows.
  const counted = m.rows.filter((r) => r.share !== null)
  const other = m.poolCount - counted.length
  const both = m.total.sell + m.total.buy
  const otherSell = m.total.sell - counted.reduce((s, r) => s + (r.sell ?? 0), 0)
  const otherBuy = m.total.buy - counted.reduce((s, r) => s + (r.buy ?? 0), 0)
  return (
    <TableScroll>
      <table className="tbl dense">
        <caption className="sr-only">Depth within 2{NB}% by pool</caption>
        <thead>
          <tr>
            <th scope="col">Pool</th>
            <th scope="col" className="r">
              Sell ±2{NB}%
            </th>
            <th scope="col" className="r">
              Buy ±2{NB}%
            </th>
            <th scope="col" className="r">
              Share of {scope}
            </th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.pair} <span className="faint">{r.venue}</span>
              </td>
              <td className="r num">{usd(r.sell)}</td>
              <td className="r num">{usd(r.buy)}</td>
              <td className="r num">
                {r.share === null ? (
                  <Unknown
                    reason={r.paused ? TRANSFERS_PAUSED_DETAIL : staleQuoteDetail(r.deviationBps)}
                  />
                ) : (
                  shareOf(r.share)
                )}
              </td>
            </tr>
          ))}
          {other > 0 ? (
            <tr>
              <td>
                Every other pool{' '}
                <span className="faint">
                  {other} {other === 1 ? 'pool' : 'pools'}
                </span>
              </td>
              <td className="r num">{usd(otherSell)}</td>
              <td className="r num">{usd(otherBuy)}</td>
              <td className="r num">{shareOf(both > 0 ? (otherSell + otherBuy) / both : null)}</td>
            </tr>
          ) : null}
          <tr className="tot-row">
            <td>All of {scope}</td>
            <td className="r num">{usd(m.total.sell)}</td>
            <td className="r num">{usd(m.total.buy)}</td>
            <td className="r num">100{NB}%</td>
          </tr>
        </tbody>
      </table>
    </TableScroll>
  )
}

/**
 * Depth curve data: ±1/2/5 % per side in USD and in the token traded (sold on the sell side, spent
 * on the buy side), whether the price was reached, then the asymmetry. The token column stays even
 * for a $1.00 token: a stable a little off its peg spends a little more or less than the dollars,
 * and the table keeps one shape.
 */
export function DepthCurveTable({
  snapshot,
  token0,
  token1,
}: {
  snapshot: PoolSnapshotDto
  token0: { symbol: string; label?: string; decimals: number }
  token1: { symbol: string; label?: string; decimals: number }
}) {
  const note = asymmetryNote(snapshot)
  return (
    <>
      <TableScroll>
        <table className="tbl dense">
          <caption className="sr-only">Depth per level and side</caption>
          <thead>
            <tr>
              <th scope="col">Move</th>
              <th scope="col" className="r">
                Sell side
              </th>
              <th scope="col" className="r">
                {tokenText(token0)} sold
              </th>
              <th scope="col" className="r">
                Buy side
              </th>
              <th scope="col" className="r">
                {tokenText(token1)} spent
              </th>
              <th scope="col" className="r">
                Price
              </th>
            </tr>
          </thead>
          <tbody>
            {snapshot.depthUsd.map((row) => {
              const raw = snapshot.depth.find((d) => d.pct === row.pct)
              const out = (reached: boolean | undefined) => (reached === false ? ', runs out' : '')
              const reached = raw ? raw.down.reached && raw.up.reached : null
              return (
                <tr key={row.pct}>
                  <td>
                    ±{row.pct}
                    {NB}%
                  </td>
                  <td className="r num">{usd(row.downUsd)}</td>
                  <td className="r num">
                    {raw ? amount(raw.down.amountIn, token0.decimals) : '—'}
                    {out(raw?.down.reached)}
                  </td>
                  <td className="r num">{usd(row.upUsd)}</td>
                  <td className="r num">
                    {raw ? amount(raw.up.amountIn, token1.decimals) : '—'}
                    {out(raw?.up.reached)}
                  </td>
                  <td className="r">
                    {reached === null ? '—' : reached ? 'Reached' : 'Liquidity runs out'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableScroll>
      {note ? <p className="tbl-note">{note}</p> : null}
    </>
  )
}

/**
 * Market-maker chart data (ia-v3 §4.6): per sample for 24 h, newest first; per UTC day for 7 d
 * and 30 d (lowest sell side, lowest buy side, "3 of 12" within KPI).
 */
export function MarketMakerTable({
  points,
  window,
  from,
}: {
  points: readonly MmSampleDto[]
  window: SampleWindow
  /** The window's first second: samples before it belong to a longer window. */
  from: number
}) {
  const inWindow = points.filter((p) => p.timestamp >= from)
  // Two samples can share a block and timestamp (a `mm sample` and a `snapshot`), so the keys
  // carry an occurrence suffix.
  const newestFirst = [...inWindow].reverse()
  const keys = sampleKeys(newestFirst)
  if (window === '24h') {
    return (
      <TableScroll>
        <table className="tbl dense">
          <caption className="sr-only">Samples of the last 24 hours</caption>
          <thead>
            <tr>
              <th scope="col">Time (UTC)</th>
              <th scope="col" className="r">
                Sell side
              </th>
              <th scope="col" className="r">
                Buy side
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((p, i) => (
              <tr key={keys[i]}>
                <td className="nowrap">{abs(p.timestamp)}</td>
                <td className="r num">{usd(p.attribution.depthDownUsd)}</td>
                <td className="r num">{usd(p.attribution.depthUpUsd)}</td>
                <td>
                  {p.withinKpi === null
                    ? 'Not evaluable'
                    : p.withinKpi
                      ? 'Within KPI'
                      : `Breached, ${breachSides(p.breaches)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    )
  }
  return (
    <TableScroll>
      <table className="tbl dense">
        <caption className="sr-only">Samples per UTC day</caption>
        <thead>
          <tr>
            <th scope="col">Day (UTC)</th>
            <th scope="col" className="r">
              Lowest sell side
            </th>
            <th scope="col" className="r">
              Lowest buy side
            </th>
            <th scope="col" className="r">
              Within KPI
            </th>
          </tr>
        </thead>
        <tbody>
          {dailySummary(inWindow).map((d) => (
            <tr key={d.day}>
              <td className="nowrap">{day(d.day)}</td>
              <td className="r num">{usd(d.minDownUsd)}</td>
              <td className="r num">{usd(d.minUpUsd)}</td>
              <td className="r num">
                {d.withinKpi} of {d.evaluable}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  )
}
