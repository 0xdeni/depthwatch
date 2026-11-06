/**
 * The Stock band (docs/design/stocks-api.md §3): the reference panel. Chainlink's answer, always
 * with its status and its age at the reading's block, then what that status means (a held feed:
 * "The feed holds its value from …"), the banner while the stock's transfers are paused, and the
 * eligibility line. `referenceUsd` is the feed's answer passed on as read, never a Depthwatch
 * price; no deviation is computed against a reading that is not live.
 */
import type { StockDetail } from '../../api/stockTypes.js'
import { Band } from '../../components/ui/Band.js'
import { Shape } from '../../components/ui/Icon.js'
import { group, tokenText } from '../../lib/format.js'
import {
  ageText,
  answerText,
  ELIGIBILITY_LINE,
  pausedBanner,
  REFERENCE_WORDS,
  statusExplanation,
} from '../../lib/stockText.js'
import { DEVIATION_DOC } from './stockPageText.js'

export function StockBand({ detail }: { detail: StockDetail }) {
  const { stock, reading } = detail
  const feedName = stock.feed ? `Coinbase ${stock.ticker} feed` : 'No feed'
  const at =
    reading === null
      ? null
      : `${reading.feedAgeSeconds === null ? 'Age unknown' : `${ageText(reading.feedAgeSeconds)} old`} at block ${group(reading.blockNumber)}`
  return (
    <Band
      label="Reference"
      className="stk-band"
      eyebrow={
        <>
          <span>{REFERENCE_WORDS}</span> <span>{feedName}</span>
        </>
      }
    >
      {reading?.transfersPaused === true ? (
        <p className="stk-banner" role="note" data-in="">
          <Shape shape="triangle" />
          <span>{pausedBanner(tokenText(stock.token))}</span>
        </p>
      ) : null}
      <div className="stk-ref" data-in="">
        <div className="stk-ref-main">
          <p className="figure num stk-ref-v">{answerText(reading)}</p>
          <p className="stk-ref-at">
            {at === null ? 'No reading yet' : `${REFERENCE_WORDS}, ${at}`}
          </p>
        </div>
        <div className="stk-ref-why">
          <p className="lead">{statusExplanation(reading, stock.feed)}</p>
          <p className="stk-elig small">{ELIGIBILITY_LINE}</p>
          <a className="plink touch-hit stk-doc" href={DEVIATION_DOC} rel="noopener">
            How a deviation is measured
          </a>
        </div>
      </div>
    </Band>
  )
}
