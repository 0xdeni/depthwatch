/**
 * The sentences of the stock pages (docs/design/stocks-api.md §3): each page's answer, the reasons
 * behind an unknown figure, and where a stock's link goes. The words they share with every stock
 * surface (the eligibility line, the statuses, a deviation's band) are lib/stockText.ts.
 * Formatting only: every figure is the API's (core `summarizeStock`).
 */
import type { StockDetail, StockReadingDto, StockSummary } from '../../api/stockTypes.js'
import { count, NB, tokenText, usd } from '../../lib/format.js'
import { STATUS_WORD } from '../../lib/stockText.js'
import { METRICS_DOC } from '../Methodology.js'

/** METRICS.md's "Reference deviation" on GitHub, until the Methodology page has a section. */
export const DEVIATION_DOC = `${METRICS_DOC}#reference-deviation`

export function stockHref(address: string): string {
  return `/stocks/${address.toLowerCase()}`
}

const sidesTotal = (s: Pick<StockSummary, 'depth2BuyUsd' | 'depth2SellUsd'>) =>
  s.depth2BuyUsd === null || s.depth2SellUsd === null ? null : s.depth2BuyUsd + s.depth2SellUsd

/** `/stocks`: how many stocks, how many with pools, and the deepest in the API's order. */
export function stocksAnswer(items: readonly StockSummary[]): string {
  if (!items.length) return 'No tokenized stock is in the stock list yet.'
  const withPools = items.filter((s) => s.poolCount > 0).length
  const first = items[0]
  const depth = first ? sidesTotal(first) : null
  const head = `${count(items.length)} tokenized ${items.length === 1 ? 'stock' : 'stocks'}, ${
    withPools === items.length
      ? items.length === 1
        ? 'with scored pools'
        : 'all with scored pools'
      : `${count(withPools)} of them with scored pools`
  }.`
  if (!first || depth === null) return head
  return `${head} The deepest, ${tokenText(first.stock.token)}, holds ${usd(depth)} within 2${NB}% of its pools’ prices.`
}

/** `/stocks/:token`: the stock's two sides across its counted pools, or why there are none. */
export function stockAnswer(detail: StockDetail): string {
  const symbol = tokenText(detail.stock.token)
  if (detail.reading?.transfersPaused === true) {
    const pools = detail.poolCount === 1 ? 'its pool' : `its ${count(detail.poolCount)} pools`
    return `${symbol}’s transfers are paused: every swap in ${pools} reverts, so no depth of it counts.`
  }
  if (detail.poolCount === 0) return `Depthwatch scores no pool of ${symbol} yet.`
  if (detail.depth2BuyUsd === null || detail.depth2SellUsd === null) {
    return `None of ${symbol}’s ${count(detail.poolCount)} scored pools has both sides priced and counted.`
  }
  const pools = detail.sidesKnownPools
  return `${symbol}’s pools hold ${usd(detail.depth2BuyUsd)} on the buy side and ${usd(detail.depth2SellUsd)} on the sell side within 2${NB}% of their prices, across ${count(pools)} ${pools === 1 ? 'pool' : 'pools'}.`
}

/** Why a stock's ±2 % side or spread is "—". */
export function depthUnknown(s: StockSummary): string {
  if (s.reading?.transfersPaused === true) return 'Its transfers are paused: no pool counts.'
  if (s.poolCount === 0) return 'No scored pool holds this stock.'
  return 'No pool that counts has both sides priced.'
}

export function spreadUnknown(s: StockSummary): string {
  if (s.reading?.transfersPaused === true) return 'Its transfers are paused: no pool counts.'
  if (s.poolCount === 0) return 'No scored pool holds this stock.'
  return 'No pool that counts can absorb a $10K round trip.'
}

/** Why Chainlink's answer is not published. */
export function answerUnknown(reading: StockReadingDto | null): string {
  if (reading === null) return 'No reading is stored yet.'
  return `Not published while the reading is ${STATUS_WORD[reading.referenceStatus]}.`
}
