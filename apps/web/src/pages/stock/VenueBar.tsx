/**
 * A stock's depth share by DEX (docs/METRICS.md, "Stock aggregates", `venues`) as one bar with its
 * text equivalent: the largest venue in ink, the second in `--text-2`, every other venue hatched
 * (docs/design/visual-v4.md §5.9.8). The bar's accessible name lists every venue's share; the list
 * row shows the largest venue in words under it, the venues section a legend of all of them.
 * Shares are read as the API sent them; a tiny share reads "under 1 %", never "0 %".
 */
import type { StockVenue } from '@depthwatch/core'
import { dexLabel, shareOf } from '../../lib/format.js'
import '../../components/charts/charts.css'

/** The venues in the depth sums, largest share first (ties keep the API's DEX order). */
export function rankedVenues(venues: readonly StockVenue[]): StockVenue[] {
  return venues
    .filter((v) => v.depthShare !== null && v.depthShare > 0)
    .sort((a, b) => (b.depthShare ?? 0) - (a.depthShare ?? 0))
}

/** "Aero Slipstream 84 %, Uniswap v3 15 %, Uniswap v4 under 1 %". */
export function venueWords(venues: readonly StockVenue[]): string {
  return rankedVenues(venues)
    .map((v) => `${dexLabel(v.dex)} ${shareOf(v.depthShare)}`)
    .join(', ')
}

const pctOf = (f: number) => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(3)}%`

export function VenueBar({
  venues,
  large = false,
}: {
  venues: readonly StockVenue[]
  /** The venues section's 32 px bar with its legend; the list row's is 8 px with the top venue. */
  large?: boolean
}) {
  const ranked = rankedVenues(venues)
  const [first, second, ...rest] = ranked
  if (!first) return null
  const restShare = rest.reduce((sum, v) => sum + (v.depthShare ?? 0), 0)
  return (
    <div className={`stk-venues${large ? ' is-large' : ''}`}>
      <div className="stk-vbar" role="img" aria-label={`Depth by DEX: ${venueWords(venues)}`}>
        <i className="v1" style={{ flexBasis: `max(4px, ${pctOf(first.depthShare ?? 0)})` }} />
        {second ? <i className="v2" style={{ flexBasis: pctOf(second.depthShare ?? 0) }} /> : null}
        {restShare > 0 ? <i className="v3" /> : null}
      </div>
      {large ? (
        <p className="legend" aria-hidden="true">
          {ranked.map((v, i) => (
            <span key={v.dex}>
              {i < 2 ? (
                <i className={`sw ${i === 0 ? 'ink' : 't2'}`} />
              ) : (
                <span className="hatch is-rest" />
              )}
              {dexLabel(v.dex)} {shareOf(v.depthShare)}
            </span>
          ))}
        </p>
      ) : (
        <span className="small faint" aria-hidden="true">
          {dexLabel(first.dex)} {shareOf(first.depthShare)}
          {ranked.length > 1 ? `, ${ranked.length - 1} more` : ''}
        </span>
      )}
    </div>
  )
}
