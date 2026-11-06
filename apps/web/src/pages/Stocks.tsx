/**
 * Stocks (`/stocks`, docs/design/stocks-api.md §3): "How liquid is each tokenized stock on Base,
 * and how far are its pools from its Chainlink feed?" The title section (eyebrow, the lowercase
 * title "stocks" and the answer at its right), the band with the eligibility line and the link to
 * the definition of a deviation, then one block over the band's lower edge: a caption with the
 * count and the valuation-convention label, and one row per stock in the API's order. Depthwatch
 * measures these markets only: no row or link offers, routes or recommends a trade.
 */
import type { ReactNode } from 'react'
import { useStocks } from '../api/hooks.js'
import { Band } from '../components/ui/Band.js'
import { Overlap } from '../components/ui/Block.js'
import {
  EmptyState,
  SectionError,
  Skeleton,
  SkeletonGroup,
  useDelayedPending,
} from '../components/ui/States.js'
import { count } from '../lib/format.js'
import { ELIGIBILITY_LINE, VALUATION_LABEL } from '../lib/stockText.js'
import { StockRows } from './stock/StockRows.js'
import { DEVIATION_DOC, stocksAnswer } from './stock/stockPageText.js'
import './stock/stock.css'

export function Stocks() {
  const stocks = useStocks()
  const waiting = useDelayedPending(stocks.isPending)
  const items = stocks.data?.items

  let body: ReactNode
  if (stocks.isError) {
    body = (
      <div className="blk blk--over" data-over="">
        <SectionError what="stocks" onRetry={() => void stocks.refetch()} />
      </div>
    )
  } else if (!items) {
    body = (
      <div className="blk blk--over" data-over="" aria-busy="true">
        <SkeletonGroup label="Loading stocks" hidden={!waiting}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={88} />
          ))}
        </SkeletonGroup>
      </div>
    )
  } else if (!items.length) {
    body = (
      <div className="blk blk--over" data-over="">
        <EmptyState>
          No tokenized stock is stored yet: the stock list is written by the first snapshot pass.
        </EmptyState>
      </div>
    )
  } else {
    body = (
      <div className="blk blk--over" data-over="">
        <p className="tbl-caption stk-caption">
          <span>
            {count(items.length)} {items.length === 1 ? 'stock' : 'stocks'}
          </span>
          <span>{VALUATION_LABEL}</span>
        </p>
        <StockRows items={items} />
      </div>
    )
  }

  return (
    <div className="stk">
      <title>Stocks – Depthwatch</title>
      <section className="wrap ttl" aria-labelledby="stk-title">
        <p className="eyebrow eb-row" data-in="">
          <span>Stocks</span> <span>Tokenized stocks on Base</span>
        </p>
        <div className="ttl-grid">
          <h1 className="title" id="stk-title" data-rise="">
            stocks
          </h1>
          {items ? (
            <p className="answer" data-rise="">
              {stocksAnswer(items)}
            </p>
          ) : stocks.isError ? null : (
            <SkeletonGroup label="Loading the answer" hidden={!waiting} className="stk-skel-answer">
              <Skeleton height="1.08em" width="90%" />
              <Skeleton height="1.08em" width="60%" />
            </SkeletonGroup>
          )}
        </div>
      </section>
      <Band label="Who these markets are for" className="stk-band">
        <div className="stk-lead-row">
          <p className="lead stk-elig" data-in="">
            {ELIGIBILITY_LINE}
          </p>
          <a className="plink touch-hit" href={DEVIATION_DOC} rel="noopener" data-in="">
            How a deviation is measured
          </a>
        </div>
      </Band>
      <Overlap label="Stocks">{body}</Overlap>
    </div>
  )
}
