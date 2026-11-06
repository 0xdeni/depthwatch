/**
 * The mock's tokenized stocks (`mockStocks.ts`): every status, the API's orders and errors, core's
 * aggregates and references, and stock pools that answer by id and on their stocks' pages but stay
 * out of the generic lists, so no other page's pinned figure changes.
 */
import { DEXES } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { createMockClient, MOCK_STOCK_POOLS } from './mock.js'

const NOW = 1_760_000_000
const client = createMockClient({ now: NOW })
const { items } = await client.stocks()
const byTicker = new Map(items.map((s) => [s.stock.ticker, s]))
const nvda = byTicker.get('NVDA')
if (!nvda) throw new Error('the mock has no NVDAc')

describe('mock stocks', () => {
  it('covers every status, deepest first, then the stocks without depth by ticker', () => {
    expect(items.map((s) => s.stock.ticker)).toEqual([
      'NVDA',
      'AMZN',
      'AAPL',
      'COIN',
      'META',
      'MSFT',
      'TSLA',
    ])
    expect(
      Object.fromEntries(items.map((s) => [s.stock.ticker, s.reading?.referenceStatus])),
    ).toEqual({
      NVDA: 'live',
      AMZN: 'held',
      AAPL: 'paused',
      COIN: 'no-feed',
      META: 'invalid',
      MSFT: 'unread',
      TSLA: 'live',
    })
    expect(byTicker.get('TSLA')?.reading?.transfersPaused).toBe(true)
    expect(byTicker.get('COIN')?.stock.feed).toBeNull()
    for (const s of items) {
      expect(s.stock.token.address).toMatch(/^0xb2[0-9a-f]{38}$/)
      // On the wire the reading's bigints are decimal strings.
      expect(s.reading?.blockNumber).toMatch(/^\d+$/)
      expect(s.updatedAt).toBe(NOW)
    }
  })

  it('sums the counted pools with core: METRICS.md’s +25.06 bps from the deepest pool', () => {
    expect(nvda.poolCount).toBe(3)
    expect(nvda.sidesKnownPools).toBe(3)
    expect(nvda.depth2BuyUsd).toBe(302_500)
    expect(nvda.depth2SellUsd).toBe(303_000)
    expect(nvda.spread10kBps).toBe(30)
    expect(nvda.deepestPoolId).toBe(MOCK_STOCK_POOLS.nvdaUsdcAero)
    expect(nvda.deviationBps).toBeCloseTo(25.06, 2)
    expect(nvda.withinTolerance).toBe(true)
    expect(nvda.venues.map((v) => v.dex)).toEqual(
      DEXES.filter((d) => ['uniswap-v3', 'uniswap-v4', 'aero-slipstream'].includes(d)),
    )
    const tsla = byTicker.get('TSLA')
    // Paused transfers: no pool counts, the deviation is `no-pool`, TVL unchanged.
    expect(tsla?.depth2BuyUsd).toBeNull()
    expect(tsla?.deviationNull).toBe('no-pool')
    expect(tsla?.tvlUsd).toBe(400_000)
    expect(byTicker.get('AMZN')?.deviationNull).toBe('held')
    expect(byTicker.get('AAPL')?.deviationNull).toBe('paused')
  })

  it('orders a stock’s pools as the API does and orients their sides to the stock', async () => {
    const detail = await client.stock(nvda.stock.token.address.toUpperCase().replace('0X', '0x'))
    expect(detail.pools.map((p) => p.pool.pool.id)).toEqual([
      MOCK_STOCK_POOLS.nvdaUsdcAero,
      MOCK_STOCK_POOLS.nvdaWethV3,
      MOCK_STOCK_POOLS.nvdaUsdcV4,
    ])
    const [aero, weth, thin] = detail.pools
    expect(aero?.stockIs).toBe('token1')
    // The stock is token1: buying it is the pool's down side.
    expect([aero?.depth2BuyUsd, aero?.depth2SellUsd]).toEqual([250_000, 260_000])
    expect(weth?.reference?.deviationBps).toBeCloseTo(-125.31, 2)
    expect(weth?.reference?.withinTolerance).toBe(false)
    expect(weth?.reference?.toleranceBps).toBe(80)
    expect(thin?.reference?.deviationNull).toBe('thin')
    const amzn = await client.stock(byTicker.get('AMZN')?.stock.token.address ?? '')
    const cbbtc = amzn.pools.find((p) => p.pool.pool.id === MOCK_STOCK_POOLS.amznCbbtcV3)
    expect(cbbtc?.stockIs).toBe('token0')
    expect([cbbtc?.depth2BuyUsd, cbbtc?.depth2SellUsd]).toEqual([12_000, 14_000])
    const tsla = await client.stock(byTicker.get('TSLA')?.stock.token.address ?? '')
    expect(tsla.pools[0]?.counted).toBe(false)
    expect(tsla.pools[0]?.pool.health.unratedReason).toBe('transfers-paused')
  })

  it('answers the API’s 400 and 404 bodies', async () => {
    await expect(client.stock('nvda')).rejects.toMatchObject({
      status: 400,
      message: 'invalid token address: expected 0x + 40 hex chars',
    })
    await expect(client.stock(`0x${'ab'.repeat(20)}`)).rejects.toMatchObject({
      status: 404,
      message: 'stock not found',
    })
  })

  it('serves its stock pools by id and on their stocks’ pages, never in the generic lists', async () => {
    const pool = await client.pool(MOCK_STOCK_POOLS.nvdaUsdcAero)
    expect(pool.latest?.reference?.stock).toBe(nvda.stock.token.address)
    expect((await client.history(MOCK_STOCK_POOLS.nvdaUsdcAero)).points.length).toBeGreaterThan(0)
    const token = await client.token(nvda.stock.token.address)
    expect(token.token.symbol).toBe('NVDAc')
    expect(token.pools.map((p) => p.pool.id).sort()).toEqual(
      [
        MOCK_STOCK_POOLS.nvdaUsdcAero,
        MOCK_STOCK_POOLS.nvdaWethV3,
        MOCK_STOCK_POOLS.nvdaUsdcV4,
      ].sort(),
    )
    const listed = (await client.pools({ limit: 200 })).items.map((p) => p.pool.id)
    for (const id of Object.values(MOCK_STOCK_POOLS)) expect(listed).not.toContain(id)
    // A pool of no stock has no reference.
    const first = listed[0] ?? ''
    expect((await client.pool(first)).latest?.reference).toBeNull()
  })
})
