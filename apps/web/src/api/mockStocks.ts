/**
 * The mock's tokenized stocks (docs/design/stocks-api.md §3), built from `mockStockSeeds.ts`: seven
 * synthetic stocks at `0xb2…` with their readings judged by core's `evaluateStockReading`, and seven
 * stock pools built like every mock pool (`buildPool`), each with the reference core's
 * `poolReference` computes, answered with the API's orders and errors. The stocks cover every
 * status:
 * - NVDAc, live ($199.50, 30 min old): an Aero Slipstream USDC pool at +25.06 bps, within the
 *   feed's 0.5 % band plus its 0.05 % fee; a Uniswap v3 WETH pool at −125.31 bps, outside 80; a
 *   Uniswap v4 USDC pool too thin to compare (docs/METRICS.md's examples).
 * - AMZNc, held (its round is 100,000 s old): a USDC pool, and a cbBTC pool where it is token0.
 * - TSLAc, live with its transfers paused: one pool, unrated `transfers-paused`, in no sum.
 * - AAPLc, paused by the oracle registry: one pool, no deviation (`paused`).
 * - METAc (invalid: the wrong description), MSFTc (unread) and COINc (no feed): no pool.
 *
 * The stock pools answer `pool`, `history` and their stocks' `token` and stock routes; they stay
 * out of the generic lists (`pools`, `stats`, `gaps`, the quote tokens' pages), so every figure of
 * the mock world that the other pages pin is unchanged.
 */
import {
  type Address,
  countsInStockSums,
  type PoolReference,
  poolReference,
  type StockEntry,
  type StockPoolInput,
  stockSides,
  summarizeStock,
  toJsonSafe,
} from '@depthwatch/core'
import { ApiError } from './errors.js'
import { buildPool, LATEST_BLOCK, type MockPool, summarize, tokenInfo } from './mockPools.js'
import { POOL_SEEDS, SPECS, STOCK_TOKENS } from './mockStockSeeds.js'
import type { StockDetail, StockPoolRow, StockSummary } from './stockTypes.js'
import type { PoolSummary } from './types.js'

export { MOCK_STOCK_POOLS, STOCK_TOKENS, stockTokenKey } from './mockStockSeeds.js'

const ADDRESS_RE = /^0x[0-9a-f]{40}$/

const lower = (a: string) => a.toLowerCase() as Address
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
function byKnownDesc(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}
const total = (buy: number | null, sell: number | null) =>
  buy === null || sell === null ? null : buy + sell
const thinner = (r: StockPoolRow) =>
  r.depth2BuyUsd === null || r.depth2SellUsd === null
    ? null
    : Math.min(r.depth2BuyUsd, r.depth2SellUsd)

/** The mock's stock world at `now`: every stock, its reading and its pools, as the API builds them. */
export function createStockWorld(now: number) {
  const block = { blockNumber: BigInt(LATEST_BLOCK), timestamp: now }
  const entries = new Map<Address, StockEntry & { usd: number }>(
    SPECS.map((s) => [
      lower(s.info.token.address),
      { info: s.info, reading: s.read(now, block), usd: s.usd },
    ]),
  )
  const pools: MockPool[] = POOL_SEEDS.map((seed) => {
    const symbols = [seed.token0, seed.token1]
    const paused = [...entries.values()].some(
      (e) => symbols.includes(e.info.token.symbol) && e.reading.transfersPaused === true,
    )
    const p = buildPool(seed, now, { tokens: STOCK_TOKENS, transfersPaused: paused })
    const level = p.snapshot.depthUsd.find((l) => l.pct === 2)
    const reference = poolReference({
      pool: { token0: p.meta.token0, token1: p.meta.token1, hooks: p.meta.hooks },
      price: p.snapshot.price,
      token0Usd: p.snapshot.token0Usd,
      token1Usd: p.snapshot.token1Usd,
      depth2UpUsd: level?.upUsd ?? null,
      depth2DownUsd: level?.downUsd ?? null,
      feePips: p.snapshot.feePips,
      quoteIndependent: true,
      stocks: entries,
    })
    return { ...p, snapshot: { ...p.snapshot, reference } }
  })
  const byId = new Map(pools.map((p) => [p.meta.id, p]))
  const summaries = pools.map(summarize)

  function poolsOf(token: Address): { summary: PoolSummary; input: StockPoolInput }[] {
    return summaries
      .filter(
        (s) => lower(s.pool.token0.address) === token || lower(s.pool.token1.address) === token,
      )
      .map((summary) => {
        const reference: PoolReference | null =
          byId.get(summary.pool.id)?.snapshot.reference ?? null
        const input: StockPoolInput = {
          poolId: summary.pool.id,
          dex: summary.pool.dex,
          token0: lower(summary.pool.token0.address),
          token1: lower(summary.pool.token1.address),
          tvlUsd: summary.tvlUsd,
          depth2UpUsd: summary.depth2UpUsd,
          depth2DownUsd: summary.depth2DownUsd,
          spread10kBps: summary.spread10kBps,
          staleQuote: summary.staleQuote,
          volume24hUsd: summary.volume24hUsd,
          reference,
        }
        return { summary, input }
      })
  }

  function summaryOf(token: Address): StockSummary {
    const entry = entries.get(token)
    if (!entry) throw new ApiError(404, 'stock not found')
    const { token: _token, ...aggregate } = summarizeStock(
      token,
      poolsOf(token).map((p) => p.input),
    )
    const { info } = entry
    return {
      stock: {
        token: tokenInfo(info.token.symbol, STOCK_TOKENS),
        ticker: info.ticker,
        feed: info.feed,
      },
      reading: toJsonSafe(entry.reading),
      ...aggregate,
      updatedAt: now,
    }
  }

  function rowsOf(token: Address): StockPoolRow[] {
    return poolsOf(token)
      .map(({ summary, input }): StockPoolRow => {
        const { buyUsd, sellUsd } = stockSides(
          token,
          input.token0,
          input.depth2UpUsd,
          input.depth2DownUsd,
        )
        return {
          pool: summary,
          stockIs: input.token0 === token ? 'token0' : 'token1',
          depth2BuyUsd: buyUsd,
          depth2SellUsd: sellUsd,
          counted: countsInStockSums(input),
          reference: input.reference,
        }
      })
      .sort(
        (a, b) =>
          (a.counted === b.counted ? 0 : a.counted ? -1 : 1) ||
          byKnownDesc(thinner(a), thinner(b)) ||
          byText(a.pool.pool.id, b.pool.pool.id),
      )
  }

  return {
    pools: byId,
    /** The pools of a stock token, for its token page; undefined for any other token. */
    tokenPools(address: string): PoolSummary[] | undefined {
      const token = lower(address)
      return entries.has(token) ? poolsOf(token).map((p) => p.summary) : undefined
    },
    stocks(): { items: StockSummary[] } {
      const items = [...entries.keys()].map(summaryOf)
      items.sort(
        (a, b) =>
          byKnownDesc(
            total(a.depth2BuyUsd, a.depth2SellUsd),
            total(b.depth2BuyUsd, b.depth2SellUsd),
          ) ||
          byText(a.stock.ticker, b.stock.ticker) ||
          byText(a.stock.token.address, b.stock.token.address),
      )
      return { items }
    },
    stock(address: string): StockDetail {
      const token = address.trim().toLowerCase()
      if (!ADDRESS_RE.test(token)) {
        throw new ApiError(400, 'invalid token address: expected 0x + 40 hex chars')
      }
      return { ...summaryOf(token as Address), pools: rowsOf(token as Address) }
    },
  }
}
