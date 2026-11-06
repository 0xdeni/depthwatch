/**
 * The Stocks list's rows (`/stocks`, docs/design/stocks-api.md §3), one per stock in the API's
 * order (deepest first, then ticker): the ticker linking to the stock's page (the row's one tab
 * stop, stretched over the row) with its name, the status in words and "Transfers paused" when so;
 * then Chainlink's answer with its age, the ±2 % buy and sell sides, the best $10K spread, the
 * deepest pool's deviation with its band, the depth share by DEX and the TVL with the pool count.
 * Every cell carries its own label (value first), so the row reads the same on a phone, where the
 * cells wrap into two columns, as on a desktop. An unknown figure is "—" with its reason (D6).
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { StockSummary } from '../../api/stockTypes.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { bps, count, NB, tokenText, usd } from '../../lib/format.js'
import {
  ageText,
  answerText,
  deviationNullDetail,
  deviationWords,
  REFERENCE_WORDS,
} from '../../lib/stockText.js'
import { StockStatus, TransfersPaused } from './StockStatus.js'
import { answerUnknown, depthUnknown, spreadUnknown, stockHref } from './stockPageText.js'
import { VenueBar } from './VenueBar.js'

/** The column names: the desktop header shows them once; on phones each cell carries its own. */
const COLUMNS = [
  'Stock',
  REFERENCE_WORDS,
  `Buy side ±2${NB}%`,
  `Sell side ±2${NB}%`,
  'Best $10K spread',
  'Deepest pool from the feed',
  'Depth by DEX',
  'TVL',
] as const

function Cell({
  value,
  col,
  note,
  className,
}: {
  value: ReactNode
  /** The column's index in `COLUMNS`. */
  col: number
  note?: string
  className?: string
}) {
  return (
    <div className={`stk-cell${className ? ` ${className}` : ''}`}>
      <span className="num stk-v">{value}</span>
      <span className="small faint stk-k">{COLUMNS[col]}</span>
      {note ? <span className="small faint">{note}</span> : null}
    </div>
  )
}

function money(v: number | null, reason: string) {
  return v === null ? <Unknown reason={reason} /> : usd(v)
}

function StockRow({ s }: { s: StockSummary }) {
  const { stock, reading } = s
  const symbol = tokenText(stock.token)
  const dev = deviationWords(s, stock.feed?.deviationThresholdBps ?? null)
  const venues = s.venues.some((v) => v.depthShare !== null && v.depthShare > 0)
  return (
    <li>
      <div className="rl-row stk-row">
        <div className="cell-pool stk-who">
          <Link
            className="pp rl-link"
            to={stockHref(stock.token.address)}
            aria-label={`${symbol}, ${stock.token.name}`}
          >
            {symbol}
          </Link>
          <span className="pd">{stock.token.name}</span>
          <span className="stk-chips">
            <StockStatus status={reading?.referenceStatus ?? null} />
            {reading?.transfersPaused === true ? <TransfersPaused /> : null}
          </span>
        </div>
        <Cell
          col={1}
          value={
            reading?.referenceUsd == null ? (
              <Unknown reason={answerUnknown(reading)} />
            ) : (
              answerText(reading)
            )
          }
          note={
            reading?.feedAgeSeconds == null ? undefined : `${ageText(reading.feedAgeSeconds)} old`
          }
        />
        {s.poolCount === 0 ? (
          <div className="stk-cell stk-none">
            <span className="num stk-v">
              <Unknown reason={depthUnknown(s)} />
            </span>
            <span className="small faint">
              No scored pool holds this stock: no depth, spread or deviation.
            </span>
          </div>
        ) : (
          <>
            <Cell col={2} value={money(s.depth2BuyUsd, depthUnknown(s))} />
            <Cell col={3} value={money(s.depth2SellUsd, depthUnknown(s))} />
            <Cell
              col={4}
              value={
                s.spread10kBps === null ? (
                  <Unknown reason={spreadUnknown(s)} />
                ) : (
                  bps(s.spread10kBps)
                )
              }
            />
            <Cell
              col={5}
              className="stk-dev"
              value={
                s.deviationBps === null ? (
                  <Unknown reason={deviationNullDetail(s.deviationNull ?? 'no-pool')} />
                ) : (
                  dev.value
                )
              }
              note={dev.words}
            />
            {venues ? (
              <div className="stk-cell stk-vcell">
                <span className="small faint stk-k">{COLUMNS[6]}</span>
                <VenueBar venues={s.venues} />
              </div>
            ) : (
              <Cell col={6} className="stk-vcell" value={<Unknown reason={depthUnknown(s)} />} />
            )}
            <Cell
              col={7}
              value={money(s.tvlUsd, 'No scored pool of this stock has a known TVL.')}
              note={`${count(s.poolCount)} ${s.poolCount === 1 ? 'pool' : 'pools'}`}
            />
          </>
        )}
      </div>
    </li>
  )
}

export function StockRows({ items }: { items: readonly StockSummary[] }) {
  return (
    <>
      {/* Each cell names its column for assistive tech; this header repeats them on desktop. */}
      <div className="stk-head" aria-hidden="true">
        {COLUMNS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <ol className="rowlist stk-list">
        {items.map((s) => (
          <StockRow key={s.stock.token.address} s={s} />
        ))}
      </ol>
    </>
  )
}
