/**
 * The Stock title section (docs/design/stocks-api.md §3, after the Token title of
 * docs/design/visual-v4.md §6.8): the back link to Stocks, the eyebrow "Tokenized stock", then from
 * 1024 px two columns: the token's symbol as the h1, its name and the status chips under it at
 * left, the answer sentence at right. The chips say the reading's status in words and, while the
 * stock's transfers are paused, "Transfers paused".
 */
import type { ReactNode } from 'react'
import type { StockSummary } from '../../api/stockTypes.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { tokenText } from '../../lib/format.js'
import { StockStatus, TransfersPaused } from './StockStatus.js'

export function StockTitle({
  stock,
  reading,
  answer,
}: {
  stock: StockSummary['stock']
  /** Null while the page loads from the list's cache, or before the first reading. */
  reading: StockSummary['reading'] | undefined
  answer: ReactNode
}) {
  return (
    <section className="wrap ttl stk-ttl" aria-labelledby="stk-title">
      <div data-in="">
        <BackLink to="/stocks" label="Stocks" />
      </div>
      <p className="eyebrow eb-row stk-eb" data-in="">
        <span>Tokenized stock</span> <span>{stock.ticker}</span>
      </p>
      <div className="ttl-grid">
        <div className="stk-ttl-main">
          <h1 className="title stk-title" id="stk-title" data-rise="">
            {tokenText(stock.token)}
          </h1>
          <p className="stk-name" data-in="">
            {stock.token.name}
          </p>
          {reading !== undefined ? (
            <p className="stk-chips is-title" data-in="">
              <StockStatus status={reading?.referenceStatus ?? null} chip />
              {reading?.transfersPaused === true ? <TransfersPaused chip /> : null}
            </p>
          ) : null}
        </div>
        {answer}
      </div>
    </section>
  )
}
