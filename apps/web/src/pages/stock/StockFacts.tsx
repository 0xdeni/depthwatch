/**
 * The Stock facts row (docs/design/stocks-api.md §3, after the Pool facts of
 * docs/design/visual-v4.md §5.6): one ink block over the band's lower edge, value first. The ±2 %
 * buy and sell sides summed over the pools that count, the best $10K round trip with its pool, and
 * the deepest pool's deviation from Chainlink's answer with its band. Under a rule, the
 * valuation-convention label: the dollars of depth and TVL rest on the price graph's price, which
 * is not a stock price. Unknown values are "—" with the reason (D6).
 */
import type { StockDetail, StockPoolRow } from '../../api/stockTypes.js'
import { Overlap } from '../../components/ui/Block.js'
import { Fact, FactsRow } from '../../components/ui/Fact.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { bps, count, dexLabel, NB, pairLabel, usd } from '../../lib/format.js'
import {
  DEVIATION_NULL_WORD,
  deviationNullDetail,
  deviationWords,
  VALUATION_LABEL,
} from '../../lib/stockText.js'
import { depthUnknown, spreadUnknown } from './stockPageText.js'

const rowOf = (pools: readonly StockPoolRow[], id: string | null) =>
  id === null ? undefined : pools.find((p) => p.pool.pool.id === id)

const where = (row: StockPoolRow | undefined) =>
  row
    ? `${pairLabel(row.pool.pool.token0, row.pool.pool.token1)}, ${dexLabel(row.pool.pool.dex)}`
    : null

/** The deepest pool's deviation with the band of that pool (both parts are in its reference). */
export function deepestDeviation(detail: StockDetail) {
  const deepest = rowOf(detail.pools, detail.deepestPoolId)
  const ref = deepest?.reference ?? null
  const threshold =
    ref === null ? (detail.stock.feed?.deviationThresholdBps ?? null) : ref.deviationThresholdBps
  return { words: deviationWords(detail, threshold, ref?.feeBps ?? null), pool: deepest }
}

export function StockFacts({ detail }: { detail: StockDetail }) {
  const counted = detail.sidesKnownPools
  const across =
    counted === 0 ? '' : `, across ${count(counted)} ${counted === 1 ? 'pool' : 'pools'}`
  const spreadPool = where(rowOf(detail.pools, detail.spread10kPoolId))
  const { words, pool } = deepestDeviation(detail)
  const deepest = where(pool)
  return (
    <Overlap label="Facts">
      <FactsRow label="Stock facts" className="stk-facts" note={VALUATION_LABEL}>
        <Fact
          value={
            detail.depth2BuyUsd === null ? (
              <Unknown reason={depthUnknown(detail)} />
            ) : (
              usd(detail.depth2BuyUsd)
            )
          }
          label={`buy side within 2${NB}%${across}`}
        />
        <Fact
          value={
            detail.depth2SellUsd === null ? (
              <Unknown reason={depthUnknown(detail)} />
            ) : (
              usd(detail.depth2SellUsd)
            )
          }
          label={`sell side within 2${NB}%${across}`}
        />
        <Fact
          value={
            detail.spread10kBps === null ? (
              <Unknown reason={spreadUnknown(detail)} />
            ) : (
              bps(detail.spread10kBps)
            )
          }
          label={spreadPool ? `best $10K round trip, in ${spreadPool}` : 'best $10K round trip'}
        />
        <Fact
          value={
            detail.deviationBps === null ? (
              <Unknown reason={deviationNullDetail(detail.deviationNull ?? 'no-pool')} />
            ) : (
              words.value
            )
          }
          label={
            detail.deviationBps === null
              ? `deepest pool from Chainlink’s answer: ${DEVIATION_NULL_WORD[detail.deviationNull ?? 'no-pool']}`
              : `${deepest ?? 'deepest pool'} from Chainlink’s answer, ${words.words}`
          }
        />
      </FactsRow>
    </Overlap>
  )
}
