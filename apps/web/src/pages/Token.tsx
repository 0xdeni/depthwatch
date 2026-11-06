/**
 * Token (`/tokens/:address`, ia-v3 §4.7, docs/design/visual-v4.md §6.8): how liquid the token is on
 * Base, where its liquidity sits and where its price comes from. The title section (back link,
 * "TOKEN", the symbol with its name, the answer at right), then the band with the depth butterfly
 * of the token's pools on its own scale (closed by "All of WETH"), the facts as an ink block over
 * the band's lower edge, the pools table sheet (`sort`, `dir`, `cols`, `rows` in the URL) and
 * about this token as a panel. A token of the stock list (`GET /api/stocks`) shows its price as
 * the valuation price, with the label of docs/design/stocks-api.md §3.
 */
import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useDataNow } from '../api/context.js'
import { ApiError } from '../api/errors.js'
import { useGaps, usePoolMetas, useStocks, useToken } from '../api/hooks.js'
import type { PoolMetaDto, TokenDetail } from '../api/types.js'
import type { ButterflyGap } from '../components/charts/DepthButterfly.js'
import { MEANINGFUL_GAP_TURNOVER } from '../components/charts/TurnoverGlyph.js'
import { BackLink } from '../components/ui/BackLink.js'
import { NotFoundState, SectionError, useDelayedPending } from '../components/ui/States.js'
import { isPoolId, tokenText } from '../lib/format.js'
import type { TableState } from '../lib/poolsTable.js'
import { cachedToken } from '../routeData.js'
import { TokenAbout } from './token/TokenAbout.js'
import { TokenBand } from './token/TokenBand.js'
import { TokenFacts } from './token/TokenFacts.js'
import { TokenPools } from './token/TokenPools.js'
import { TokenSkeleton } from './token/TokenSkeleton.js'
import { TokenTitle } from './token/TokenTitle.js'
import {
  readAllRows,
  readTableState,
  tokenQuery,
  writeAllRows,
  writeTableState,
} from './token/tokenSort.js'
import { orientPools, tokenAnswer } from './token/tokenText.js'
import './token/token.css'

/** The biggest meaningful gap (turnover ≥ 3×) among the token's pools, for the "Gap" marker. */
function useTokenGap(detail: TokenDetail | undefined): ButterflyGap | null {
  const gaps = useGaps({ limit: 200 })
  if (!detail) return null
  const mine = new Set(detail.pools.map((p) => p.pool.id))
  const best = (gaps.data?.items ?? [])
    .filter(
      (g) => mine.has(g.pool.pool.id) && (g.gap.turnoverRatio ?? 0) >= MEANINGFUL_GAP_TURNOVER,
    )
    .sort((a, b) => (b.gap.turnoverRatio ?? 0) - (a.gap.turnoverRatio ?? 0))[0]
  return best?.gap.turnoverRatio != null
    ? { poolId: best.pool.pool.id, turnoverRatio: best.gap.turnoverRatio }
    : null
}

function TokenView({
  detail,
  state,
  allRows,
  busy,
  onState,
  onAllRows,
}: {
  detail: TokenDetail
  state: TableState
  allRows: boolean
  busy: boolean
  onState: (next: TableState) => void
  onAllRows: (all: boolean) => void
}) {
  const now = useDataNow()
  const { token } = detail
  const pools = orientPools(detail.pools, token.address)
  const gap = useTokenGap(detail)
  const known = new Map<string, PoolMetaDto>(detail.pools.map((p) => [p.pool.id, p.pool]))
  const fetched = usePoolMetas(detail.via.filter((s) => isPoolId(s) && !known.has(s)))
  const metas = new Map([...known, ...fetched])
  const stocks = useStocks()
  const address = token.address.toLowerCase()
  const isStock = (stocks.data?.items ?? []).some(
    (s) => s.stock.token.address.toLowerCase() === address,
  )
  return (
    <div className="token">
      <title>{`${tokenText(token)} – Depthwatch`}</title>
      <TokenTitle
        token={token}
        answer={
          <p className="answer token-answer" data-rise="">
            {tokenAnswer(detail)}
          </p>
        }
      />
      <TokenBand symbol={tokenText(token)} pools={pools} gap={gap} />
      <TokenFacts detail={detail} metas={metas} stock={isStock} />
      {pools.length ? (
        <TokenPools
          pools={pools}
          symbol={tokenText(token)}
          totals={detail}
          state={state}
          allRows={allRows}
          busy={busy}
          now={now}
          onChange={onState}
          onAllRows={onAllRows}
        />
      ) : null}
      <div className="wrap">
        <TokenAbout detail={detail} metas={metas} now={now} />
      </div>
    </div>
  )
}

export function Token() {
  const { address = '' } = useParams()
  const normalized = address.toLowerCase()
  const [params, setParams] = useSearchParams()
  const state = readTableState(params)
  const allRows = readAllRows(params)
  const token = useToken(normalized, tokenQuery(state))
  const qc = useQueryClient()
  const showSkeleton = useDelayedPending(token.isPending)
  const onState = (next: TableState) =>
    setParams((prev) => writeTableState(prev, next), { replace: true })
  const onAllRows = (all: boolean) =>
    setParams((prev) => writeAllRows(prev, all), { replace: true })

  let content: ReactNode
  if (token.data) {
    content = (
      <TokenView
        detail={token.data}
        state={state}
        allRows={allRows}
        busy={token.isFetching && token.isPlaceholderData}
        onState={onState}
        onAllRows={onAllRows}
      />
    )
  } else if (
    token.isError &&
    token.error instanceof ApiError &&
    (token.error.status === 404 || token.error.status === 400)
  ) {
    content = (
      <NotFoundState
        title="token not found"
        message="Depthwatch has not seen this token in any pool it tracks, or the link is wrong. It covers the tokens of the pools it lists under Pools; whoever runs this site can add a token to its seed."
        id={normalized}
        links={{
          primary: { to: '/pools', label: 'Browse pools' },
          secondary: { to: '/methodology', label: 'How it is measured' },
        }}
      />
    )
  } else if (token.isError) {
    content = (
      <section className="wrap ttl token-ttl" aria-label="Token">
        <BackLink to="/pools" label="Pools" />
        <div className="token-error">
          <SectionError what="this token" onRetry={() => void token.refetch()} />
        </div>
      </section>
    )
  } else {
    // The symbol and name from a pool already loaded, so the title never waits (ST1).
    content = <TokenSkeleton visible={showSkeleton} token={cachedToken(qc, normalized)} />
  }
  return content
}
