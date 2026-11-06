/**
 * stocks.ts against docs/research/base-contracts.md (`## stocks`, §2.14) and against the
 * reference and trade token lists of addresses.ts: the stock tokens are neither.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { b20Abi } from './abi/b20.js'
import { chainlinkFeedAbi } from './abi/chainlinkFeed.js'
import { coinbaseOracleRegistryAbi } from './abi/coinbaseOracleRegistry.js'
import {
  BASE_ADDRESSES,
  REFERENCE_TOKENS,
  TOKENS,
  TRADE_ROUTES,
  TRADE_TOKENS,
} from './addresses.js'
import * as addressesExport from './addressesExport.js'
import {
  BASE_STOCKS,
  isStockToken,
  resolveStockList,
  STOCK_FEEDS,
  STOCK_PROTOCOL,
  STOCK_TOKEN_LIST,
  STOCK_TOKENS,
  stockInfos,
} from './stocks.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DOC = readFileSync(join(ROOT, 'docs', 'research', 'base-contracts.md'), 'utf8')
const STOCKS_SECTION = DOC.slice(DOC.indexOf('\n## stocks\n'), DOC.indexOf('\n## Open items'))
const CHECK_SECTION = DOC.slice(DOC.indexOf('\n### 2.14 '), DOC.indexOf('\n## 3. '))
const LOWER = /^0x[0-9a-f]{40}$/

const tokens = Object.values(STOCK_TOKENS)
const feeds = Object.values(STOCK_FEEDS)
const protocol: string[] = Object.values(STOCK_PROTOCOL)

describe('STOCK_TOKENS', () => {
  it("lists base.org's ten tokens: lowercase, unique, 8 decimals, B20 Asset addresses", () => {
    expect(tokens).toHaveLength(10)
    expect(STOCK_TOKEN_LIST).toEqual(tokens)
    const addresses = tokens.map((t) => t.address)
    expect(new Set(addresses).size).toBe(addresses.length)
    expect(new Set(tokens.map((t) => t.symbol)).size).toBe(tokens.length)
    for (const t of tokens) {
      expect(t.address).toMatch(LOWER)
      // B20: byte 0 is 0xb2, byte 10 the variant (Asset 0x00).
      expect(t.address.slice(2, 4)).toBe('b2')
      expect(t.address.slice(22, 24)).toBe('00')
      expect(t.decimals).toBe(8)
      expect(t.symbol).toMatch(/^[A-Z]+c$/)
      expect(t.name.length).toBeGreaterThan(0)
    }
  })

  it('is frozen', () => {
    expect(Object.isFrozen(STOCK_TOKENS)).toBe(true)
    expect(Object.isFrozen(STOCK_TOKEN_LIST)).toBe(true)
    for (const t of tokens) expect(Object.isFrozen(t)).toBe(true)
  })

  it('shares no address with the reference tokens or the trade allowlist', () => {
    const reference = new Set(REFERENCE_TOKENS.map((t) => t.address))
    const trade = new Set(TRADE_TOKENS.map((t) => t.address))
    for (const t of tokens) {
      expect(reference.has(t.address)).toBe(false)
      expect(trade.has(t.address)).toBe(false)
    }
    expect(BASE_ADDRESSES.referenceTokens.some((t) => isStockToken(t.address))).toBe(false)
    expect(Object.values(TOKENS).some((t) => isStockToken(t.address))).toBe(false)
  })

  it('stays out of the browser-safe subpath and the trade routes', () => {
    expect('STOCK_TOKENS' in addressesExport).toBe(false)
    expect('STOCK_FEEDS' in addressesExport).toBe(false)
    expect('BASE_STOCKS' in addressesExport).toBe(false)
    const routed = new Set<string>(TRADE_ROUTES.flatMap((r) => [r.factory, r.router, r.quoter]))
    for (const a of [...tokens.map((t) => t.address), ...feeds.map((f) => f.feed), ...protocol])
      expect(routed.has(a)).toBe(false)
  })

  it('isStockToken matches any case and nothing else', () => {
    expect(isStockToken(STOCK_TOKENS.NVDAC.address.toUpperCase().replace('0X', '0x'))).toBe(true)
    expect(isStockToken(TOKENS.USDC.address)).toBe(false)
    expect(isStockToken(STOCK_FEEDS[STOCK_TOKENS.NVDAC.address]!.feed)).toBe(false)
    expect(isStockToken('toString')).toBe(false)
  })
})

describe('STOCK_FEEDS', () => {
  it('gives every stock token one feed, and nothing else', () => {
    expect(Object.keys(STOCK_FEEDS).sort()).toEqual(tokens.map((t) => t.address).sort())
    expect(Object.isFrozen(STOCK_FEEDS)).toBe(true)
  })

  it('names the token: the ticker is the symbol less its trailing c', () => {
    for (const t of tokens) {
      const f = STOCK_FEEDS[t.address]!
      expect(f.ticker).toBe(t.symbol.slice(0, -1))
      expect(Object.isFrozen(f)).toBe(true)
    }
  })

  it('holds lowercase, unique proxies that are not token or protocol addresses', () => {
    const proxies = feeds.map((f) => f.feed)
    expect(new Set(proxies).size).toBe(proxies.length)
    const others = new Set<string>([
      ...tokens.map((t) => t.address),
      ...REFERENCE_TOKENS.map((t) => t.address),
      ...protocol,
    ])
    for (const p of proxies) {
      expect(p).toMatch(LOWER)
      expect(p.startsWith('0xb2')).toBe(false)
      expect(others.has(p)).toBe(false)
    }
  })

  it('records the documented 24/5 configuration: 8 decimals, 86,400 s heartbeat, 50 bps', () => {
    for (const f of feeds) {
      expect(f.decimals).toBe(8)
      expect(f.heartbeatSeconds).toBe(86_400)
      expect(f.deviationThresholdBps).toBe(50)
      expect(f.hours).toBe('24/5')
    }
  })

  it('carries no unit basis or multiplier: every answer is USD per token', () => {
    for (const f of feeds)
      expect(Object.keys(f).sort()).toEqual([
        'decimals',
        'deviationThresholdBps',
        'feed',
        'heartbeatSeconds',
        'hours',
        'ticker',
      ])
  })
})

describe('STOCK_PROTOCOL', () => {
  it('holds lowercase, unique addresses, frozen', () => {
    expect(Object.isFrozen(STOCK_PROTOCOL)).toBe(true)
    expect(new Set(protocol).size).toBe(protocol.length)
    for (const a of protocol) expect(a).toMatch(LOWER)
  })
})

describe('BASE_STOCKS', () => {
  it('is the ten tokens, their feeds and the oracle registry, frozen and already resolved', () => {
    expect(BASE_STOCKS.tokens).toBe(STOCK_TOKEN_LIST)
    expect(BASE_STOCKS.feeds).toBe(STOCK_FEEDS)
    expect(BASE_STOCKS.oracleRegistry).toBe(STOCK_PROTOCOL.oracleRegistry)
    expect(Object.isFrozen(BASE_STOCKS)).toBe(true)
    expect(resolveStockList(BASE_STOCKS)).toEqual(BASE_STOCKS)
  })

  it("maps to core's StockInfo with each feed's proxy as its address", () => {
    const infos = stockInfos(BASE_STOCKS)
    expect(infos.map((s) => s.token)).toEqual(STOCK_TOKEN_LIST)
    const nvda = STOCK_FEEDS[STOCK_TOKENS.NVDAC.address]
    expect(infos[0]).toEqual({
      token: STOCK_TOKENS.NVDAC,
      ticker: 'NVDA',
      feed: {
        address: nvda?.feed,
        decimals: 8,
        heartbeatSeconds: 86_400,
        deviationThresholdBps: 50,
        hours: '24/5',
      },
    })
    for (const info of infos) expect(info.feed?.address).toBe(STOCK_FEEDS[info.token.address]?.feed)
  })
})

describe('stock ABIs', () => {
  const selector = (abi: readonly { type: string; name: string }[], name: string) => {
    const item = abi.find((i) => i.type === 'function' && i.name === name)
    if (item === undefined) throw new Error(`no function ${name}`)
    return toFunctionSelector(item as Parameters<typeof toFunctionSelector>[0])
  }

  it('pins the selectors read on chain in §2.14 and the feed interface', () => {
    const read = {
      multiplier: selector(b20Abi, 'multiplier'),
      pausedFeatures: selector(b20Abi, 'pausedFeatures'),
      getOracleParams: selector(coinbaseOracleRegistryAbi, 'getOracleParams'),
    }
    expect(read).toEqual({
      multiplier: '0x1b3ed722',
      pausedFeatures: '0xde9997e3',
      getOracleParams: '0xd4197e82',
    })
    for (const name of Object.keys(read)) expect(CHECK_SECTION).toContain(`${name}(`)
    for (const sel of Object.values(read)) expect(CHECK_SECTION).toContain(`(${sel})`)
    expect(
      ['latestRoundData', 'decimals', 'description'].map((n) => selector(chainlinkFeedAbi, n)),
    ).toEqual(['0xfeaf968c', '0x313ce567', '0x7284e416'])
  })

  it('reads only view functions', () => {
    for (const abi of [b20Abi, chainlinkFeedAbi, coinbaseOracleRegistryAbi])
      for (const item of abi)
        expect(item).toMatchObject({ type: 'function', stateMutability: 'view' })
  })
})

describe('base-contracts.md', () => {
  it('records every address in `## stocks` and in the on-chain check of §2.14', () => {
    expect(STOCKS_SECTION.length).toBeGreaterThan(0)
    expect(CHECK_SECTION.length).toBeGreaterThan(0)
    const stocks = STOCKS_SECTION.toLowerCase()
    const check = CHECK_SECTION.toLowerCase()
    for (const a of [...tokens.map((t) => t.address), ...feeds.map((f) => f.feed), ...protocol]) {
      expect(stocks).toContain(a)
      expect(check).toContain(a)
    }
  })

  it("records each token's own name() and symbol", () => {
    for (const t of tokens) {
      expect(CHECK_SECTION).toContain(`'${t.name}'`)
      expect(STOCKS_SECTION).toContain(t.symbol)
    }
  })

  it("records the sources of the feeds' deviation threshold", () => {
    const flat = STOCKS_SECTION.replace(/\s+/g, ' ')
    expect(flat).toContain('update on a 0.5% price deviation or a 24-hour heartbeat')
    expect(flat).toContain('`threshold` 0.5')
    expect(flat).toContain('`deviationThresholdBps` 50')
  })

  it("records the feeds' round history that the off-hours rule rests on", () => {
    const flat = CHECK_SECTION.replace(/\s+/g, ' ')
    expect(flat).toContain('**Feed round history.**')
    expect(flat).toContain('15,903 rounds')
    expect(flat).toContain('the longest is 86,418 s')
    expect(flat).toContain('every gap is at least 172,968 s')
    expect(flat).toContain('2,259 rounds (14.2 %) fall between 20:00 and 04:00 ET')
    expect(flat).toContain('**no round of the 15,903**')
  })

  it("records policy 5's type and the docs mismatches to flag", () => {
    const flat = STOCKS_SECTION.replace(/\s+/g, ' ')
    expect(flat).toContain('Policy 5 is a **BLOCKLIST**')
    expect(flat).toContain('reverts `IncompatiblePolicyType` (0xf1011ef5)')
    expect(flat).toContain('Base docs mismatches worth flagging')
    expect(flat).toContain('"including the Onchain Registry" against the `/chains` endpoint')
  })
})
