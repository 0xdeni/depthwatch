/**
 * The static client's stock routes (docs/design/stocks-api.md §2): answered from the bundle's
 * `stocks` and `stockDetails` with the API's 400 and 404 bodies, and from a bundle exported before
 * those keys as an empty list and `stock not found`. The bundle's envelope check accepts either.
 */
import { describe, expect, it } from 'vitest'
import { bundleFromClient } from '../testing/staticBundle.js'
import { createMockClient } from './mock.js'
import { assertStaticBundle, createStaticClient } from './static.js'
import type { StaticBundle } from './types.js'

const NOW = 1_760_000_000
const mock = createMockClient({ now: NOW })
const BUNDLE = await bundleFromClient(mock, { generatedAt: NOW, source: 'live' })
const NVDA = (await mock.stocks()).items[0]?.stock.token.address ?? ''

/** A bundle exported before the stock routes: no `stocks`, no `stockDetails`. */
function older(): StaticBundle {
  const { stocks: _stocks, stockDetails: _details, ...rest } = structuredClone(BUNDLE)
  return rest
}

describe('static client: stocks', () => {
  it('serves the list in the API’s order and each stock by its address, any case', async () => {
    const client = createStaticClient(structuredClone(BUNDLE))
    expect(await client.stocks()).toEqual(await mock.stocks())
    const detail = await client.stock(NVDA.toUpperCase().replace('0X', '0x'))
    expect(detail).toEqual(await mock.stock(NVDA))
    // A copy: changing an answer leaves the bundle alone.
    detail.pools.length = 0
    expect((await client.stock(NVDA)).pools.length).toBeGreaterThan(0)
  })

  it('answers the API’s 400 and 404 bodies', async () => {
    const client = createStaticClient(structuredClone(BUNDLE))
    await expect(client.stock('NVDAc')).rejects.toMatchObject({
      status: 400,
      message: 'invalid token address: expected 0x + 40 hex chars',
    })
    await expect(client.stock(`0x${'cd'.repeat(20)}`)).rejects.toMatchObject({
      status: 404,
      message: 'stock not found',
    })
    await expect(client.stock('0x__proto__'.padEnd(42, '0'))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('reads a bundle exported before the stock routes as no stock at all', async () => {
    const bundle = older()
    expect(assertStaticBundle(bundle).stocks).toBeUndefined()
    const client = createStaticClient(bundle)
    expect(await client.stocks()).toEqual({ items: [] })
    await expect(client.stock(NVDA)).rejects.toMatchObject({
      status: 404,
      message: 'stock not found',
    })
  })

  it('checks the stock keys of the envelope when they are present', () => {
    expect(() => assertStaticBundle({ ...BUNDLE, stocks: {} })).toThrow(/stocks is not an array/)
    expect(() => assertStaticBundle({ ...BUNDLE, stockDetails: [] })).toThrow(
      /stockDetails is not an object/,
    )
    expect(assertStaticBundle(structuredClone(BUNDLE)).stocks?.length).toBe(7)
  })
})
