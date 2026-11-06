/**
 * Stock (`/stocks/:token`, docs/design/stocks-api.md §3): "How liquid is this tokenized stock on
 * Base, where does its depth sit, and how far are its pools from its Chainlink feed?" The title
 * section (back link, eyebrow, the symbol with its name and status chips, the answer at right),
 * the band with the reference panel (Chainlink's answer with its status and age, what the status
 * means, the paused-transfers banner and the eligibility line), the facts row over the band's
 * lower edge, the sections sheet (venues, pools) and about this stock as a panel. Every number is
 * the API's; nothing here offers, routes or recommends a trade.
 */
import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useDataNow } from '../api/context.js'
import { ApiError } from '../api/errors.js'
import { useStock } from '../api/hooks.js'
import type { StockDetail } from '../api/stockTypes.js'
import { BackLink } from '../components/ui/BackLink.js'
import { SectionsSheet } from '../components/ui/Section.js'
import {
  NotFoundState,
  SectionError,
  Skeleton,
  SkeletonGroup,
  useDelayedPending,
} from '../components/ui/States.js'
import { tokenText } from '../lib/format.js'
import { cachedStock } from '../routeData.js'
import { StockAbout } from './stock/StockAbout.js'
import { StockBand } from './stock/StockBand.js'
import { StockFacts } from './stock/StockFacts.js'
import { PoolsSection, VenuesSection } from './stock/StockSections.js'
import { StockTitle } from './stock/StockTitle.js'
import { stockAnswer } from './stock/stockPageText.js'
import './stock/stock.css'

function StockView({ detail }: { detail: StockDetail }) {
  const now = useDataNow()
  return (
    <div className="stk">
      <title>{`${tokenText(detail.stock.token)} – Depthwatch`}</title>
      <StockTitle
        stock={detail.stock}
        reading={detail.reading}
        answer={
          <p className="answer stk-answer" data-rise="">
            {stockAnswer(detail)}
          </p>
        }
      />
      <StockBand detail={detail} />
      <StockFacts detail={detail} />
      <div className="wrap stk-rest">
        <SectionsSheet>
          <VenuesSection detail={detail} />
          <PoolsSection detail={detail} />
        </SectionsSheet>
        <StockAbout detail={detail} now={now} />
      </div>
    </div>
  )
}

export function Stock() {
  const { token = '' } = useParams()
  const address = token.toLowerCase()
  const stock = useStock(address)
  const qc = useQueryClient()
  const showSkeleton = useDelayedPending(stock.isPending)

  let content: ReactNode
  if (stock.data) {
    content = <StockView detail={stock.data} />
  } else if (
    stock.isError &&
    stock.error instanceof ApiError &&
    (stock.error.status === 404 || stock.error.status === 400)
  ) {
    content = (
      <NotFoundState
        title="stock not found"
        message="This address is not a stock of Depthwatch’s stock list, or the link is wrong. The list holds the tokenized stocks of base.org/stocks; a stock is identified by its address, never by its symbol."
        id={address}
        links={{
          primary: { to: '/stocks', label: 'Browse stocks' },
          secondary: { to: '/methodology', label: 'How it is measured' },
        }}
      />
    )
  } else if (stock.isError) {
    content = (
      <section className="wrap ttl stk-ttl" aria-label="Stock">
        <BackLink to="/stocks" label="Stocks" />
        <div className="stk-error">
          <SectionError what="this stock" onRetry={() => void stock.refetch()} />
        </div>
      </section>
    )
  } else {
    // The symbol and name from the stocks list already loaded, so the title never waits (ST1).
    const cached = cachedStock(qc, address)
    content = cached ? (
      <StockTitle
        stock={cached.stock}
        reading={cached.reading}
        answer={
          <SkeletonGroup
            label="Loading the answer"
            hidden={!showSkeleton}
            className="stk-skel-answer"
          >
            <Skeleton height="1.08em" width="90%" />
            <Skeleton height="1.08em" width="60%" />
          </SkeletonGroup>
        }
      />
    ) : (
      <section className="wrap ttl stk-ttl" aria-label="Stock">
        <BackLink to="/stocks" label="Stocks" />
        <SkeletonGroup label="Loading the stock" hidden={!showSkeleton} className="stk-skel-title">
          <Skeleton height={40} width="40%" />
          <Skeleton height={24} width="60%" />
        </SkeletonGroup>
      </section>
    )
  }
  return content
}
