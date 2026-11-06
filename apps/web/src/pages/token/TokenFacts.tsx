/**
 * The Token facts row (ia-v3 §4.7, docs/design/visual-v4.md §6.8, §5.6): one ink block stacked
 * over the band's lower edge, three columns from 1024 px. The USD price, the pools discovered
 * (with the scored count when fewer are scored), and where the price comes from: the route's first
 * pool, from the stable anchor, with the rest of the route in the label. An anchor reads "Anchor",
 * at $1 by convention; an unpriced token "—" with the reason (D6). A tokenized stock's price is
 * the "valuation price", with the valuation-convention label under the row (stocks-api.md §3):
 * the price graph's price, used for depth and TVL, is no stock price.
 */
import { Link } from 'react-router-dom'
import type { PoolMetaDto, TokenDetail } from '../../api/types.js'
import { Overlap } from '../../components/ui/Block.js'
import { Fact, FactsRow } from '../../components/ui/Fact.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { count, dexLabel, pairLabel, poolHref, price, shortAddress } from '../../lib/format.js'
import { VALUATION_LABEL } from '../../lib/stockText.js'
import { type RouteStep, routeSteps, stepWords } from './tokenText.js'

function RouteFact({ steps, priced }: { steps: RouteStep[]; priced: boolean }) {
  const [first, ...rest] = steps
  if (!priced)
    return (
      <Fact
        value={<Unknown reason="No route from a stable anchor reaches this token yet." />}
        label="priced through"
      />
    )
  if (!first) return <Fact value="Anchor" label="$1 by convention, not routed" />
  const then = rest.map((s) => `, then ${stepWords(s)}`).join('')
  if (first.pool) {
    return (
      <Fact
        value={
          <Link className="token-route touch-hit" to={poolHref(first.source)}>
            {pairLabel(first.pool.token0, first.pool.token1)}
          </Link>
        }
        label={`priced through this ${dexLabel(first.pool.dex)} pool${then}`}
      />
    )
  }
  if (first.words) return <Fact value={first.words} label={`priced through${then}`} />
  return (
    <Fact
      value={
        <Link
          className="token-route addr touch-hit"
          to={poolHref(first.source)}
          title={first.source}
        >
          {shortAddress(first.source.slice(first.source.indexOf(':') + 1))}
        </Link>
      }
      label={`priced through a pool not tracked here${then}`}
    />
  )
}

export function TokenFacts({
  detail,
  metas,
  stock = false,
}: {
  detail: TokenDetail
  metas: ReadonlyMap<string, PoolMetaDto>
  /** The token is on the stock list: its price is a valuation price, labelled. */
  stock?: boolean
}) {
  const scored = detail.total
  const found = detail.poolCount
  const poolsLabel = `${found === 1 ? 'pool' : 'pools'} discovered${scored < found ? `, ${count(scored)} scored` : ''}`
  return (
    <Overlap label="Facts">
      <FactsRow
        layout="scorecard"
        label="Token facts"
        className="token-facts"
        note={stock ? VALUATION_LABEL : undefined}
      >
        <Fact
          value={
            detail.usd === null ? (
              <Unknown reason="No route from a stable anchor reaches this token yet." />
            ) : (
              `$${price(detail.usd)}`
            )
          }
          label={stock ? 'valuation price' : 'USD price'}
        />
        <Fact value={count(found)} label={poolsLabel} />
        <RouteFact steps={routeSteps(detail.via, metas)} priced={detail.usd !== null} />
      </FactsRow>
    </Overlap>
  )
}
