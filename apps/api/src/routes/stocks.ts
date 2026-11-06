import { Hono } from 'hono'
import type { ApiContext } from '../context.js'
import type { ErrorResponse, StockDetail, StocksResponse } from '../dto.js'
import { INVALID_ADDRESS, parseAddress } from '../query.js'
import { listStocks, stockDetail } from '../stocks.js'

const STOCK_NOT_FOUND: ErrorResponse = { error: 'stock not found' }

/**
 * `GET /api/stocks` and `GET /api/stocks/:token` (docs/design/stocks-api.md §1). A token is a stock
 * when the stored stock list (the `stocks` table, written by every snapshot pass) names it; the
 * address is lowercased first and never matched against a symbol. Both answer with the default
 * `Cache-Control`: readings change at the snapshot cadence, as pool data do.
 */
export function stocksRoutes(ctx: ApiContext): Hono {
  const app = new Hono()

  app.get('/', (c) => {
    const body: StocksResponse = { items: listStocks(ctx.db) }
    return c.json(body)
  })

  app.get('/:token', (c) => {
    const token = parseAddress(c.req.param('token'))
    if (!token) return c.json(INVALID_ADDRESS, 400)
    const body: StockDetail | undefined = stockDetail(ctx.db, token)
    if (!body) return c.json(STOCK_NOT_FOUND, 404)
    return c.json(body)
  })

  return app
}
