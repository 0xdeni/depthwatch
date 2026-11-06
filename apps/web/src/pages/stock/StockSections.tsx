/**
 * The Stock sections (docs/design/stocks-api.md §3), rows of one sections sheet
 * (docs/design/visual-v4.md §5.7):
 * - "venues": the depth share by DEX as one bar with its legend, and under Details every venue's
 *   pools, ±2 % depth and 24 h volume with their shares (docs/METRICS.md, "Stock aggregates");
 * - "pools": every scored pool of the stock in the API's order (the counted ones first, then the
 *   larger thinner side), each linking to its pool page: the DEX and quote, the stock's buy and
 *   sell sides, the $10K spread, the deviation with its band, the grade or the unrated reason, and
 *   where the pool stands in the sums (the API's `counted`, its sides, the stale and paused flags).
 *   The takeaway counts the pools in the depth sums as the API does (`sidesKnownPools`). No row
 *   links to a swap.
 */
import type { StockDetail, StockPoolRow } from '../../api/stockTypes.js'
import { HealthCell, StaleQuoteChip } from '../../components/ui/PoolCells.js'
import { Section } from '../../components/ui/Section.js'
import { PoolCell } from '../../components/ui/Table.js'
import { TableScroll } from '../../components/ui/TableScroll.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { count, dexLabel, NB, shareOf, spreadText, usd } from '../../lib/format.js'
import {
  DEVIATION_NULL_WORD,
  deviationNullDetail,
  deviationWords,
  TRANSFERS_PAUSED,
} from '../../lib/stockText.js'
import { rankedVenues, VenueBar } from './VenueBar.js'

export function VenuesSection({ detail }: { detail: StockDetail }) {
  const [top] = rankedVenues(detail.venues)
  const takeaway = top
    ? `${dexLabel(top.dex)} holds ${shareOf(top.depthShare)} of the depth that counts.`
    : 'No pool of this stock counts in its depth.'
  return (
    <Section
      id="s-venues"
      title="venues"
      takeaway={takeaway}
      details={
        detail.venues.length
          ? {
              content: (
                <TableScroll>
                  <table className="tbl dense">
                    <caption className="sr-only">Depth and volume by DEX</caption>
                    <thead>
                      <tr>
                        <th scope="col">DEX</th>
                        <th scope="col" className="r">
                          Pools
                        </th>
                        <th scope="col" className="r">
                          Depth ±2{NB}%
                        </th>
                        <th scope="col" className="r">
                          Share
                        </th>
                        <th scope="col" className="r">
                          24{NB}h volume
                        </th>
                        <th scope="col" className="r">
                          Share
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.venues.map((v) => (
                        <tr key={v.dex}>
                          <td>{dexLabel(v.dex)}</td>
                          <td className="r num">{count(v.poolCount)}</td>
                          <td className="r num">{usd(v.depth2Usd)}</td>
                          <td className="r num">{shareOf(v.depthShare)}</td>
                          <td className="r num">{usd(v.volume24hUsd)}</td>
                          <td className="r num">{shareOf(v.volumeShare)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              ),
            }
          : undefined
      }
    >
      {top ? (
        <VenueBar venues={detail.venues} large />
      ) : (
        <p className="muted">A stale price or paused transfers leave a pool out of the sums.</p>
      )}
    </Section>
  )
}

function DeviationCell({ row }: { row: StockPoolRow }) {
  const ref = row.reference
  if (ref === null) {
    return <Unknown reason={deviationNullDetail('unread')} />
  }
  const w = deviationWords(ref, ref.deviationThresholdBps, ref.feeBps)
  if (ref.deviationBps === null) {
    return (
      <span className="stk-devc">
        <Unknown reason={deviationNullDetail(ref.deviationNull ?? 'unread')} />
        <span className="faint small">{DEVIATION_NULL_WORD[ref.deviationNull ?? 'unread']}</span>
      </span>
    )
  }
  return (
    <span className="stk-devc">
      <span className="num">{w.value}</span>
      <span className="faint small">{w.words}</span>
    </span>
  )
}

/**
 * Where a pool stands in the stock's sums, from the API's `counted`: counted with both sides in
 * the depth sums; counted with a side unpriced (in the spread, not in the depth sums); or left out,
 * for a stale quote or paused transfers (at the pool's snapshot, or at a newer reading: the only
 * other reason the API leaves a pool out).
 */
function Flags({ row }: { row: StockPoolRow }) {
  if (row.counted) {
    return row.depth2BuyUsd === null || row.depth2SellUsd === null ? (
      <span className="small">Counted, one side unpriced: not in the depth sums</span>
    ) : (
      <span className="small">Counted</span>
    )
  }
  const stale = row.pool.staleQuote
  const paused = row.reference?.transfersPaused === true || !stale
  return (
    <span className="stk-flags">
      {stale ? <StaleQuoteChip deviationBps={row.pool.priceDeviationBps} /> : null}
      {paused ? <span className="small">{TRANSFERS_PAUSED}</span> : null}
      <span className="faint small">left out of the sums</span>
    </span>
  )
}

export function PoolsSection({ detail }: { detail: StockDetail }) {
  const n = detail.pools.length
  const inSums = detail.sidesKnownPools
  const takeaway = !n
    ? 'Depthwatch scores no pool of this stock yet.'
    : inSums === n
      ? `${count(n)} scored ${n === 1 ? 'pool' : 'pools'}, all in the depth sums.`
      : `${count(n)} scored ${n === 1 ? 'pool' : 'pools'}, ${count(inSums)} in the depth sums.`
  return (
    <Section id="s-pools" title="pools" takeaway={takeaway} className="stk-pools-sec">
      {n ? (
        <TableScroll className="stk-pools-wrap">
          <table className="tbl dense stk-pools">
            <caption className="sr-only">The stock’s scored pools</caption>
            <thead>
              <tr>
                <th scope="col">Pool</th>
                <th scope="col" className="r">
                  Buy side ±2{NB}%
                </th>
                <th scope="col" className="r">
                  Sell side ±2{NB}%
                </th>
                <th scope="col" className="r">
                  $10K spread
                </th>
                <th scope="col">From Chainlink’s answer</th>
                <th scope="col">Health</th>
                <th scope="col">Sums</th>
              </tr>
            </thead>
            <tbody>
              {detail.pools.map((row) => (
                <tr key={row.pool.pool.id}>
                  <td>
                    <PoolCell pool={row.pool.pool} linkClass="row-link" />
                  </td>
                  <td className="r num">{usd(row.depth2BuyUsd)}</td>
                  <td className="r num">{usd(row.depth2SellUsd)}</td>
                  <td className="r num">{spreadText(row.pool.spread10kBps, 10_000)}</td>
                  <td>
                    <DeviationCell row={row} />
                  </td>
                  <td>
                    <HealthCell health={row.pool.health} />
                  </td>
                  <td>
                    <Flags row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <p className="muted">A pool of the stock appears here once it is snapshotted and scored.</p>
      )}
    </Section>
  )
}
