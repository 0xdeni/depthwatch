/**
 * Coinbase Tokenized Stocks on Base mainnet and their Chainlink feeds. Source:
 * docs/research/base-contracts.md, `## stocks` (sources and verdicts) and §2.14 (the on-chain
 * check at block 53,663,272 and the feeds' round history). All lowercase. Each name is the token's
 * own `name()`.
 *
 * The ten tokens are the list of https://www.base.org/stocks, which calls itself "the full list";
 * the issuer's API returns more records (298, 71 minted at the time of the check), which are left
 * out until base.org lists them. Each token is a B20 Asset precompile with 8 decimals and a
 * multiplier (WAD: shares per token) that carries dividends and splits; balances never rebase.
 *
 * Not reference tokens: no USD anchor and no pricing hop, so they are absent from `TOKENS` and
 * `REFERENCE_TOKENS`. Discovery seeds them against the reference tokens only (`crossTokens`: each
 * stock paired with each reference token), never as a reference or a trade token. Not trade
 * tokens, permanently: Coinbase tokenized stocks are "only available to persons in eligible
 * jurisdictions outside of the U.S." (docs.base.org; base.org/stocks: Regulation S), so the swap
 * panel never offers them (`TRADE_TOKENS`, `TRADE_ROUTES`), and this module stays out of the
 * browser-safe `@depthwatch/chain/addresses` subpath.
 *
 * The feeds are read on chain only (`latestRoundData()` through the proxy, `eth_call`), to measure
 * how far each pool's price is from the stock's reference value; Depthwatch publishes that
 * deviation, never a price for others to settle on. A feed's answer is USD per token (the share
 * price times the token's multiplier, truncated to 8 decimals, §2.14), the unit of a pool's price:
 * the multiplier is never applied to it again. It holds its last value while US equity markets are
 * closed, through the weekly close from Friday 20:00 to Sunday 20:00 America/New_York (no update
 * in 15,903 rounds) and on holidays (`updatedAt` stops; no heartbeat off-hours).
 */
import type { Address, StockInfo, TokenInfo } from '@depthwatch/core'

const stock = (address: Address, symbol: string, name: string): TokenInfo =>
  Object.freeze({ address, symbol, name, decimals: 8 })

export const STOCK_TOKENS = Object.freeze({
  NVDAC: stock('0xb20000000000000000000078ee7ce2fe4908108c', 'NVDAc', 'NVIDIA Corporation'),
  METAC: stock('0xb2000000000000000000008bc8786b856e61707c', 'METAc', 'Meta Platforms Inc.'),
  AAPLC: stock('0xb200000000000000000000c2e324d24d7eecd1fb', 'AAPLc', 'Apple Inc.'),
  GOOGLC: stock('0xb2000000000000000000002d0ba3164cc74f58b7', 'GOOGLc', 'Alphabet Inc.'),
  AMZNC: stock('0xb200000000000000000000d9192b6b456483c2e8', 'AMZNc', 'Amazon.com Inc.'),
  MSFTC: stock('0xb200000000000000000000ab99cfa739e253872b', 'MSFTc', 'Microsoft Corporation'),
  MSTRC: stock('0xb2000000000000000000004884b426556b92883d', 'MSTRc', 'Strategy Inc.'),
  SNDKC: stock('0xb200000000000000000000397293cb8cda9a10c5', 'SNDKc', 'Sandisk Corporation'),
  SPCXC: stock(
    '0xb2000000000000000000007b9fcbd005511acbd5',
    'SPCXc',
    'Space Exploration Technologies Corp.',
  ),
  TSLAC: stock('0xb2000000000000000000001e800a7f5189430cd0', 'TSLAc', 'Tesla Inc.'),
} as const satisfies Record<string, TokenInfo>)

/** A stock's Chainlink "Coinbase <ticker>" feed: its proxy, read with `latestRoundData()`. */
export interface StockFeed {
  /** The proxy (not a token address). */
  feed: Address
  /** The ticker in the feed's `description()`, "Coinbase <ticker>": the token symbol less its "c". */
  ticker: string
  decimals: number
  /** Chainlink's heartbeat while the market is open; there is none off-hours. */
  heartbeatSeconds: number
  /**
   * The price move, in bps, that makes the feed publish a new round while the market is open, so
   * the market may move this far without one: 50 (0.5 %) for the ten, from Base's feed table
   * ("update on a 0.5% price deviation or a 24-hour heartbeat") and Chainlink's directory
   * (`threshold` 0.5), base-contracts.md `## stocks`.
   */
  deviationThresholdBps: number
  /**
   * '24/5': US equity sessions (regular, pre-market, post-market and overnight) from Sunday 20:00
   * to Friday 20:00 America/New_York, holding the last value through the weekly close and on
   * holidays. '24/7': no weekly close (none of the ten).
   */
  hours: '24/5' | '24/7'
}

const feed = (address: Address, ticker: string): StockFeed =>
  Object.freeze({
    feed: address,
    ticker,
    decimals: 8,
    heartbeatSeconds: 86_400,
    deviationThresholdBps: 50,
    hours: '24/5',
  })

/**
 * The feed of each stock token, keyed by the token's address. All ten are the 24/5 feeds that
 * docs.base.org lists (8 decimals, 0.5 % deviation threshold, 24 h heartbeat); the 24/7 variants
 * of the Chainlink directory are hidden there and absent from Base's docs, and are not used.
 */
export const STOCK_FEEDS: Readonly<Record<Address, StockFeed>> = Object.freeze({
  [STOCK_TOKENS.NVDAC.address]: feed('0x04689a41629776563e6822f76f2e57d148d28513', 'NVDA'),
  [STOCK_TOKENS.METAC.address]: feed('0x6526ae6797a76123638b863aee4dd27ba4e4b27d', 'META'),
  [STOCK_TOKENS.AAPLC.address]: feed('0x787f13dea48db0897cbcdd985de77809d837f988', 'AAPL'),
  [STOCK_TOKENS.GOOGLC.address]: feed('0x5bf49e0ffa937ce2fff033c739ad7c634c4d34f2', 'GOOGL'),
  [STOCK_TOKENS.AMZNC.address]: feed('0x06a8e4b3abb3b7543d8396fb2b763d22820cb295', 'AMZN'),
  [STOCK_TOKENS.MSFTC.address]: feed('0xeb10a6c9aa7e537aed766c08c35dae35b321b18c', 'MSFT'),
  [STOCK_TOKENS.MSTRC.address]: feed('0xb3ce282cd188b35da0e38d8bc7d58e33173d202a', 'MSTR'),
  [STOCK_TOKENS.SNDKC.address]: feed('0x388b0dc46c0fb05a74bee0994fa5b02c6fcca2ea', 'SNDK'),
  [STOCK_TOKENS.SPCXC.address]: feed('0x6a634b235903c4ad6376892180d6ff8612e3fa68', 'SPCX'),
  [STOCK_TOKENS.TSLAC.address]: feed('0xfaf869185383a24f8cb00e27bda6b63b9905dcb4', 'TSLA'),
})

/** The protocol contracts read alongside the stocks (base-contracts.md `## stocks`, §2.14). */
export const STOCK_PROTOCOL = Object.freeze({
  /**
   * B20 Factory precompile: `isB20(token)` (0xfa19b927). `eth_getCode` answers "0x" here, so a
   * code check cannot stand in for it; the tokens themselves answer the one byte 0xef.
   */
  b20Factory: '0xb20f000000000000000000000000000000000000',
  /**
   * B20 PolicyRegistry precompile: `isAuthorized(policyId, account)` for the transfer policy
   * (policy 5 for the ten, a BLOCKLIST).
   */
  policyRegistry: '0x8453000000000000000000000000000000000002',
  /**
   * Coinbase's oracle registry, which the feeds read: `getOracleParams(token)` (0xd4197e82) answers
   * (multiplier WAD, paused); a set pause freezes the feed.
   */
  oracleRegistry: '0x3f3e8cf41cdd3b1d118c16471ab0113dfddd5cad',
} as const satisfies Record<string, Address>)

/** Every stock token, in base.org's order. */
export const STOCK_TOKEN_LIST: readonly TokenInfo[] = Object.freeze(Object.values(STOCK_TOKENS))

/** Whether `address` (any case) is one of the stock tokens. */
export function isStockToken(address: string): boolean {
  return Object.hasOwn(STOCK_FEEDS, address.toLowerCase())
}

/**
 * Depthwatch's stock list: the stocks, each one's feed keyed by the token's address (a stock
 * without one reads `no-feed`), and the oracle registry whose `getOracleParams(token)` the feeds
 * read. The chain reader reads it (`createChainReader({ stocks })`, `ChainReader.readStocks`) and
 * the snapshot step stores it; tests inject synthetic stocks this way.
 */
export interface StockList {
  tokens: readonly TokenInfo[]
  feeds: Readonly<Record<Address, StockFeed>>
  oracleRegistry: Address
}

/** The ten stocks of base.org/stocks, their feeds and Coinbase's oracle registry. */
export const BASE_STOCKS: StockList = Object.freeze({
  tokens: STOCK_TOKEN_LIST,
  feeds: STOCK_FEEDS,
  oracleRegistry: STOCK_PROTOCOL.oracleRegistry,
})

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

function stockAddress(value: unknown, path: string): Address {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value))
    throw new TypeError(`stocks.${path}: expected a 20-byte hex address, got ${String(value)}`)
  return value.toLowerCase() as Address
}

/**
 * `list` with every address lowercased, frozen, as `resolveAddresses` treats `addresses`: a
 * malformed address, a token listed twice or a feed keyed by a token not on the list throws.
 */
export function resolveStockList(list: StockList): StockList {
  const tokens = list.tokens.map((t, i) =>
    Object.freeze({ ...t, address: stockAddress(t.address, `tokens[${i}].address`) }),
  )
  const listed = new Set(tokens.map((t) => t.address))
  if (listed.size !== tokens.length) throw new TypeError('stocks.tokens: a token is listed twice')
  const feeds: Record<Address, StockFeed> = {}
  for (const [key, feed] of Object.entries(list.feeds)) {
    const token = stockAddress(key, `feeds[${key}]`)
    if (!listed.has(token)) throw new TypeError(`stocks.feeds[${key}]: not a token of the list`)
    if (Object.hasOwn(feeds, token)) throw new TypeError(`stocks.feeds[${key}]: given twice`)
    feeds[token] = Object.freeze({ ...feed, feed: stockAddress(feed.feed, `feeds[${key}].feed`) })
  }
  return Object.freeze({
    tokens: Object.freeze(tokens),
    feeds: Object.freeze(feeds),
    oracleRegistry: stockAddress(list.oracleRegistry, 'oracleRegistry'),
  })
}

/**
 * The stock list as core's `StockInfo`, in list order, for `evaluateStockReading` and the stored
 * stock list: each feed with its proxy as `address`; a stock without a feed has `feed: null` and
 * the ticker its symbol less a trailing "c", as the feeds' tickers are.
 */
export function stockInfos(list: StockList): StockInfo[] {
  return list.tokens.map((token) => {
    const feed = list.feeds[token.address]
    if (feed === undefined) return { token, ticker: token.symbol.replace(/c$/, ''), feed: null }
    const { feed: address, ticker, decimals, heartbeatSeconds, deviationThresholdBps, hours } = feed
    return {
      token,
      ticker,
      feed: { address, decimals, heartbeatSeconds, deviationThresholdBps, hours },
    }
  })
}
