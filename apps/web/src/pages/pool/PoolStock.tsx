/**
 * "tokenized stock": the first row of a stock pool's sections sheet (`latest.reference !== null`,
 * docs/design/stocks-api.md §3). The finding is the pool's deviation from the stock's Chainlink
 * answer with its band, or the reason there is none; the body names the stock (a link to its
 * page), Chainlink's answer with its status and its age, the pool's own mid in dollars and the
 * stock's valuation price with its label, then the eligibility line. A stock pool's page has no
 * swap section: `tradeGate` needs both tokens on the trade allowlist, which no stock is on.
 */
import { Link } from 'react-router-dom'
import type { PoolDetail } from '../../api/types.js'
import { Section } from '../../components/ui/Section.js'
import { bps, DASH, price, tokenText } from '../../lib/format.js'
import {
  ageText,
  DEVIATION_NULL_WORD,
  deviationNullDetail,
  deviationWords,
  ELIGIBILITY_LINE,
  REFERENCE_WORDS,
  STATUS_WORD,
  signedBps,
  VALUATION_LABEL,
} from '../../lib/stockText.js'

const stockHref = (address: string) => `/stocks/${address.toLowerCase()}`

/** The finding: "+25.06 bps from Chainlink’s answer, within the feed’s 0.5 % band plus …". */
export function stockTakeaway(detail: PoolDetail): string | null {
  const ref = detail.latest?.reference
  if (!ref) return null
  if (ref.deviationBps === null) {
    return `No deviation from ${REFERENCE_WORDS}: ${deviationNullDetail(ref.deviationNull ?? 'unread')}`
  }
  const w = deviationWords(ref, ref.deviationThresholdBps, ref.feeBps)
  return `${w.value} from ${REFERENCE_WORDS}, ${w.words}.`
}

export function StockSection({ detail }: { detail: PoolDetail }) {
  const { pool, latest } = detail
  const ref = latest?.reference
  if (!latest || !ref) return null
  const stock = [pool.token0, pool.token1].find(
    (t) => t.address.toLowerCase() === ref.stock.toLowerCase(),
  )
  const isToken0 = pool.token0.address.toLowerCase() === ref.stock.toLowerCase()
  const valuation = isToken0 ? latest.token0Usd : latest.token1Usd
  const status = STATUS_WORD[ref.referenceStatus]
  const age = ref.feedAgeSeconds === null ? '' : `, ${ageText(ref.feedAgeSeconds)} old`
  const answer = ref.referenceUsd === null ? DASH : `$${price(ref.referenceUsd)}`
  return (
    <Section id="s-stock" title="tokenized stock" takeaway={stockTakeaway(detail)}>
      <dl className="about is-one-col">
        <div>
          <dt>Stock</dt>
          <dd>
            <Link className="tlink" to={stockHref(ref.stock)}>
              {stock ? tokenText(stock) : ref.stock}
            </Link>
            {ref.transfersPaused === true ? <span>Transfers paused</span> : null}
          </dd>
        </div>
        <div>
          <dt>{REFERENCE_WORDS}</dt>
          <dd>{`${answer}, ${status}${age}`}</dd>
        </div>
        <div>
          <dt>This pool’s mid</dt>
          <dd>{ref.poolUsd === null ? DASH : `$${price(ref.poolUsd)}`}</dd>
        </div>
        <div>
          <dt>Deviation</dt>
          <dd>
            {ref.deviationBps === null
              ? `${DASH}, ${DEVIATION_NULL_WORD[ref.deviationNull ?? 'unread']}`
              : `${signedBps(ref.deviationBps)}${ref.toleranceBps === null ? '' : `, band ${bps(ref.toleranceBps)}`}`}
          </dd>
        </div>
        <div>
          <dt>Valuation price</dt>
          <dd>
            {valuation === null ? DASH : `$${price(valuation)}`}
            <span className="about-note">{VALUATION_LABEL}</span>
          </dd>
        </div>
      </dl>
      <p className="small muted pool-elig">{ELIGIBILITY_LINE}</p>
    </Section>
  )
}
